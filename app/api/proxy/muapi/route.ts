// Server-side MuAPI proxy. Why this exists:
//
//   MuAPI's CORS posture sets `access-control-allow-credentials: true`
//   without echoing `access-control-allow-origin: http://localhost:3005`,
//   so the browser preflight fails on every direct call to api.muapi.ai
//   and muapi.ai/api/app/. This route receives the browser's payload,
//   attaches the key from process.env.MUAPI_API_KEY, forwards to MuAPI,
//   and returns the response — same-origin from the browser's POV.
//
// Three operations, dispatched on `kind`:
//   - sign-upload : GET muapi.ai/api/app/get_file_upload_url?filename=
//   - generate    : POST api.muapi.ai/api/v1/{slug}
//   - poll        : GET  api.muapi.ai/api/v1/predictions/{id}/result
//
// The S3 multipart POST itself is NOT proxied — it goes from browser to
// muapi.s3.amazonaws.com directly. S3 bucket CORS allows that and the
// signed POST carries its own auth (no MuAPI key needed).
//
// Auth model: the proxy reads MUAPI_API_KEY from process.env. The
// browser never sees it. Keep this route localhost-only too — it's a
// pass-through that uses a privileged key, so we don't want it
// reachable from the public internet even with the dev server bound
// wide.

import { NextRequest, NextResponse } from 'next/server'
import { guardLocalJson } from '@/lib/server/guard'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const MUAPI_V1   = 'https://api.muapi.ai/api/v1'
const MUAPI_APP  = 'https://muapi.ai/api/app'

// 20+ MuAPI models declare a `name` slug that differs from their actual
// `endpoint_url` (e.g. `seedance-lite-reference-video` POSTs to
// `seedance-lite-reference-to-video`). Client always sends the canonical
// `name` slug; we translate to the real endpoint here so a schema-only
// patch is enough to onboard any new divergence.
let SLUG_TO_ENDPOINT: Map<string, string> | null = null
function getEndpoint(slug: string): string {
  if (!SLUG_TO_ENDPOINT) {
    SLUG_TO_ENDPOINT = new Map()
    try {
      const raw = readFileSync(join(process.cwd(), 'public', 'muapi-schema.json'), 'utf8')
      const schema = JSON.parse(raw) as Array<{
        name: string
        input_schema?: { schemas?: { input_data?: { endpoint_url?: string } } }
      }>
      for (const m of schema) {
        const ep = m?.input_schema?.schemas?.input_data?.endpoint_url
        if (ep && ep !== m.name) SLUG_TO_ENDPOINT.set(m.name, ep)
      }
    } catch (e) {
      console.warn('[proxy/muapi] could not preload endpoint_url map:', e)
    }
  }
  return SLUG_TO_ENDPOINT.get(slug) ?? slug
}

function isLocalRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  const hostname = host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

type Body =
  | { kind: 'sign-upload'; filename: string }
  | { kind: 'upload'; filename: string; mime: string; data: string } // base64 body
  | { kind: 'generate'; slug: string; params: Record<string, unknown> }
  | { kind: 'poll'; requestId: string }

export async function POST(req: NextRequest) {
  const jsonGuard = guardLocalJson(req)
  if (jsonGuard) return jsonGuard
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'Proxy is localhost-only' }, { status: 403 })
  }

  // .env.local wins; otherwise fall back to the key the browser pasted in
  // Settings → API Keys (sent as x-user-key over localhost only).
  const apiKey = process.env.MUAPI_API_KEY || req.headers.get('x-user-key')
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'No MuAPI key. Paste it in Settings → API Keys and Save, or set MUAPI_API_KEY in .env.local (then restart the dev server).' },
      { status: 500 },
    )
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    if (body.kind === 'sign-upload') {
      const url = `${MUAPI_APP}/get_file_upload_url?filename=${encodeURIComponent(body.filename)}`
      const res = await fetch(url, { headers: { 'x-api-key': apiKey } })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      })
    }

    // Full upload: sign + S3 POST + return hosted URL. Replaces the
    // browser-direct S3 POST path that was silently failing (S3 bucket
    // CORS doesn't grant the multipart POST from http://localhost:3005,
    // so the fetch promise rejected and the run handler aborted before
    // ever reaching the generate call).
    if (body.kind === 'upload') {
      const signRes = await fetch(
        `${MUAPI_APP}/get_file_upload_url?filename=${encodeURIComponent(body.filename)}`,
        { headers: { 'x-api-key': apiKey } },
      )
      if (!signRes.ok) {
        const t = await signRes.text().catch(() => '')
        return NextResponse.json({ ok: false, error: `sign failed: HTTP ${signRes.status} ${t.slice(0, 200)}` }, { status: signRes.status })
      }
      const signed = await signRes.json() as { url: string; fields: Record<string, string> }

      const bytes = Buffer.from(body.data, 'base64')
      const form = new FormData()
      for (const [k, v] of Object.entries(signed.fields)) form.append(k, v)
      form.append('file', new Blob([new Uint8Array(bytes)], { type: body.mime }), body.filename)

      const putRes = await fetch(signed.url, { method: 'POST', body: form })
      if (!putRes.ok && putRes.status !== 204) {
        const t = await putRes.text().catch(() => '')
        return NextResponse.json({ ok: false, error: `S3 POST failed: HTTP ${putRes.status} ${t.slice(0, 200)}` }, { status: putRes.status })
      }
      const hostedUrl = `${signed.url.replace(/\/$/, '')}/${signed.fields.key}`
      console.log(`[proxy/muapi upload ${body.filename}] -> ${hostedUrl}`)
      return NextResponse.json({ ok: true, url: hostedUrl })
    }

    if (body.kind === 'generate') {
      const endpoint = getEndpoint(body.slug)
      const res = await fetch(`${MUAPI_V1}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(body.params),
      })
      const text = await res.text()
      // Dev-mode visibility: dump the upstream body to stdout so we can
      // diagnose model-rejection errors that the browser swallows.
      console.log(`[proxy/muapi generate ${body.slug} → ${endpoint}] HTTP ${res.status}`)
      console.log(`  request params:`, JSON.stringify(body.params).slice(0, 500))
      console.log(`  upstream body:`, text.slice(0, 800))
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      })
    }

    if (body.kind === 'poll') {
      const res = await fetch(`${MUAPI_V1}/predictions/${encodeURIComponent(body.requestId)}/result`, {
        headers: { 'x-api-key': apiKey },
      })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      })
    }

    return NextResponse.json({ ok: false, error: 'Unknown kind' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Upstream fetch failed: ${message}` }, { status: 502 })
  }
}
