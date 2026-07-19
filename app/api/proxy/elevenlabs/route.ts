// Localhost-only ElevenLabs proxy. Keeps the API key on the server,
// dodges any CORS surprises, and centralises one log point for upstream
// failures (same posture as the OpenAI / Google / MuAPI proxies).
//
// Supported ops:
//   - { kind: 'tts', voiceId, text, modelId?, voiceSettings? }
//     → returns the generated audio as audio/mpeg bytes
//   - { kind: 'voices' }
//     → returns the user's voice library (premade + cloned)
//   - { kind: 'models' }
//     → returns available models for the account
//   - { kind: 'clone', name, description?, files: [{data, mime}] }
//     → creates a new instant voice clone from base64 audio files,
//       returns { voice_id, ... }

import { NextRequest, NextResponse } from 'next/server'
import { guardLocalJson } from '@/lib/server/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EL_BASE = 'https://api.elevenlabs.io/v1'

function isLocalRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  const hostname = host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

type Body =
  | {
      kind: 'tts'
      voiceId: string
      text: string
      modelId?: string
      voiceSettings?: { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean }
    }
  | { kind: 'voices' }
  | { kind: 'models' }
  | {
      kind: 'clone'
      name: string
      description?: string
      files: Array<{ data: string; mime: string; filename: string }>
    }

export async function POST(req: NextRequest) {
  const jsonGuard = guardLocalJson(req)
  if (jsonGuard) return jsonGuard
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'Proxy is localhost-only' }, { status: 403 })
  }
  // .env.local wins; otherwise fall back to the key the browser pasted in
  // Settings → API Keys (sent as x-user-key over localhost only).
  const apiKey = process.env.ELEVENLABS_API_KEY || req.headers.get('x-user-key')
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'No ElevenLabs key. Paste it in Settings → API Keys and Save, or set ELEVENLABS_API_KEY in .env.local (then restart the dev server).' },
      { status: 500 },
    )
  }

  let body: Body
  try { body = (await req.json()) as Body }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }) }

  try {
    if (body.kind === 'tts') {
      const url = `${EL_BASE}/text-to-speech/${encodeURIComponent(body.voiceId)}`
      const payload: Record<string, unknown> = {
        text: body.text,
        model_id: body.modelId ?? 'eleven_multilingual_v2',
      }
      if (body.voiceSettings) payload.voice_settings = body.voiceSettings
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        console.log(`[proxy/elevenlabs tts ${body.voiceId}] HTTP ${res.status} ${t.slice(0, 400)}`)
        return NextResponse.json({ ok: false, error: `ElevenLabs TTS HTTP ${res.status}: ${t.slice(0, 300)}` }, { status: res.status })
      }
      const buf = await res.arrayBuffer()
      console.log(`[proxy/elevenlabs tts ${body.voiceId}] OK bytes=${buf.byteLength}`)
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'cache-control': 'no-store',
        },
      })
    }

    if (body.kind === 'voices') {
      const res = await fetch(`${EL_BASE}/voices`, { headers: { 'xi-api-key': apiKey } })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      })
    }

    if (body.kind === 'models') {
      const res = await fetch(`${EL_BASE}/models`, { headers: { 'xi-api-key': apiKey } })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      })
    }

    if (body.kind === 'clone') {
      // Voice cloning takes multipart/form-data with audio file uploads.
      const form = new FormData()
      form.append('name', body.name)
      if (body.description) form.append('description', body.description)
      for (const f of body.files) {
        const bytes = Buffer.from(f.data, 'base64')
        form.append('files', new Blob([new Uint8Array(bytes)], { type: f.mime }), f.filename)
      }
      const res = await fetch(`${EL_BASE}/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
      })
      const text = await res.text()
      console.log(`[proxy/elevenlabs clone ${body.name}] HTTP ${res.status}`)
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      })
    }

    return NextResponse.json({ ok: false, error: 'Unknown kind' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Upstream fetch failed: ${msg}` }, { status: 502 })
  }
}

// Quick health check — confirms the env var is set without exposing it.
export async function GET() {
  return NextResponse.json({
    ok: true,
    hasKey: !!process.env.ELEVENLABS_API_KEY,
  })
}
