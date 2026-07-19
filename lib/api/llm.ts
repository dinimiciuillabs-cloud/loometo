// LLM dispatcher. Unlike runModel (media generation), LLM calls return
// text — so they need their own surface.
//
// Three providers: OpenAI direct, Google Gemini direct, MuAPI (reseller
// that exposes Claude + others). Each "LLM node" in the UI shows three
// pills, the user picks a provider, the model dropdown filters to that
// provider's roster, and runLLM() routes to the right adapter.

import type { APIKeys } from '@/lib/store/workflowStore'
import { userKeyHeader } from '@/lib/api/userKeys'
import { runLLMOpenAI, enhancePromptOpenAI, describeImageOpenAI, transcribeAudioOpenAI, ttsOpenAI } from './openai'
import { runLLMGemini, enhancePromptGemini, describeImageGemini, transcribeAudioGemini, ttsGemini } from './google'

export type LLMProvider = 'openai' | 'google' | 'muapi' | 'elevenlabs' | 'meshy'

export interface LLMOption {
  provider: LLMProvider
  // Provider-native model id. For openai: 'gpt-4o' etc; for google:
  // 'gemini-2.0-flash' etc; for muapi: the model slug from schema_data.json.
  model: string
  name: string                 // user-facing display
  description?: string
  vision?: boolean             // accepts images
  cost?: '$' | '$$' | '$$$'    // rough tier badge
}

// Curated roster — these are the models worth surfacing. Add more here when
// new ones land; the UI auto-picks up changes.
export const LLM_MODELS: LLMOption[] = [
  // ── OpenAI direct ────────────────────────────────────────────────
  { provider: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast + cheap, multimodal',          vision: true, cost: '$'   },
  { provider: 'openai', model: 'gpt-4o',      name: 'GPT-4o',      description: 'Best general OpenAI, multimodal',   vision: true, cost: '$$'  },
  { provider: 'openai', model: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Powerful reasoning, vision',         vision: true, cost: '$$$' },
  { provider: 'openai', model: 'gpt-5-mini',  name: 'GPT-5 Mini',  description: 'Newest OpenAI, cheap tier',          vision: true, cost: '$$'  },
  { provider: 'openai', model: 'gpt-5-nano',  name: 'GPT-5 Nano',  description: 'Fastest, text-only',                 vision: false, cost: '$'  },

  // ── Google Gemini direct ─────────────────────────────────────────
  // gemini-2.0-flash was deprecated for new users in 2026-05 — keep
  // 2.5+ only. ListModels on this account shows: gemini-2.5-flash,
  // gemini-2.5-pro, gemini-3-flash-preview, gemini-3-pro-preview.
  { provider: 'google', model: 'gemini-2.5-flash',         name: 'Gemini 2.5 Flash',     description: 'Fast + cheap, multimodal',  vision: true, cost: '$'   },
  { provider: 'google', model: 'gemini-2.5-pro',           name: 'Gemini 2.5 Pro',       description: 'Top Gemini reasoning',      vision: true, cost: '$$'  },
  { provider: 'google', model: 'gemini-3-flash-preview',   name: 'Gemini 3 Flash',       description: 'Newest fast tier (preview)', vision: true, cost: '$'   },
  { provider: 'google', model: 'gemini-3-pro-preview',     name: 'Gemini 3 Pro',         description: 'Newest premium (preview)',   vision: true, cost: '$$'  },

  // ── MuAPI text-to-text ───────────────────────────────────────────
  // Slugs come from public/muapi-schema.json's "Text to Text" category.
  { provider: 'muapi',  model: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Anthropic — best writing + reasoning', vision: true,  cost: '$$'  },
  { provider: 'muapi',  model: 'claude-opus-4-6',  name: 'Claude Opus 4.6',  description: 'Anthropic premium tier',                vision: true,  cost: '$$$' },
  { provider: 'muapi',  model: 'gemini-3-flash',   name: 'Gemini 3 Flash',   description: 'Google fast tier via MuAPI',            vision: true,  cost: '$'   },
  { provider: 'muapi',  model: 'gpt-5-mini',      name: 'GPT-5 Mini',       description: 'OpenAI via MuAPI',                      vision: true,  cost: '$$'  },
  { provider: 'muapi',  model: 'gpt-5-nano',      name: 'GPT-5 Nano',       description: 'OpenAI fast tier via MuAPI',            vision: false, cost: '$'   },
  { provider: 'muapi',  model: 'gpt-5-4',         name: 'GPT-5.4',          description: 'OpenAI flagship via MuAPI',             vision: true,  cost: '$$$' },
  { provider: 'muapi',  model: 'gpt-codex',       name: 'GPT Codex',        description: 'OpenAI coding model via MuAPI',         vision: false, cost: '$$'  },
  { provider: 'muapi',  model: 'any-llm',         name: 'Any LLM',          description: 'MuAPI meta-router — picks for you',     vision: true,  cost: '$$'  },
  { provider: 'muapi',  model: 'openrouter-vision', name: 'OpenRouter Vision', description: 'Multi-model vision via OpenRouter',  vision: true,  cost: '$$'  },
]

export function modelsForProvider(provider: LLMProvider, opts?: { vision?: boolean }): LLMOption[] {
  return LLM_MODELS.filter(m =>
    m.provider === provider && (opts?.vision ? !!m.vision : true)
  )
}

// Returns the provider key field on the API keys bag, for use in checks
// like "does the user have this provider lit up?".
export function providerKeyField(provider: LLMProvider): keyof APIKeys {
  return provider === 'openai' ? 'openai'
       : provider === 'google' ? 'google'
       : provider === 'elevenlabs' ? 'elevenlabs'
       : provider === 'meshy' ? 'meshy'
       : 'muapi'
}

export interface RunLLMArgs {
  provider: LLMProvider
  model: string
  message: string
  imageUrl?: string                  // for vision models
  systemPrompt?: string              // optional system instructions
  apiKeys: Partial<APIKeys>
}

// Single entry point. Returns plain text.
export async function runLLM(args: RunLLMArgs): Promise<string> {
  const key = args.apiKeys[providerKeyField(args.provider)]
  if (!key) throw new Error(`No ${args.provider} API key — add one in API Keys panel`)

  switch (args.provider) {
    case 'openai':
      return runLLMOpenAI(key, args.model, args.message, args.imageUrl)
    case 'google':
      return runLLMGemini(key, args.model, args.message, args.imageUrl)
    case 'muapi':
      return runLLMMuApi(key, args.model, args.message, args.imageUrl)
    case 'elevenlabs':
      // ElevenLabs is TTS-only — no LLM endpoint. Surface a clear
      // error if any node accidentally routes a runLLM through it.
      throw new Error('ElevenLabs is TTS-only. Use the Text → Speech node instead.')
    case 'meshy':
      // Meshy is a 3D provider — no LLM endpoint.
      throw new Error('Meshy is a 3D provider. Use the Image → 3D node instead.')
  }
}

// MuAPI Text-to-Text dispatch. The schema's "Text to Text" endpoints
// accept a message/prompt field — exact shape varies per model. We use
// a forgiving payload covering the common variants and let the server
// pick. If a specific MuAPI model has a different surface, surface the
// error to the user so they can switch model or provider.
async function runLLMMuApi(_apiKey: string, modelSlug: string, userPrompt: string, imageUrl?: string | string[], systemPrompt?: string): Promise<string> {
  // MuAPI LLM models follow a consistent contract per their docs:
  //   { prompt, image_url?, system_prompt? }   ← gemini-3-flash,
  //   gpt-5-mini, claude-haiku-4, etc.
  // We send ONLY documented fields. Sending unknown fields like
  // `message` or `images_list` previously risked 422s on strict
  // schemas. Multi-image LLM calls would need per-model handling —
  // not all MuAPI LLM endpoints accept images_list.
  // MuAPI exposes ONE LLM endpoint: `any-llm`. Each model is a param
  // value from its enum, NOT a standalone slug. Posting the model name as
  // the slug hits a nonexistent endpoint that hangs open. Map our
  // internal ids → the real any-llm enum values and always call any-llm.
  const ANY_LLM_MODEL: Record<string, string> = {
    'gemini-3-flash':    'google/gemini-2.5-flash',
    'gpt-5-mini':        'openai/gpt-4o',
    'gpt-5-nano':        'google/gemini-2.0-flash-lite-001',
    'gpt-5-4':           'openai/gpt-4.1',
    'gpt-codex':         'openai/gpt-4.1',
    'claude-sonnet-4-6': 'anthropic/claude-3.5-sonnet',
    'claude-opus-4-6':   'anthropic/claude-3.5-sonnet',
    'openrouter-vision': 'google/gemini-2.5-flash',
  }
  const params: Record<string, unknown> = {
    prompt: userPrompt,
    model: ANY_LLM_MODEL[modelSlug] ?? 'google/gemini-2.5-flash',
    // any-llm requires system_prompt (the schema under-declares it as
    // optional but the live API 422s without it). Default when unset.
    system_prompt: systemPrompt || 'You are a helpful assistant. Follow the user instruction precisely and return only the requested output.',
  }
  const rawUrls = Array.isArray(imageUrl) ? imageUrl : imageUrl ? [imageUrl] : []
  // MuAPI's LLM endpoints validate image_url as a URL with max length
  // 2083 chars — a base64 data URL blows past that on the first byte.
  // Upload any data: URLs to R2 first and substitute the hosted https
  // URL (~80 chars) before sending.
  const hostedUrls: string[] = []
  for (const u of rawUrls) {
    if (u.startsWith('data:')) {
      const { uploadToR2 } = await import('@/lib/store/r2Upload')
      const up = await uploadToR2(u, { prefix: 'llm-inputs' })
      hostedUrls.push(up.url)
    } else {
      hostedUrls.push(u)
    }
  }
  if (hostedUrls.length > 0) {
    // MuAPI LLM models documented today accept single `image_url`
    // only. If a caller passes multiple refs, take the first and warn
    // in the console so we know to extend per-model when MuAPI adds
    // multi-image LLM endpoints.
    params.image_url = hostedUrls[0]
    if (hostedUrls.length > 1) {
      console.warn(`[runLLMMuApi ${modelSlug}] received ${hostedUrls.length} images but the MuAPI LLM contract documents image_url (single) only — sending the first, dropping the rest.`)
    }
  }
  // Route through /api/proxy/muapi — direct calls to api.muapi.ai get
  // CORS-blocked from the browser (MuAPI's preflight doesn't echo our
  // origin). The proxy attaches MUAPI_API_KEY server-side.
  // 90s timeout — MuAPI LLM calls occasionally hang open with no
  // response; without an abort the node spins "Generating…" forever.
  let res: Response
  try {
    res = await fetch('/api/proxy/muapi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userKeyHeader('muapi') },
      body: JSON.stringify({ kind: 'generate', slug: 'any-llm', params }),
      signal: AbortSignal.timeout(90000),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error(`Loometo LLM ${modelSlug} timed out after 90s — try Gemini (Google direct) or a different model.`)
    }
    throw e
  }
  if (!res.ok) {
    // Surface MuAPI's actual rejection reason. Their 422 bodies vary:
    //   { detail: [{ msg, loc }] }      ← FastAPI validation errors
    //   { error: 'message' }
    //   { message: '...' }
    //   plain text
    const raw = await res.text()
    let detail = raw.slice(0, 400)
    try {
      const j = JSON.parse(raw)
      if (typeof j.error === 'string') detail = j.error
      else if (typeof j.message === 'string') detail = j.message
      else if (Array.isArray(j.detail)) {
        detail = j.detail.map((d: { loc?: unknown[]; msg?: string }) =>
          `${(d.loc ?? []).join('.')}: ${d.msg}`).join(' · ')
      } else if (typeof j.detail === 'string') detail = j.detail
    } catch { /* keep raw text */ }
    throw new Error(`Loometo LLM ${modelSlug} HTTP ${res.status}: ${detail}`)
  }
  const data = await res.json() as Record<string, unknown>
  // any-llm is ASYNC: submit returns { request_id, status:'processing' };
  // the text arrives via polling /predictions/{id}/result → { outputs:[…] }.
  const requestId = data.request_id as string | undefined
  if (!requestId) return extractLLMText(data)

  const { pollMuApiViaProxy } = await import('./muapi')
  for (let i = 0; i < 45; i++) {           // ~90s cap (45 × 2s)
    await new Promise(r => setTimeout(r, 2000))
    const polled = await pollMuApiViaProxy(requestId) as Record<string, unknown>
    const body = (polled.detail ?? polled) as Record<string, unknown>
    const status = body.status as string | undefined
    if (status === 'completed') return extractLLMText(body)
    if (status === 'failed' || body.error) {
      throw new Error(`Loometo LLM failed: ${(body.error as string) || 'unknown error'}`)
    }
  }
  throw new Error('Loometo LLM timed out after 90s — try Gemini (Google direct).')
}

// Pull the assistant text out of any-llm's result shape (outputs:[str])
// or the various sync shapes older MuAPI models used.
function extractLLMText(d: Record<string, unknown>): string {
  const outputs = d.outputs
  if (Array.isArray(outputs) && typeof outputs[0] === 'string') return outputs[0]
  if (typeof d.output === 'string') return d.output
  if (typeof d.response === 'string') return d.response
  if (typeof d.content === 'string') return d.content
  if (typeof d.text === 'string') return d.text
  const choices = d.choices as Array<{ message?: { content?: string } }> | undefined
  if (choices?.[0]?.message?.content) return choices[0].message.content
  return JSON.stringify(d)
}

// Convenience wrappers — same provider switching for the
// description/enhance flows so node code stays tiny.
export async function runEnhance(args: { provider: LLMProvider; model?: string; prompt: string; apiKeys: Partial<APIKeys> }): Promise<string> {
  const key = args.apiKeys[providerKeyField(args.provider)]
  if (!key) throw new Error(`No ${args.provider} API key`)
  if (args.provider === 'openai') return enhancePromptOpenAI(key, args.prompt, args.model)
  if (args.provider === 'google') return enhancePromptGemini(key, args.prompt, args.model)
  return runLLMMuApi(key, args.model ?? 'gpt-5-mini', `Rewrite this prompt with more cinematic detail. Return ONLY the new prompt.\n\nPrompt: ${args.prompt}`)
}

export async function runDescribeImage(args: { provider: LLMProvider; model?: string; imageUrl: string; apiKeys: Partial<APIKeys> }): Promise<string> {
  const key = args.apiKeys[providerKeyField(args.provider)]
  if (!key) throw new Error(`No ${args.provider} API key`)
  if (args.provider === 'openai') return describeImageOpenAI(key, args.imageUrl)
  if (args.provider === 'google') return describeImageGemini(key, args.imageUrl)
  return runLLMMuApi(key, args.model ?? 'openrouter-vision', 'Describe this image in rich detail as a prompt for AI image generation.', args.imageUrl)
}

// Image → structured JSON description. The LLM is told to output ONLY a
// JSON object — no commentary, no markdown — describing every visible
// detail at a level a downstream image-generation model can re-create
// the scene from text alone. The `kind` hint steers the schema toward
// what the caller cares about (location, person, product, or generic).
export type ImageToJsonKind = 'auto' | 'location' | 'person' | 'product'

function imageToJsonSystemPrompt(kind: ImageToJsonKind): string {
  const base = `You are a forensic image-to-JSON describer. Your only output is a valid JSON object — no prose, no markdown fences, no commentary. Capture EVERY visible detail at a level a separate text-to-image model could reproduce the scene without seeing the photo.

General rules:
- Output ONE top-level JSON object. Nest freely.
- Be specific: name colours, materials, brand wordmarks, signage text, fixtures, lighting direction, weather.
- If text is visible on signs, posters, vehicles, etc., quote it verbatim under a "text" field.
- Do NOT speculate beyond what's visible. If something is partial / obscured, say so.
- Do NOT add a top-level "description" field that paraphrases everything — the JSON itself is the description.`

  if (kind === 'location') {
    return base + `

For LOCATIONS (buildings, interiors, exteriors, environments), aim for keys like:
  image_metadata (filename if known, orientation, lighting, setting),
  environment (sky, weather, ground/floor materials, markings, features),
  main_building or main_space (branding/wordmarks, logos, architectural style, levels, materials, facade_details split into left/center/right/back as appropriate, tenant_logos with positions, fixtures, lighting hardware),
  vehicles or objects (foreground rows left-to-right with type/colour/make/notable features),
  people_and_activity (group/positions/notable details — DO NOT describe individual faces; this is for context only),
  reflections, signage_text.`
  }
  if (kind === 'person') {
    return base + `

For PEOPLE, aim for keys like:
  identity (apparent gender, age range, ethnicity if obvious, hair colour and style, facial hair, eye colour, skin tone, build),
  face (notable features — only what's visible: glasses, freckles, jawline, expression),
  clothing (top: garment / colour / pattern / fit; bottom; outerwear; accessories),
  pose_and_framing (camera angle, distance, body posture, what's visible — head/chest/full-body),
  lighting (direction, quality, colour temperature on skin),
  background (only general — out-of-focus, indoor/outdoor, dominant colour).`
  }
  if (kind === 'product') {
    return base + `

For PRODUCTS, aim for keys like:
  product (category, brand wordmark if visible, model name if visible),
  form_factor (shape, dimensions ratio, materials, surface finish),
  colourway (primary, secondary, accent colours with rough hex if possible),
  labels_and_text (verbatim text on the product),
  packaging (if visible),
  staging (background, surface, lighting, reflections, props nearby).`
  }
  return base + `

Decide the appropriate top-level keys based on the image content. Common patterns: image_metadata, environment, main_subject, supporting_subjects, lighting, text_seen, palette.`
}

export async function runImageToJson(args: {
  provider: LLMProvider
  model: string
  imageUrls: string[]              // 1-5 images of the same subject — LLM consolidates into one JSON
  kind?: ImageToJsonKind
  // Optional extra direction the user gives this specific extraction
  // (e.g. "include hex codes for every visible colour", "list every
  // logo separately with its position"). Appended to the system rules.
  extraInstructions?: string
  // Optional negative instructions — what to AVOID in the JSON
  // (e.g. "don't speculate about brands not visible", "skip background
  // crowd details"). Appended as a separate AVOID block.
  negativeInstructions?: string
  apiKeys: Partial<APIKeys>
}): Promise<string> {
  const key = args.apiKeys[providerKeyField(args.provider)]
  if (!key) throw new Error(`No ${args.provider} API key — add one in API Keys panel`)
  if (!args.imageUrls.length) throw new Error('Wire at least one image into the node first.')
  let system = imageToJsonSystemPrompt(args.kind ?? 'auto')
  const extra = args.extraInstructions?.trim()
  const neg = args.negativeInstructions?.trim()
  if (extra) {
    system += `\n\nADDITIONAL EXTRACTION DIRECTION (from caller — apply on top of the system rules):\n${extra}`
  }
  if (neg) {
    system += `\n\nAVOID in the JSON (negative rules — do NOT include or speculate about these):\n${neg}`
  }
  const multi = args.imageUrls.length > 1
  const userInstruction = multi
    ? `Describe the ${args.imageUrls.length} attached images of the SAME subject (different angles / conditions) as a single consolidated JSON object per the system rules. Cross-reference details visible in multiple images for confidence; mark fields that vary or are partial.`
    : 'Describe the attached image as a single valid JSON object per the system rules.'
  let raw: string
  // Image→JSON outputs can be long when the user adds verbose Extra
  // Direction (hex codes for every colour, per-region descriptions,
  // etc.). Gemini 2.5/3.x also burns "thinking" tokens out of the
  // same maxOutputTokens budget, so we request a generous 16384 to
  // avoid the mid-JSON truncations seen on 2026-05-30.
  const generousMaxTokens = 16384
  if (args.provider === 'openai') {
    raw = await runLLMOpenAI(key, args.model, userInstruction, args.imageUrls, system, { maxTokens: generousMaxTokens })
  } else if (args.provider === 'google') {
    raw = await runLLMGemini(key, args.model, `${system}\n\n${userInstruction}`, args.imageUrls, { maxOutputTokens: generousMaxTokens })
  } else {
    // MuAPI LLM models accept system_prompt as a separate field — keep
    // them split so the model sees its own system instruction rather
    // than treating everything as a user message.
    raw = await runLLMMuApi(key, args.model, userInstruction, args.imageUrls, system)
  }
  // Strip a ```json fence if the model insisted on one despite our rules.
  return raw.trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}

// Voice catalogs per provider. Exposed for the TTS node's voice picker.
export const TTS_VOICES: Record<LLMProvider, Array<{ id: string; name: string }>> = {
  openai: [
    { id: 'nova',    name: 'Nova (female, bright)' },
    { id: 'alloy',   name: 'Alloy (neutral, smooth)' },
    { id: 'echo',    name: 'Echo (male, calm)' },
    { id: 'fable',   name: 'Fable (storyteller, warm)' },
    { id: 'onyx',    name: 'Onyx (male, deep)' },
    { id: 'shimmer', name: 'Shimmer (female, soft)' },
    { id: 'ash',     name: 'Ash (male, mellow)' },
    { id: 'ballad',  name: 'Ballad (expressive)' },
    { id: 'coral',   name: 'Coral (female, friendly)' },
    { id: 'sage',    name: 'Sage (neutral, wise)' },
    { id: 'verse',   name: 'Verse (poetic)' },
  ],
  google: [
    { id: 'Kore',   name: 'Kore (warm, neutral)' },
    { id: 'Puck',   name: 'Puck (upbeat, playful)' },
    { id: 'Charon', name: 'Charon (deep, calm)' },
    { id: 'Fenrir', name: 'Fenrir (commanding)' },
    { id: 'Aoede',  name: 'Aoede (musical, light)' },
    { id: 'Leda',   name: 'Leda (clear, professional)' },
    { id: 'Orus',   name: 'Orus (resonant)' },
    { id: 'Zephyr', name: 'Zephyr (airy, soft)' },
  ],
  muapi: [
    { id: 'Wise_Woman',          name: 'Wise Woman (mature, warm)' },
    { id: 'Friendly_Person',     name: 'Friendly Person (neutral)' },
    { id: 'Inspirational_girl',  name: 'Inspirational Girl' },
    { id: 'Deep_Voice_Man',      name: 'Deep Voice Man' },
    { id: 'Calm_Woman',          name: 'Calm Woman' },
    { id: 'Casual_Guy',          name: 'Casual Guy' },
  ],
  // Premade voice IDs from ELEVENLABS_PREMADE_VOICES. Cloned voices
  // can be discovered at runtime via fetchElevenLabsVoices() — the TTS
  // node merges them in when the user has the ElevenLabs key set.
  elevenlabs: [
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (calm, warm female narrator)' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (strong, confident female)' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (soft, friendly female — UGC tone)' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (emotional, expressive young female)' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (well-rounded male narrator)' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (deep, warm male)' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (crisp, confident male)' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (deep, gravelly male)' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam (casual, raspy male — UGC tone)' },
  ],
  // Meshy is a 3D provider, not a voice provider — no TTS voices. Present
  // only so Record<LLMProvider> stays exhaustive (same pattern as the
  // elevenlabs entry living in the image/video provider maps).
  meshy: [],
}

export interface RunTTSArgs {
  provider: LLMProvider
  text: string
  voice?: string
  instructions?: string
  apiKeys: Partial<APIKeys>
}

// Text → speech audio. Returns a data URL (mp3) the rest of the app can
// pipe into the Lip Sync node, audio preview, or download.
export async function runTTS(args: RunTTSArgs): Promise<string> {
  const key = args.apiKeys[providerKeyField(args.provider)]
  if (!key) throw new Error(`No ${args.provider} API key`)
  if (args.provider === 'openai') {
    const r = await ttsOpenAI(key, {
      text: args.text,
      voice: args.voice as never,
      instructions: args.instructions,
    })
    return r.audioUrl
  }
  if (args.provider === 'google') {
    const r = await ttsGemini(key, {
      text: args.text,
      voice: args.voice,
      instructions: args.instructions,
    })
    return r.audioUrl
  }
  if (args.provider === 'elevenlabs') {
    const { ttsElevenLabs, ELEVENLABS_PREMADE_VOICES } = await import('./elevenlabs')
    // Voice param is ElevenLabs voice_id. Default to first premade
    // voice (Rachel) if the caller didn't pick one — keeps the node
    // usable without forcing the user to pick from the dropdown first.
    const voiceId = args.voice || ELEVENLABS_PREMADE_VOICES[0].id
    const r = await ttsElevenLabs(key, { text: args.text, voiceId })
    return r.url
  }
  // MuAPI: MiniMax Speech 2.6 (turbo for cost, hd for quality).
  // Slug minimax-speech-2.6-turbo / minimax-speech-2.6-hd.
  const slug = 'minimax-speech-2.6-turbo'
  const res = await fetch(`https://api.muapi.ai/api/v1/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      text: args.text,
      voice_id: args.voice ?? 'Wise_Woman',
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Loometo TTS failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  // MuAPI minimax-speech returns an audio URL in output.audio_url or similar.
  const url = (data as { output?: { audio_url?: string }; audio_url?: string }).output?.audio_url
            ?? (data as { audio_url?: string }).audio_url
  if (!url) throw new Error('Loometo TTS: no audio URL in response')
  return url
}

// Audio → text. Whisper for OpenAI, Gemini 2.5 Flash for Google.
// MuAPI doesn't expose Whisper directly in our schema snapshot, so the
// muapi route falls back to its any-llm router which may or may not
// accept audio — surface error if it fails.
export async function runTranscribeAudio(args: {
  provider: LLMProvider
  model?: string
  audioUrl: string
  language?: string
  apiKeys: Partial<APIKeys>
}): Promise<string> {
  const key = args.apiKeys[providerKeyField(args.provider)]
  if (!key) throw new Error(`No ${args.provider} API key`)
  if (args.provider === 'openai') return transcribeAudioOpenAI(key, args.audioUrl, { language: args.language })
  if (args.provider === 'google') return transcribeAudioGemini(key, args.audioUrl, { language: args.language })
  // MuAPI fallback: pass audio_url to a vision/audio-capable LLM. Not all
  // muapi text-to-text endpoints accept audio — this will error on most.
  throw new Error('Loometo audio transcription is not supported by this app. Use OpenAI (Whisper) or Google (Gemini 2.5 Flash) directly.')
}
