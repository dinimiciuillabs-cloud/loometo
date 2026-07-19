// Unified model dispatcher. Nodes call `runModel(slug, params)` and the
// dispatcher:
//   1. Looks up the model's route options (router.ts)
//   2. Picks the cheapest route the user has a key for (or honors preferredRoute)
//   3. Translates params from MuAPI's canonical shape (capabilities.ts) to
//      whichever provider we're hitting
//   4. Returns a uniform { kind, url, raw } shape

import type { APIKeys } from '@/lib/store/workflowStore'
import { pickRoute } from './router'
import { callMuApi, pollMuApiViaProxy } from './muapi'
import { uploadDataUrlsInPayload } from './muapi-upload'
import { generateImageOpenAI, generateVideoOpenAI } from './openai'
import { generateImageGoogle, generateImageNanoBanana, generateVideoVeo } from './google'
import { generateImageTo3D, generateTextTo3D } from './meshy'

export type RunResultKind = 'image' | 'video' | 'audio' | '3d' | 'text'

export interface RunResult {
  kind: RunResultKind
  url: string                    // URL or data URL
  thumbnailUrl?: string
  route: string                  // which route was used (for UI display)
  raw: unknown
}

export interface RunOptions {
  apiKeys: Partial<APIKeys>
  preferredRoute?: string         // override the auto-pick
  // When set (browser only), any data: URL returned by the route is
  // uploaded to R2 via /api/proxy/r2 and replaced with the public r2.dev
  // URL. Falls back gracefully (returns the original data: URL) if R2
  // is misconfigured or unreachable. Pass a per-node / per-workflow
  // prefix to keep object keys organised.
  persistToR2?: { prefix?: string } | boolean
}

// Params here are the model's MuAPI-canonical shape (snake_case, per
// capabilities.ts). The dispatcher transforms to each direct provider's
// expected shape when routing off MuAPI.
export async function runModel(
  modelSlug: string,
  params: Record<string, unknown>,
  opts: RunOptions,
): Promise<RunResult> {
  const route = pickRoute(modelSlug, opts.apiKeys, opts.preferredRoute as never)
  if (!route) {
    throw new Error(`No usable route for ${modelSlug}. Add an API key (Loometo, OpenAI, Google, Meshy).`)
  }

  let result: RunResult
  switch (route.id) {
    case 'muapi':
      result = await runOnMuApi(modelSlug, params, opts.apiKeys.muapi!); break
    case 'openai-direct':
      result = await runOnOpenAi(modelSlug, params, opts.apiKeys.openai!); break
    case 'google-direct':
      result = await runOnGoogle(modelSlug, params, opts.apiKeys.google!); break
    case 'meshy-direct':
      result = await runOnMeshy(modelSlug, params, opts.apiKeys.meshy!); break
    default:
      throw new Error(`Route ${route.id} not implemented yet (phase 2)`)
  }

  // Persist any data: URL returned by the route to R2 so it survives
  // refresh / IDB wipes and downstream models can fetch it via plain
  // HTTPS. Skipped if the URL is already HTTPS (MuAPI / OpenAI / Meshy
  // return durable URLs already). Disable with `persistToR2: false`.
  // Browser-only; SSR / API routes get the raw result.
  const wantPersist = opts.persistToR2 !== false
  if (wantPersist && typeof window !== 'undefined' && result.url.startsWith('data:')) {
    const prefix = typeof opts.persistToR2 === 'object'
      ? (opts.persistToR2.prefix || `generated/${modelSlug}`)
      : `generated/${modelSlug}`
    try {
      const { uploadToR2 } = await import('@/lib/store/r2Upload')
      const up = await uploadToR2(result.url, { prefix })
      result = { ...result, url: up.url }
    } catch (err) {
      // Non-fatal: keep the data: URL so the node still has a value.
      console.warn('R2 persist failed, keeping data: URL:', err)
    }
  }
  return result
}

// ─── MuAPI ────────────────────────────────────────────────────────────
// MuAPI uses the model slug as the endpoint and accepts params as-is from
// the schema_data.json shape. The response shape varies per endpoint but
// usually exposes a result URL field — we normalize.

async function runOnMuApi(slug: string, params: Record<string, unknown>, apiKey: string): Promise<RunResult> {
  // MuAPI rejects data: URLs — convert any to MuAPI-hosted S3 URLs first.
  // Cached so re-runs of the same image don't re-upload.
  const hosted = await uploadDataUrlsInPayload(apiKey, params)
  const data = await callMuApi(apiKey, slug, hosted) as { request_id?: string }
  const requestId = data.request_id
  if (!requestId) {
    // Some endpoints return a synchronous result — try the picker on raw.
    const url = pickUrl(data) ?? ''
    return { kind: inferKind(slug), url, route: 'muapi', raw: data }
  }
  const polled = await pollMuApi(requestId)
  return { kind: inferKind(slug), url: pickUrl(polled) ?? '', route: 'muapi', raw: polled }
}

// MuAPI's actual async pattern (per their ComfyUI nodes source):
//   GET /api/v1/predictions/{request_id}/result   ← note the /result suffix
// Response is wrapped in `detail`:
//   { detail: { id, status: "completed"|"failed"|"processing", outputs: [...], error?: ... } }
// Routed through /api/proxy/muapi so the browser sidesteps MuAPI's CORS.
async function pollMuApi(requestId: string, timeoutMs = 600_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3_000))
    const raw = await pollMuApiViaProxy(requestId) as
      { detail?: { status?: string; error?: unknown } } & { status?: string }
    const body = raw.detail ?? raw
    const status = (body as { status?: string }).status
    if (status === 'completed' || status === 'succeeded') return body
    if (status === 'failed') {
      const errVal = (body as { error?: unknown }).error
      const errMsg = typeof errVal === 'string' ? errVal
                    : typeof errVal === 'object' && errVal && 'message' in errVal
                      ? String((errVal as { message: unknown }).message)
                      : JSON.stringify(errVal ?? 'unknown error')
      throw new Error(`Loometo task failed: ${errMsg}`)
    }
    // processing / queued / etc. — keep polling.
  }
  throw new Error('Loometo task timed out')
}

// MuAPI result URLs sit in any of these shapes (one model per shape,
// no consistent contract — every new model line tends to invent its
// own envelope):
//   { outputs: [url1, ...] }                         ← old API
//   { outputs: [{ url }, ...] }                       ← Seedance 2.x, GPT Image 2
//   { outputs: [{ video_url }] } / [{ image_url }]   ← seen in some video models
//   { output: [...] } / { output: url }
//   { image_url } / { video_url } / { audio_url } / { url }
//   { result: { url } } / { result: { outputs: [{ url }] } }
//   { data: [{ url }] } (legacy)
// When NOTHING matches we log the raw body so we can extend this list.
function pickUrl(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | undefined
  if (!d) return undefined

  // outputs[] — accept string OR object-with-url-like-field
  const outputs = d.outputs as unknown[] | undefined
  if (Array.isArray(outputs) && outputs.length > 0) {
    const first = outputs[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>
      for (const k of ['url', 'video_url', 'image_url', 'audio_url', 'model']) {
        if (typeof o[k] === 'string') return o[k] as string
      }
    }
  }

  // output (singular) — string, array, or object
  const output = d.output
  if (typeof output === 'string') return output
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>
      for (const k of ['url', 'video_url', 'image_url', 'audio_url', 'model']) {
        if (typeof o[k] === 'string') return o[k] as string
      }
    }
  }
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>
    for (const k of ['url', 'video_url', 'image_url', 'audio_url', 'model']) {
      if (typeof o[k] === 'string') return o[k] as string
    }
  }

  // Top-level url-shaped fields
  for (const k of ['video_url', 'image_url', 'audio_url', 'url', 'model']) {
    const v = d[k]
    if (typeof v === 'string') return v
  }

  // result.{url|outputs|video_url|...}
  const result = d.result as Record<string, unknown> | undefined
  if (result) {
    for (const k of ['url', 'video_url', 'image_url', 'audio_url', 'model']) {
      if (typeof result[k] === 'string') return result[k] as string
    }
    const resOutputs = result.outputs as unknown[] | undefined
    if (Array.isArray(resOutputs) && resOutputs.length > 0) {
      const first = resOutputs[0]
      if (typeof first === 'string') return first
      if (first && typeof first === 'object') {
        const o = first as Record<string, unknown>
        for (const k of ['url', 'video_url', 'image_url', 'audio_url', 'model']) {
          if (typeof o[k] === 'string') return o[k] as string
        }
      }
    }
  }

  // data: [{ url }]
  const arr = d.data as Array<Record<string, unknown>> | undefined
  if (Array.isArray(arr) && arr[0]) {
    for (const k of ['url', 'video_url', 'image_url', 'audio_url', 'model']) {
      if (typeof arr[0][k] === 'string') return arr[0][k] as string
    }
  }

  // Nothing matched — log raw body so we can grow this list without
  // requiring another silent-failure incident.
  console.warn('[pickUrl] No URL field recognized in response body. Add a new shape branch to pickUrl. Raw body:', JSON.stringify(data).slice(0, 1000))
  return undefined
}

// Infer result kind from the model's category (set when the workflow store
// loads capabilities). For now we rely on the slug's naming convention.
function inferKind(slug: string): RunResultKind {
  if (/-t2v|-i2v|video|veo|kling|sora|wan|seedance|hailuo|hunyuan|pixverse|ltx|vidu/i.test(slug)) return 'video'
  if (/-3d|meshy/i.test(slug)) return '3d'
  if (/lipsync|music|audio|tts|suno/i.test(slug)) return 'audio'
  return 'image'
}

// ─── OpenAI direct ───────────────────────────────────────────────────

async function runOnOpenAi(slug: string, params: Record<string, unknown>, apiKey: string): Promise<RunResult> {
  // DALL-E + GPT-Image
  if (slug.startsWith('dall-e-') || slug.startsWith('gpt-image-')) {
    const r = await generateImageOpenAI(apiKey, {
      model: slug,
      prompt: String(params.prompt ?? ''),
      size: params.size as never,
      quality: params.quality as never,
      style: params.style as never,
      n: params.n as number,
    })
    return { kind: 'image', url: r.imageUrl, route: 'openai-direct', raw: r.raw }
  }
  // Sora 2 — translate MuAPI's snake_case to OpenAI's
  if (slug.includes('sora-2')) {
    const isPro = slug.includes('pro')
    const model = isPro ? 'sora-2-pro' : 'sora-2'
    const aspect = (params.aspect_ratio as string) ?? '16:9'
    const res = (params.resolution as string) ?? '720p'
    const size = sizeFor(aspect, res)
    const r = await generateVideoOpenAI(apiKey, {
      model,
      prompt: String(params.prompt ?? ''),
      seconds: params.duration as number,
      size,
      inputReference: (params.images_list as string[])?.[0] || (params.image_url as string),
    })
    return { kind: 'video', url: r.videoUrl, route: 'openai-direct', raw: r.raw }
  }
  throw new Error(`OpenAI direct adapter doesn't know how to run ${slug}`)
}

function sizeFor(aspect: string, res: string): '720x1280' | '1280x720' | '1080x1920' | '1920x1080' {
  if (res === '1080p') return aspect === '9:16' ? '1080x1920' : '1920x1080'
  return aspect === '9:16' ? '720x1280' : '1280x720'
}

// ─── Google direct ───────────────────────────────────────────────────

async function runOnGoogle(slug: string, params: Record<string, unknown>, apiKey: string): Promise<RunResult> {
  // Imagen 4 variants
  if (slug.startsWith('google-imagen4')) {
    const r = await generateImageGoogle(apiKey, {
      model: slug === 'google-imagen4-ultra' ? 'imagen-4.0-ultra-generate-001'
           : slug === 'google-imagen4-fast' ? 'imagen-4.0-fast-generate-001'
           : 'imagen-4.0-generate-001',
      prompt: String(params.prompt ?? ''),
      aspectRatio: (params.aspect_ratio as string) ?? '1:1',
    })
    return { kind: 'image', url: r.imageUrl, route: 'google-direct', raw: r.raw }
  }
  // Nano Banana family. Map our MuAPI slug → Google's current model id:
  //   nano-banana / nano-banana-edit       → gemini-2.5-flash-image (fast, cheaper)
  //   nano-banana-pro / nano-banana-pro-edit → gemini-3-pro-image-preview (premium)
  // (Google deprecated the *-preview suffix on gemini-2.5-flash-image and
  // added a new -preview on the pro line — names had drifted from our old
  // strings, so ListModels was the source of truth.)
  if (slug.startsWith('nano-banana')) {
    const isPro = /(?:^|-)pro(?:-|$)/.test(slug)
    const model = isPro ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image'
    const refs = (params.images_list as string[]) ?? (params.image_url ? [String(params.image_url)] : undefined)
    // Normalize UI's "1k"|"2k"|"4k" to Google's "1K"|"2K"|"4K". Default
    // Pro to 2K — sharp enough to zoom without distortion, half the cost
    // of 4K, much faster. User can override per-node via the dropdown.
    const rawSize = typeof params.resolution === 'string' ? params.resolution.toUpperCase() : ''
    const imageSize: '1K' | '2K' | '4K' | undefined =
      rawSize === '1K' || rawSize === '2K' || rawSize === '4K'
        ? rawSize
        : (isPro ? '2K' : undefined)
    const aspectRatio = typeof params.aspect_ratio === 'string'
      ? (params.aspect_ratio as '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4')
      : undefined
    const r = await generateImageNanoBanana(apiKey, {
      model,
      prompt: String(params.prompt ?? ''),
      referenceImages: refs,
      imageSize,
      aspectRatio,
    })
    return { kind: 'image', url: r.imageUrl, route: 'google-direct', raw: r.raw }
  }
  // Veo 3 / 3.1. Map our MuAPI-style slug → Google's current model id:
  //   veo3.1-fast-image-to-video → veo-3.1-fast-generate-preview
  //   veo3.1-image-to-video       → veo-3.1-generate-preview
  //   veo3-fast-image-to-video    → veo-3.0-fast-generate-001
  //   veo3-image-to-video         → veo-3.0-generate-001
  // (3.1 family is still -preview as of 2026-05; 3.0 GA'd as -001.)
  if (slug.startsWith('veo3')) {
    const is31   = slug.includes('3.1')
    const isFast = slug.includes('fast')
    const isLite = slug.includes('lite')
    const model = is31
      ? (isLite ? 'veo-3.1-lite-generate-preview'
                : isFast ? 'veo-3.1-fast-generate-preview'
                         : 'veo-3.1-generate-preview')
      : (isFast ? 'veo-3.0-fast-generate-001' : 'veo-3.0-generate-001')
    // Veo accepts duration in seconds (4/6/8). Aspect 16:9 or 9:16.
    // Veo 3.1+ supports last_frame for transitions.
    const r = await generateVideoVeo(apiKey, {
      model,
      prompt: String(params.prompt ?? ''),
      imageUrl: params.image_url as string | undefined,
      lastImageUrl: is31 ? (params.last_image as string | undefined) : undefined,
      durationSeconds: (params.duration as 4 | 6 | 8) ?? 8,
      aspectRatio: (params.aspect_ratio as '16:9' | '9:16') ?? '16:9',
      resolution: (params.resolution as '720p' | '1080p') ?? '1080p',
    })
    return { kind: 'video', url: r.videoUrl, route: 'google-direct', raw: r.raw }
  }
  throw new Error(`Google direct adapter doesn't know how to run ${slug}`)
}

// ─── Meshy direct ────────────────────────────────────────────────────

async function runOnMeshy(slug: string, params: Record<string, unknown>, apiKey: string): Promise<RunResult> {
  if (slug === 'meshy-image-to-3d') {
    const r = await generateImageTo3D(apiKey, { imageUrl: String(params.image_url ?? '') })
    return { kind: '3d', url: r.glbUrl ?? '', thumbnailUrl: r.thumbnailUrl, route: 'meshy-direct', raw: r.raw }
  }
  if (slug === 'meshy-text-to-3d') {
    const r = await generateTextTo3D(apiKey, { prompt: String(params.prompt ?? '') })
    return { kind: '3d', url: r.glbUrl ?? '', thumbnailUrl: r.thumbnailUrl, route: 'meshy-direct', raw: r.raw }
  }
  throw new Error(`Meshy direct adapter doesn't know how to run ${slug}`)
}
