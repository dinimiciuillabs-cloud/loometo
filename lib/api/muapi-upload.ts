// MuAPI accepts only http(s) URLs in its image_url / images_list fields.
// AiFlow stores uploaded images as base64 data URLs in localStorage, so
// every MuAPI call has to upload the bytes to MuAPI's S3 bucket first.
//
// The upload is routed entirely through /api/proxy/muapi (kind: 'upload').
// The server signs the POST URL with MUAPI_API_KEY and does the multipart
// POST to S3 itself. Previously the browser POSTed to S3 directly, which
// silently failed on CORS for localhost:3005 — the fetch promise rejected
// without leaving an entry in our server log, so it looked like the
// generate call was just never firing.

const cache = new Map<string, string>() // dataUrlHash → hosted URL

function quickHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i += 1024) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return `${s.length}_${h}`
}

function parseDataUrl(dataUrl: string): { base64: string; mime: string } {
  // indexOf-based instead of regex — `.+` against multi-MB base64
  // bodies can stack-overflow V8's regex engine.
  if (!dataUrl.startsWith('data:')) throw new Error('Not a data URL')
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Malformed data URL')
  const header = dataUrl.substring(5, comma)
  const base64 = dataUrl.substring(comma + 1)
  const semi = header.indexOf(';')
  const mime = (semi >= 0 ? header.substring(0, semi) : header) || 'application/octet-stream'
  if (!header.includes('base64')) throw new Error('Not a base64 data URL')
  return { mime, base64 }
}

function extFromMime(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg'
  if (mime.includes('png'))  return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('mp4'))  return 'mp4'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('wav'))  return 'wav'
  return mime.split('/')[1] ?? 'bin'
}

export async function uploadToMuApi(_apiKey: string, dataUrlOrUrl: string): Promise<string> {
  if (!dataUrlOrUrl.startsWith('data:')) return dataUrlOrUrl

  const key = quickHash(dataUrlOrUrl)
  const cached = cache.get(key)
  if (cached) return cached

  // We used to upload to MuAPI's private S3 bucket here, but a fair
  // number of MuAPI-routed models (Seedream / ByteDance, Qwen, etc.)
  // are forwarded out to upstream providers that can't fetch from a
  // private bucket — they failed with a generic "Unknown error".
  // R2 is public-read and works for every model, MuAPI-internal or
  // upstream-forwarded, so we host inputs there now.
  const { uploadToR2 } = await import('@/lib/store/r2Upload')
  const { url } = await uploadToR2(dataUrlOrUrl, { prefix: 'inputs' })
  cache.set(key, url)
  return url
}

// Walk a params object recursively, uploading any data: URLs to MuAPI
// via the proxy and replacing them with hosted URLs. Returns a NEW
// params object — does not mutate the input.
export async function uploadDataUrlsInPayload(
  apiKey: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...params }
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && v.startsWith('data:')) {
      out[k] = await uploadToMuApi(apiKey, v)
    } else if (Array.isArray(v)) {
      out[k] = await Promise.all(v.map(async item =>
        typeof item === 'string' && item.startsWith('data:')
          ? uploadToMuApi(apiKey, item)
          : item,
      ))
    }
  }
  return out
}
