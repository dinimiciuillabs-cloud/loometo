// Localhost-only R2 upload proxy. Browser POSTs a data: URL (or a remote
// http(s) URL) + a target key; this route fetches/decodes the bytes,
// signs an S3 V4 PUT against the Cloudflare R2 endpoint, and returns the
// public r2.dev URL the browser can stash in node data.
//
// No SDK — hand-rolled SigV4 against Node's crypto. Keeps the
// [[feedback_block_npm_install]] standing rule honoured. R2 is fully
// S3-compatible so the same algorithm Amazon uses works verbatim.

import { NextRequest, NextResponse } from 'next/server'
import { guardLocalJson } from '@/lib/server/guard'
import crypto from 'crypto'

const REGION = 'auto'
const SERVICE = 's3'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

function isLocalhost(req: NextRequest): boolean {
  const host = req.headers.get('host') || ''
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]')
}

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value).digest()
}

function uriEscape(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

function signedPutRequest({
  accountId, accessKey, secretKey, bucket, key, body, contentType,
}: {
  accountId: string; accessKey: string; secretKey: string;
  bucket: string; key: string; body: Buffer; contentType: string;
}): { url: string; headers: Record<string, string> } {
  const host = `${accountId}.r2.cloudflarestorage.com`
  // R2 only supports path-style URLs (bucket in the path, not subdomain).
  const path = '/' + bucket + '/' + key.split('/').map(uriEscape).join('/')
  const url = `https://${host}${path}`

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8) // YYYYMMDD

  const payloadHash = sha256Hex(body)
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join('\n') + '\n'
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    'PUT', path, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate    = hmac('AWS4' + secretKey, dateStamp)
  const kRegion  = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url,
    headers: {
      'Content-Type': contentType,
      'Host': host,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      'Authorization': authorization,
    },
  }
}

// Decode either a data: URL or a remote http(s) URL into raw bytes +
// mime. Remote fetches happen server-side so CORS and browser memory
// pressure are both bypassed.
async function loadBytes(source: string): Promise<{ body: Buffer; contentType: string }> {
  if (source.startsWith('data:')) {
    // Hand-parse via indexOf instead of a regex — V8's regex engine
    // backtracks on `.+` against multi-MB strings and can blow the
    // native call stack ("Maximum call stack size exceeded"). String
    // slicing is O(n) flat and handles 10 MB+ data URLs cleanly.
    const comma = source.indexOf(',')
    if (comma < 0) throw new Error('Malformed data URL (no comma)')
    const header = source.substring(5, comma) // strip leading 'data:'
    const body = source.substring(comma + 1)
    const semi = header.indexOf(';')
    const contentType = (semi >= 0 ? header.substring(0, semi) : header) || 'application/octet-stream'
    const isBase64 = header.includes('base64')
    if (!isBase64) throw new Error('Only base64 data URLs are supported')
    return { contentType, body: Buffer.from(body, 'base64') }
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Source fetch failed: HTTP ${res.status}`)
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const ab = await res.arrayBuffer()
    return { contentType, body: Buffer.from(ab) }
  }
  throw new Error('Source must be a data: URL or http(s) URL')
}

function extFor(contentType: string): string {
  if (contentType.startsWith('image/png')) return 'png'
  if (contentType.startsWith('image/jpeg')) return 'jpg'
  if (contentType.startsWith('image/webp')) return 'webp'
  if (contentType.startsWith('image/gif')) return 'gif'
  if (contentType.startsWith('video/mp4')) return 'mp4'
  if (contentType.startsWith('video/webm')) return 'webm'
  if (contentType.startsWith('audio/mpeg')) return 'mp3'
  if (contentType.startsWith('audio/mp3'))  return 'mp3'
  if (contentType.startsWith('audio/wav'))  return 'wav'
  if (contentType.startsWith('audio/ogg'))  return 'ogg'
  return 'bin'
}

export async function POST(req: NextRequest) {
  const jsonGuard = guardLocalJson(req)
  if (jsonGuard) return jsonGuard
  if (!isLocalhost(req)) {
    return NextResponse.json({ error: 'localhost only' }, { status: 403 })
  }

  let payload: { source?: string; key?: string; prefix?: string } = {}
  try { payload = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { source, key: explicitKey, prefix } = payload
  if (!source) return NextResponse.json({ error: 'source is required' }, { status: 400 })

  try {
    // R2_ACCOUNT_ID may be set to either the bare account ID or the full
    // S3 endpoint URL — accept both, extract the subdomain in either case.
    const raw = env('R2_ACCOUNT_ID').trim()
    const accountId = raw.includes('://')
      ? new URL(raw).hostname.split('.')[0]
      : raw.replace(/\.r2\.cloudflarestorage\.com$/, '')
    const accessKey = env('R2_ACCESS_KEY_ID')
    const secretKey = env('R2_SECRET_ACCESS_KEY')
    const bucket    = env('R2_BUCKET')
    const publicBase = env('R2_PUBLIC_URL').replace(/\/+$/, '')

    const { body, contentType } = await loadBytes(source)

    // Build a key if the caller didn't pin one. Keys look like
    //   <prefix>/<timestamp>-<random>.<ext>
    // so collisions are essentially impossible and prefixes group by
    // workflow / node when the caller wants them to.
    const key = explicitKey
      ?? `${(prefix || 'misc').replace(/^\/+|\/+$/g, '')}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extFor(contentType)}`

    const { url, headers } = signedPutRequest({
      accountId, accessKey, secretKey, bucket, key, body, contentType,
    })

    // Cast: Node's fetch BodyInit overlaps with Buffer at runtime
    // (undici accepts Buffer) but TS types lag behind the runtime.
    const res = await fetch(url, { method: 'PUT', headers, body: body as unknown as BodyInit })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `R2 upload failed: HTTP ${res.status} ${txt.slice(0, 400)}` },
        { status: 502 },
      )
    }

    const publicUrl = `${publicBase}/${key.split('/').map(uriEscape).join('/')}`
    return NextResponse.json({
      url: publicUrl,
      key,
      size: body.length,
      contentType,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    bucket: process.env.R2_BUCKET ?? null,
    publicBase: process.env.R2_PUBLIC_URL ?? null,
    hasCreds: !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ACCOUNT_ID),
  })
}
