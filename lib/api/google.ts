// Google AI (Gemini + Imagen) wrappers, called directly from the browser.
// All endpoints support CORS for browser-origin calls when the user attaches
// their AI Studio API key via the URL ?key= param.
//
// Endpoints used:
//   - Imagen image gen: v1beta/models/imagen-3.0-generate-002:predict
//   - Gemini vision:    v1beta/models/gemini-2.0-flash:generateContent
//   - Gemini text:      v1beta/models/gemini-2.0-flash:generateContent

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const GOOGLE_IMAGE_MODELS = [
  { id: 'imagen-4',   name: 'Imagen 4',          description: 'Best Imagen quality',         cost: '$$'  },
  { id: 'imagen-3',   name: 'Imagen 3',          description: 'Faster, slightly lower fidelity', cost: '$$' },
]

export const GOOGLE_LLM_MODELS = [
  { id: 'gemini-2.0-flash',     name: 'Gemini 2.0 Flash',     description: 'Fast & cheap, multimodal', cost: '$'   },
  { id: 'gemini-2.0-pro',       name: 'Gemini 2.0 Pro',       description: 'Top reasoning',            cost: '$$'  },
  { id: 'gemini-1.5-pro',       name: 'Gemini 1.5 Pro',       description: 'Mature, multimodal',       cost: '$$'  },
]

function modelEndpoint(model: string): string {
  // Imagen ids → underlying API model name
  if (model === 'imagen-4') return 'imagen-4.0-generate-001'
  if (model === 'imagen-3') return 'imagen-3.0-generate-002'
  return model
}

export async function generateImageGoogle(apiKey: string, params: {
  model: string
  prompt: string
  aspectRatio?: string
}) {
  const m = modelEndpoint(params.model)
  const res = await fetch(`${GOOGLE_BASE}/models/${m}:predict?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: params.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: params.aspectRatio || '1:1',
      },
    }),
  })
  if (!res.ok) throw new Error(`Google image gen failed: HTTP ${res.status}`)
  const data = await res.json()
  // Imagen returns base64 PNG bytes — wrap as data URL so previews + downstream
  // nodes can consume it the same way they consume any other image URL.
  const b64: string | undefined = data?.predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('Google image gen: no image in response')
  return { imageUrl: `data:image/png;base64,${b64}`, raw: data }
}

// Nano Banana via Gemini API. Nano Banana is the marketing name for
// `gemini-2.5-flash-image-preview` (or Nano Banana Pro = `gemini-3-pro-image`).
// The endpoint is the same `generateContent` as text/vision — the response
// just contains inline image data. Free during preview; ~$0.04/image after.
export async function generateImageNanoBanana(_apiKey: string, params: {
  model?: string                                  // 'gemini-2.5-flash-image-preview' | 'gemini-3-pro-image'
  prompt: string
  referenceImages?: string[]                      // up to 14 ref URLs (or data: URLs) for character consistency
  imageSize?: '1K' | '2K' | '4K'                  // Pro-only. Silently dropped on the 2.5 flash path.
  aspectRatio?: '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4'
}): Promise<{ imageUrl: string; raw: unknown }> {
  const model = params.model ?? 'gemini-2.5-flash-image-preview'
  const isPro = /gemini-3-pro-image/.test(model)
  // Only forward imageSize on the Pro path — 2.5 flash returns a 400 if
  // it sees imageConfig.imageSize. aspectRatio is accepted by both.
  const imageConfig: Record<string, string> = {}
  if (isPro && params.imageSize) imageConfig.imageSize = params.imageSize
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio
  const parts: unknown[] = [{ text: params.prompt }]
  // Convert each reference (URL or data: URL) to inline base64. data:
  // URLs fetch natively in-browser. Remote URLs (R2 public dev URLs in
  // particular) often lack CORS for localhost — route those through
  // /api/proxy/fetch so the bytes come back same-origin.
  for (const url of params.referenceImages ?? []) {
    const fetchTarget = url.startsWith('data:')
      ? url
      : `/api/proxy/fetch?url=${encodeURIComponent(url)}`
    const blob = await (await fetch(fetchTarget)).blob()
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve((typeof r.result === 'string' ? r.result : '').split(',')[1] ?? '')
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
    parts.push({ inline_data: { mime_type: blob.type || 'image/png', data: b64 } })
  }
  // Route through /api/proxy/google so the API key stays server-side and
  // we get one log point for diagnosing upstream failures.
  const res = await fetch('/api/proxy/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `models/${model}:generateContent`,
      body: {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
        },
      },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || err.error || `Nano Banana failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  // Google's REST API uses camelCase (inlineData) for v1beta responses,
  // but legacy code paths sometimes return snake_case (inline_data) — check
  // both. (Same applies to mimeType vs mime_type.)
  const candidate = data?.candidates?.[0]
  type Part = { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }
  const imagePart: Part | undefined = candidate?.content?.parts?.find(
    (p: Part) => p.inlineData?.data || p.inline_data?.data,
  )
  const inline = imagePart?.inlineData ?? imagePart?.inline_data
  const b64 = inline?.data
  if (!b64) {
    const finishReason = candidate?.finishReason
    const safety = candidate?.safetyRatings
    throw new Error(`Nano Banana: no image in response (finishReason=${finishReason}, safety=${JSON.stringify(safety)?.slice(0, 200)})`)
  }
  const mime = (imagePart?.inlineData?.mimeType) ?? (imagePart?.inline_data?.mime_type) ?? 'image/png'
  return { imageUrl: `data:${mime};base64,${b64}`, raw: data }
}

// Veo 3 / 3.1 video generation via Gemini API. Async long-running operation.
//   POST /v1beta/models/<model>:predictLongRunning  → returns op name
//   GET  /v1beta/<opName>                           → poll until done
//
// Veo 3.1 preview supports first-frame + last-frame transitions. We
// accept both as data:/http URLs, convert to base64 in the browser, and
// forward through /api/proxy/google so the API key stays server-side.
//
// Veo 3.1 fast: ~$0.10/sec. Veo 3.1: ~$0.40/sec. Veo 3.1 lite: cheapest.
export async function generateVideoVeo(_apiKey: string, params: {
  model: string                                   // 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview' | 'veo-3.0-fast-generate-001'
  prompt: string
  imageUrl?: string                               // first frame for I2V (data: or http URL)
  lastImageUrl?: string                           // optional last frame for transition (Veo 3.1+)
  durationSeconds?: 4 | 6 | 8
  aspectRatio?: '16:9' | '9:16'
  resolution?: '720p' | '1080p'
}): Promise<{ videoUrl: string; raw: unknown }> {
  const instances: Record<string, unknown> = { prompt: params.prompt }
  if (params.imageUrl) {
    instances.image = await urlToBase64Part(params.imageUrl)
  }
  if (params.lastImageUrl) {
    instances.lastFrame = await urlToBase64Part(params.lastImageUrl)
  }

  const createRes = await fetch('/api/proxy/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `models/${params.model}:predictLongRunning`,
      body: {
        instances: [instances],
        parameters: {
          durationSeconds: params.durationSeconds ?? 8,
          aspectRatio: params.aspectRatio ?? '16:9',
          resolution: params.resolution ?? '1080p',
        },
      },
    }),
  })
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}))
    throw new Error(err.error?.message || err.error || `Veo create failed: HTTP ${createRes.status}`)
  }
  const op = await createRes.json()
  const opName = op.name as string
  if (!opName) throw new Error('Veo create: no operation name in response')

  // Poll the long-running operation. Veo can take 1-3 minutes.
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5_000))
    const pollRes = await fetch('/api/proxy/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: opName, method: 'GET' }),
    })
    if (!pollRes.ok) throw new Error(`Veo poll failed: HTTP ${pollRes.status}`)
    const status = await pollRes.json()
    if (status.done) {
      if (status.error) throw new Error(status.error.message || 'Veo generation failed')
      const samples = status.response?.generatedSamples
        ?? status.response?.generateVideoResponse?.generatedSamples
        ?? []
      const video = samples?.[0]?.video
      // 3.1 preview returns video.uri like "https://generativelanguage.
      // googleapis.com/v1beta/files/<id>:download?alt=media" — that
      // URL requires the API key to fetch, so a browser <video> tag
      // can't play it directly. Pull the bytes through our proxy and
      // hand back a data: URL the UI can use as-is.
      if (video?.uri) {
        // Strip the host + /v1beta/ prefix but KEEP the query string —
        // ?alt=media is required by Google's file download endpoint or
        // it returns 400. The earlier regex stopped at "?" and lost it.
        let filePath: string
        try {
          const u = new URL(video.uri)
          filePath = u.pathname.replace(/^\/v1beta\//, '') + u.search
        } catch {
          throw new Error(`Veo: unrecognised video URI ${video.uri}`)
        }
        const fileRes = await fetch('/api/proxy/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, method: 'GET' }),
        })
        if (!fileRes.ok) throw new Error(`Veo file fetch failed: HTTP ${fileRes.status}`)
        const blob = await fileRes.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
          r.onerror = () => reject(r.error)
          r.readAsDataURL(blob)
        })
        return { videoUrl: dataUrl, raw: status }
      }
      if (video?.bytesBase64Encoded) {
        return { videoUrl: `data:video/mp4;base64,${video.bytesBase64Encoded}`, raw: status }
      }
      throw new Error(`Veo: no video URL in completed response. Raw: ${JSON.stringify(status.response ?? {}).slice(0, 300)}`)
    }
  }
  throw new Error('Veo generation timed out')
}

// Convert a data: or http(s): URL to { bytesBase64Encoded, mimeType }
// suitable for Veo's instances.image / instances.lastFrame fields. Runs
// in the browser; fetch() handles data: URLs natively.
async function urlToBase64Part(url: string): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  const fetchTarget = url.startsWith('data:')
    ? url
    : `/api/proxy/fetch?url=${encodeURIComponent(url)}`
  const blob = await (await fetch(fetchTarget)).blob()
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((typeof r.result === 'string' ? r.result : '').split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  return { bytesBase64Encoded: b64, mimeType: blob.type || 'image/png' }
}

// Gemini Text-to-Speech via gemini-2.5-flash-preview-tts. The style
// `instructions` get prepended to the text as a "Say [style]: <text>"
// pattern — Gemini's TTS interprets pre-script directives reliably.
//
// Voices: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr.
// Default: Kore (warm, neutral). Returns mp3 data URL.
export async function ttsGemini(apiKey: string, params: {
  text: string
  voice?: string
  instructions?: string
}): Promise<{ audioUrl: string }> {
  const voice = params.voice ?? 'Kore'
  // Gemini doesn't have a separate "instructions" field — the prompt
  // itself controls the style. Prepend the user's direction.
  const fullText = params.instructions
    ? `${params.instructions}: ${params.text}`
    : params.text
  const res = await fetch(
    `${GOOGLE_BASE}/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Gemini TTS failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((p: { inline_data?: { data?: string; mime_type?: string } }) => p.inline_data?.data)
  if (!part?.inline_data?.data) throw new Error('Gemini TTS: no audio in response')
  const mime = part.inline_data.mime_type || 'audio/mp3'
  return { audioUrl: `data:${mime};base64,${part.inline_data.data}` }
}

// Gemini audio transcription. The 2.5 Flash family accepts audio as
// inline_data in a generateContent call. Free during preview.
export async function transcribeAudioGemini(apiKey: string, audioUrl: string, opts?: {
  model?: string
  language?: string
}): Promise<string> {
  const model = opts?.model ?? 'gemini-2.5-flash'
  const audioFetch = audioUrl.startsWith('data:') ? audioUrl : `/api/proxy/fetch?url=${encodeURIComponent(audioUrl)}`
  const blob = await (await fetch(audioFetch)).blob()
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((typeof r.result === 'string' ? r.result : '').split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  const langHint = opts?.language ? ` (audio is in ${opts.language})` : ''
  const parts: unknown[] = [
    { text: `Transcribe this audio exactly as spoken${langHint}. Return ONLY the transcript text, no preamble or formatting.` },
    { inline_data: { mime_type: blob.type || 'audio/mp3', data: b64 } },
  ]
  return geminiCall(apiKey, model, parts)
}

async function geminiCall(_apiKey: string, model: string, parts: unknown[], opts?: { maxOutputTokens?: number }) {
  // Routes through /api/proxy/google so the API key stays server-side
  // and CORS is never an issue. (Earlier we hit silent CORS failures
  // on browser-direct calls to generativelanguage.googleapis.com from
  // some origins.) The proxy also gives us one log point per call.
  //
  // maxOutputTokens default doubled to 8192 (from 4096) on 2026-05-30
  // after Image→JSON truncations were observed. Gemini 2.5/3.x burns
  // "thinking" tokens out of this same budget, so verbose system
  // prompts can eat the room available for the actual response.
  // Callers (like Image→JSON with verbose instructions) can request
  // higher caps explicitly.
  const res = await fetch('/api/proxy/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `models/${model}:generateContent`,
      body: {
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: opts?.maxOutputTokens ?? 8192 },
      },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || err.error || `Gemini call failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

export async function describeImageGemini(apiKey: string, imageUrl: string, instructions?: string) {
  // Gemini accepts inline_data with base64 — convert any URL to base64 first.
  const imgFetch = imageUrl.startsWith('data:') ? imageUrl : `/api/proxy/fetch?url=${encodeURIComponent(imageUrl)}`
  const blob = await (await fetch(imgFetch)).blob()
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const result = typeof r.result === 'string' ? r.result : ''
      resolve(result.split(',')[1] ?? '')
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

  return geminiCall(apiKey, 'gemini-2.5-flash', [
    { text: instructions || 'Describe this image in rich detail as a prompt for AI image generation. Be specific about style, lighting, colors, composition, and mood.' },
    { inline_data: { mime_type: blob.type || 'image/png', data: b64 } },
  ])
}

// Shared enhancer ruleset — same rules as openai.ts so Gemini and OpenAI
// produce comparable output for the same input prompt.
const ENHANCER_SYSTEM_PROMPT = `You enhance prompts for AI image / video generation. Output rules:

1. STRUCTURE: subject + setting + style. Always in that order.
2. SENSORY CONCRETE: camera (lens, angle, motion), lighting (rim, neon, golden hour, backlight), color palette, mood. Use specifics, not adjectives.
3. CAP AT ~200 TOKENS. Models DEGRADE with longer prompts. Compress, don't pad.
4. POSITIVE PHRASING ONLY. Instead of "no blur" say "tack sharp". Instead of "no people" say "uninhabited landscape".
5. FOR IMAGE-TO-VIDEO PROMPTS: describe MOTION VERBS only ("camera dollies in", "smoke rises slowly"). Do NOT redescribe the static frame — the model already has it.
6. FOR IMAGE-TO-IMAGE PROMPTS: describe what CHANGES, not the original.
7. AVOID: real public figures by name, trademarked characters, sexual content.

Return ONLY the enhanced prompt. No preamble, no explanation.`

export async function enhancePromptGemini(apiKey: string, prompt: string, model = 'gemini-2.5-flash', instructions?: string) {
  const sys = instructions || ENHANCER_SYSTEM_PROMPT
  return geminiCall(apiKey, model, [
    { text: `${sys}\n\nUser prompt: ${prompt}` },
  ])
}

export async function runLLMGemini(
  apiKey: string,
  model: string,
  userMessage: string,
  imageUrl?: string | string[],
  opts?: { maxOutputTokens?: number },
) {
  const parts: unknown[] = [{ text: userMessage }]
  const urls = Array.isArray(imageUrl) ? imageUrl : imageUrl ? [imageUrl] : []
  for (const u of urls) {
    const uFetch = u.startsWith('data:') ? u : `/api/proxy/fetch?url=${encodeURIComponent(u)}`
    const blob = await (await fetch(uFetch)).blob()
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => {
        const result = typeof r.result === 'string' ? r.result : ''
        resolve(result.split(',')[1] ?? '')
      }
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
    parts.push({ inline_data: { mime_type: blob.type || 'image/png', data: b64 } })
  }
  return geminiCall(apiKey, model, parts, opts)
}
