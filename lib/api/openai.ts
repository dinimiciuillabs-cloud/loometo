export const OPENAI_IMAGE_MODELS = [
  { id: 'dall-e-3',    name: 'DALL-E 3',    description: 'Highest quality, best prompt following', cost: '$$'  },
  { id: 'dall-e-2',    name: 'DALL-E 2',    description: 'Faster, good for iterations',            cost: '$'   },
  { id: 'gpt-image-1', name: 'GPT Image 1', description: 'Latest OpenAI image model',              cost: '$$$' },
]

export const OPENAI_LLM_MODELS = [
  { id: 'gpt-4o',      name: 'GPT-4o',      description: 'Best overall, handles images too', cost: '$$'  },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & cheap',                     cost: '$'   },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Powerful reasoning',               cost: '$$$' },
]

// System prompt for prompt enhancement. Rules distilled from production
// experience with Kling / Veo / Sora / Seedance: sensory concrete beats
// vague-poetic, and over-enhanced prompts (>200 tokens) actually degrade
// model output. We keep it tight and rule-driven.
const ENHANCER_SYSTEM_PROMPT = `You enhance prompts for AI image / video generation. Output rules:

1. STRUCTURE: subject + setting + style. Always in that order.
2. SENSORY CONCRETE: camera (lens, angle, motion), lighting (rim, neon, golden hour, backlight), color palette, mood. Use specifics, not adjectives.
3. CAP AT ~200 TOKENS. Models DEGRADE with longer prompts. Compress, don't pad.
4. POSITIVE PHRASING ONLY. Instead of "no blur" say "tack sharp". Instead of "no people" say "uninhabited landscape".
5. FOR IMAGE-TO-VIDEO PROMPTS: describe MOTION VERBS only ("camera dollies in", "smoke rises slowly"). Do NOT redescribe the static frame — the model already has it.
6. FOR IMAGE-TO-IMAGE PROMPTS: describe what CHANGES, not the original. "Transform into anime style, cel shaded" beats "a man with brown hair... made into anime".
7. AVOID: real public figures by name, trademarked characters, sexual content. These cause model rejections.

Return ONLY the enhanced prompt. No preamble, no "Here's your prompt:", no explanation.`

export async function enhancePromptOpenAI(apiKey: string, prompt: string, model = 'gpt-4o-mini', instructions?: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions || ENHANCER_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || prompt
}

export async function describeImageOpenAI(apiKey: string, imageUrl: string, instructions?: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: instructions || 'Describe this image in rich detail as a prompt for AI image generation. Be specific about style, lighting, colors, composition, and mood.',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: 'Describe this image as a detailed AI generation prompt.' },
          ],
        },
      ],
      max_tokens: 600,
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// DALL-E + GPT-Image generation. Direct to OpenAI — typically 30-40% cheaper
// than going through MuAPI's wrapper for the same models.
//
// Endpoints:
//   POST /v1/images/generations  → DALL-E 3 / 2 / gpt-image-1
//
// Returns an image URL (DALL-E) or base64 string (gpt-image-1 with response_format=b64_json).
export async function generateImageOpenAI(apiKey: string, params: {
  model: string                                   // 'dall-e-3' | 'dall-e-2' | 'gpt-image-1'
  prompt: string
  size?: '1024x1024' | '1792x1024' | '1024x1792' | '512x512' | '256x256'
  quality?: 'standard' | 'hd'                     // dall-e-3 only
  style?: 'vivid' | 'natural'                     // dall-e-3 only
  n?: number
}): Promise<{ imageUrl: string; raw: unknown }> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: params.n ?? 1,
    size: params.size ?? '1024x1024',
  }
  if (params.model === 'dall-e-3') {
    body.quality = params.quality ?? 'standard'
    body.style = params.style ?? 'vivid'
  }
  if (params.model === 'gpt-image-1') {
    body.response_format = 'b64_json'
  }
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI image gen failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  const item = data?.data?.[0]
  if (!item) throw new Error('OpenAI image gen: empty response')
  // DALL-E returns url; gpt-image-1 with b64_json returns b64_json.
  const imageUrl = item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '')
  if (!imageUrl) throw new Error('OpenAI image gen: no url/b64 in response')
  return { imageUrl, raw: data }
}

// Sora 2 video generation via OpenAI's Videos API. Async — POST creates a
// video job, then poll GET /v1/videos/{id} until status=completed.
//
// Per OpenAI docs (deprecation date Sept 24, 2026 noted for sora-2 models —
// surface this in UI when chosen).
export async function generateVideoOpenAI(apiKey: string, params: {
  model: string                                   // 'sora-2' | 'sora-2-pro'
  prompt: string
  seconds?: number                                // 4-12 (varies by tier)
  size?: '720x1280' | '1280x720' | '1080x1920' | '1920x1080'  // portrait/landscape × 720p/1080p
  inputReference?: string                         // image URL for I2V; omit for T2V
}): Promise<{ videoUrl: string; raw: unknown }> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    seconds: params.seconds ?? 5,
    size: params.size ?? '1280x720',
  }
  if (params.inputReference) body.input_reference = params.inputReference
  const create = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!create.ok) {
    const err = await create.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI video create failed: HTTP ${create.status}`)
  }
  const job = await create.json()
  const jobId = job.id as string
  // Poll until done. Sora 2 typically takes 30-120s.
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000))
    const poll = await fetch(`https://api.openai.com/v1/videos/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!poll.ok) throw new Error(`OpenAI video poll failed: HTTP ${poll.status}`)
    const status = await poll.json()
    if (status.status === 'completed' && status.output?.[0]?.url) {
      return { videoUrl: status.output[0].url, raw: status }
    }
    if (status.status === 'failed') throw new Error(status.error?.message || 'OpenAI video generation failed')
  }
  throw new Error('OpenAI video generation timed out')
}

// Text-to-Speech. Default model is gpt-4o-mini-tts because it accepts an
// `instructions` field for style control ("speak in a cheerful, conspiratorial
// whisper"). tts-1-hd is the legacy higher-quality model without style ctrl.
// Returns an audio data URL (mp3 by default) the rest of the pipeline can
// pipe into Lip Sync.
export async function ttsOpenAI(apiKey: string, params: {
  text: string
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse'
  model?: 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd'
  instructions?: string                          // gpt-4o-mini-tts only — style/tone direction
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  speed?: number                                  // 0.25 - 4.0
}): Promise<{ audioUrl: string }> {
  const model = params.model ?? 'gpt-4o-mini-tts'
  const body: Record<string, unknown> = {
    model,
    input: params.text,
    voice: params.voice ?? 'nova',
    response_format: params.format ?? 'mp3',
  }
  // instructions only valid on gpt-4o-mini-tts
  if (model === 'gpt-4o-mini-tts' && params.instructions) {
    body.instructions = params.instructions
  }
  if (params.speed) body.speed = params.speed
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `OpenAI TTS failed: HTTP ${res.status}`)
  }
  // Response is raw audio bytes. Convert to data URL so the rest of the
  // app (Lip Sync, audio preview) can consume it via the same URL shape
  // as uploaded files.
  const blob = await res.blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  return { audioUrl: dataUrl }
}

// Whisper audio transcription. Returns plain text.
// Endpoint: POST /v1/audio/transcriptions  (multipart form-data)
// Accepts mp3/mp4/mpeg/mpga/m4a/wav/webm, up to 25MB.
export async function transcribeAudioOpenAI(apiKey: string, audioUrl: string, opts?: {
  model?: 'whisper-1' | 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe'
  language?: string                                // ISO-639-1 (en, es, etc.)
}): Promise<string> {
  // Fetch the audio (could be a data URL or remote) as a Blob. Remote
  // URLs go via /api/proxy/fetch to bypass browser CORS (R2 etc.).
  const audioFetch = audioUrl.startsWith('data:') ? audioUrl : `/api/proxy/fetch?url=${encodeURIComponent(audioUrl)}`
  const blob = await (await fetch(audioFetch)).blob()
  const form = new FormData()
  form.append('file', blob, 'audio.mp3')
  form.append('model', opts?.model ?? 'whisper-1')
  if (opts?.language) form.append('language', opts.language)
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Whisper failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.text ?? ''
}

export async function runLLMOpenAI(
  apiKey: string,
  model: string,
  userMessage: string,
  imageUrl?: string | string[],
  systemPrompt?: string,
  opts?: { maxTokens?: number },
) {
  const urls = Array.isArray(imageUrl) ? imageUrl : imageUrl ? [imageUrl] : []
  const content: unknown[] = []
  for (const u of urls) content.push({ type: 'image_url', image_url: { url: u } })
  content.push({ type: 'text', text: userMessage })

  const messages: unknown[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content })

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      // Default raised from 4000 to 8000 on 2026-05-30 after Image→JSON
      // truncations under verbose system prompts. Image→JSON passes a
      // higher explicit value (16384) for forensic detail extraction.
      max_tokens: opts?.maxTokens ?? 8000,
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}
