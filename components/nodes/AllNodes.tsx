'use client'
import { NodeProps } from '@xyflow/react'
import { useEffect, useState } from 'react'
import BaseNode from './BaseNode'
import ImageFirstNode from './ImageFirstNode'
import CompositorCanvas, { flattenLayers, type Layer as CompLayer } from './CompositorCanvas'
// MUAPI_MODELS / VIDEO_DURATIONS / ASPECT_RATIOS / CAMERA_PRESETS were the
// pre-sweep static lists. Every node now sources model + param options from
// MuAPI's schema_data.json via useModelControls + AutoParamFields, so the
// dropdowns reflect what each model actually accepts.
// OPENAI_LLM_MODELS was the pre-sweep static list. LLM nodes now source
// their roster from lib/api/llm.ts via ProviderPills + filtered Select.
import { runLLM, runEnhance, runDescribeImage, runImageToJson, runTranscribeAudio, runTTS, modelsForProvider, TTS_VOICES, type LLMProvider, type ImageToJsonKind } from '@/lib/api/llm'
import ProviderPills from '@/components/ui/ProviderPills'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import Select from '@/components/ui/Select'
import PromptLint from '@/components/ui/PromptLint'
import { renderSlide, loadImage, compositeLogo, sampleBrandTheme, type CarouselSlide } from '@/lib/flow/carousel'
import PainterCanvas from '@/components/painter/PainterCanvas'
import { runModel } from '@/lib/api/dispatch'
import type { RouteId } from '@/lib/api/router'
import { useModelControls, buildPayload } from './ModelParams'
import ModePicker from './ModePicker'

function Textarea({ value, onChange, placeholder, lint = true }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  // Lint for AI-tell phrases (8k, masterpiece, flawless skin...). ON for
  // positive prompts; negative prompts pass lint={false} — listing tells
  // there is the whole point.
  lint?: boolean
}) {
  return (
    <div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-2xl px-3 py-2 text-[11px] text-[var(--ink)] nodrag resize-none focus:outline-none placeholder-[var(--ink-faint)] clay-surface-soft border-0"
        style={{ background: 'var(--bg-elevated)' }}
      />
      {lint && <PromptLint value={value} onChange={onChange} />}
    </div>
  )
}

function Slider({ label, value, onChange, min = 0, max = 100, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] text-[var(--ink-mute)]">{label}</span>
        <span className="text-[10px] text-[var(--ink-soft)]">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 nodrag" style={{ accentColor: 'var(--accent)' }} />
    </div>
  )
}

// Pick a sensible default LLM provider — whichever the user has a key for.
// Preference: OpenAI > Google > MuAPI. If they have none, default to openai
// so the picker still shows something; the run handler will surface the
// missing-key error.
function pickDefaultProvider(apiKeys: import('@/lib/store/workflowStore').APIKeys): LLMProvider {
  if (apiKeys.openai) return 'openai'
  if (apiKeys.google) return 'google'
  if (apiKeys.muapi) return 'muapi'
  return 'openai'
}

function hasAnyLLMKey(apiKeys: import('@/lib/store/workflowStore').APIKeys): boolean {
  return Boolean(apiKeys.openai || apiKeys.google || apiKeys.muapi)
}

// Tiny inline banner shown inside an LLM node when none of the three
// providers have a key. Clicking opens the API Keys panel so the user can
// fix it in one step.
function ApiKeyHint() {
  const setShowAPIPanel = useWorkflowStore(s => s.setShowAPIPanel)
  return (
    <button
      type="button"
      onClick={() => setShowAPIPanel(true)}
      className="w-full clay-press mt-1 px-3 py-2 rounded-2xl text-[11px] text-left nodrag transition-colors"
      style={{
        background: 'color-mix(in srgb, var(--cat-helper) 14%, transparent)',
        color: 'var(--cat-helper)',
      }}
    >
      <span className="font-medium">Add an API key →</span>
      <span className="block text-[10px] opacity-80 mt-0.5">
        OpenAI, Gemini, or MuAPI. Click to open the keys panel.
      </span>
    </button>
  )
}

// Adapter from LLMOption shape to Select's option shape.
function toSelectOption(m: { model: string; name: string; description?: string; cost?: string }) {
  return { id: m.model, name: m.name, description: m.description, cost: m.cost }
}

// Pull the first frame of a video as a data URL so we can feed it to a
// vision LLM. Browser-only — uses HTMLVideoElement + canvas. Returns the
// frame as a JPEG data URL.
async function extractFirstFrame(videoUrl: string): Promise<string> {
  if (!videoUrl) throw new Error('No video URL')
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous'
  v.src = videoUrl
  v.muted = true
  // Wait for enough data to render a frame.
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve()
    v.onerror = () => reject(new Error('Failed to load video for frame extract'))
  })
  // Seek a tiny bit in to avoid pure-black frames on some encoders.
  v.currentTime = Math.min(0.1, v.duration / 4)
  await new Promise<void>(resolve => { v.onseeked = () => resolve() })
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(v, 0, 0)
  return c.toDataURL('image/jpeg', 0.85)
}

function PromptArea({ id, data, placeholder = 'Or type prompt directly here…' }: {
  id: string; data: Record<string, unknown>; placeholder?: string
}) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <Textarea
      value={(data.prompt as string) || ''}
      onChange={v => update(id, { prompt: v })}
      placeholder={placeholder}
    />
  )
}

// NegativePromptArea — collapsible "what to AVOID" text input. Renders
// a small label-link to expand into a full textarea. Encodes
// [[prompt-realism-anti-ai-avatar]]'s discipline of naming what should
// NOT appear (plastic skin, AI tells, scribbled hands, 8k jargon).
// The value writes to data.negative_prompt — buildPayload either
// passes it natively if the model spec exposes a negative_prompt
// param, or weaves it into the main prompt as "NEGATIVE — must NOT
// include: …" for models without a dedicated field.
function NegativePromptArea({ id, data, placeholder = "e.g. 'plastic skin, AI smoothing, extra fingers, 8k, masterpiece'" }: {
  id: string; data: Record<string, unknown>; placeholder?: string
}) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const value = (data.negative_prompt as string) || ''
  // Expand if user clicked OR if value is non-empty. The OR with `value`
  // matters when the field is filled out-of-band (SSE set_param from
  // Prompt Blue, workflow load, snapshot rehydrate) — the initial mount
  // saw an empty value, but the moment data arrives we must render the
  // textarea rather than the collapsed "+ add negative prompt" pill.
  const [userExpanded, setUserExpanded] = useState(false)
  const expanded = userExpanded || value.length > 0
  const setExpanded = setUserExpanded
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-[10px] uppercase tracking-wider nodrag self-start"
        style={{ color: 'var(--ink-faint)' }}
      >
        + add negative prompt
      </button>
    )
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--cat-video)' }}>
          Negative — what to AVOID
        </span>
        {value === '' && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[9px] nodrag"
            style={{ color: 'var(--ink-faint)' }}
          >
            hide
          </button>
        )}
      </div>
      <Textarea
        value={value}
        onChange={v => update(id, { negative_prompt: v })}
        placeholder={placeholder}
        lint={false}
      />
    </div>
  )
}

// Shared expand button placed in the top-right of any preview. Opens the
// shared Lightbox for full-screen viewing. Hidden until the preview is
// hovered so the chrome stays calm at rest.
function ExpandButton({ kind, url, thumbnailUrl }: {
  kind: 'image' | 'video' | '3d'
  url: string
  thumbnailUrl?: string
}) {
  const openLightbox = useWorkflowStore(s => s.openLightbox)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openLightbox(kind, url, thumbnailUrl) }}
      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center nodrag opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        background: 'rgba(0, 0, 0, 0.55)',
        color: 'white',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      title="Enlarge (full-screen)"
    >
      {/* Small expand-corners icon */}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  )
}

function ImagePreview({ url }: { url?: string }) {
  if (!url) return null
  return (
    <div className="mt-2 rounded-2xl overflow-hidden clay-surface-soft relative group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Output" className="w-full object-contain max-h-40" />
      <ExpandButton kind="image" url={url} />
    </div>
  )
}

function VideoPreview({ url }: { url?: string }) {
  if (!url) return null
  return (
    <div className="mt-2 rounded-2xl overflow-hidden clay-surface-soft relative group">
      <video src={url} controls className="w-full max-h-40" />
      <ExpandButton kind="video" url={url} />
    </div>
  )
}

function Label({ text }: { text: string }) {
  return <p className="text-[10px] text-[var(--ink-mute)] uppercase tracking-wide">{text}</p>
}

// ── TEXT NODES ────────────────────────────────────────────────────────────────
export function PromptNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const val = (data.prompt as string) || ''
  return (
    <BaseNode id={id} title="Prompt" category="text" selected={selected as boolean} collapsible
      simpleExplanation="Type what you want to create here. Like telling the AI 'make me a sunset on a beach' — it's the starting point of everything."
      outputs={[{ id: 'text', label: 'Text', type: 'text' }]}
    >
      <Textarea value={val} onChange={v => update(id, { prompt: v })} placeholder="Describe what you want to create…" />
    </BaseNode>
  )
}

export function PromptEnhancerNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const [result, setResult] = useState('')
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const provider = (data.provider as LLMProvider) || pickDefaultProvider(apiKeys)
  const opts = modelsForProvider(provider)
  const model = (data.llm as string) || opts[0]?.model || ''
  return (
    <BaseNode id={id} title="Prompt Enhancer" category="text" selected={selected as boolean}
      simpleExplanation="Your prompt goes in, a better prompt comes out. The AI rewrites it with more detail so your image or video looks amazing."
      inputs={[{ id: 'text', label: 'Prompt', type: 'text' }]}
      outputs={[{ id: 'text', label: 'Enhanced Prompt', type: 'text' }]}
      hasRunButton onRun={async () => {
        const r = await runEnhance({ provider, model, prompt: (data.prompt as string) || '', apiKeys })
        setResult(r); update(id, { enhanced: r })
      }}
    >
      <Label text="Provider" />
      <ProviderPills value={provider} onChange={p => update(id, { provider: p, llm: modelsForProvider(p)[0]?.model })} />
      {!hasAnyLLMKey(apiKeys) && <ApiKeyHint />}
      <Label text="Model" />
      <Select value={model} onChange={v => update(id, { llm: v })} options={opts.map(toSelectOption)} />
      <Label text="Prompt (or wire one in)" />
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Type the prompt to enhance, or wire a Prompt node into the left handle…" />
      {result && <p className="text-[10px] text-[var(--ink-soft)] mt-1 italic line-clamp-3">{result}</p>}
    </BaseNode>
  )
}

export function VideoDescriberNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const [result, setResult] = useState('')
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const provider = (data.provider as LLMProvider) || pickDefaultProvider(apiKeys)
  // Only vision-capable models for describer nodes.
  const opts = modelsForProvider(provider, { vision: true })
  const model = (data.llm as string) || opts[0]?.model || ''
  return (
    <BaseNode id={id} title="Video Describer" category="text" selected={selected as boolean}
      simpleExplanation="Same as Image Describer but for videos. Watches your video and writes out what's happening so you can recreate or remix it."
      inputs={[{ id: 'video', label: 'Video', type: 'video' }]}
      outputs={[{ id: 'text', label: 'Description', type: 'text' }]}
      hasRunButton onRun={async () => {
        const videoUrl = (data.videoUrl as string) || ''
        // Extract the first frame client-side so we can feed it to a vision
        // LLM (none of the LLMs natively accept video). HTMLVideoElement +
        // canvas snapshot is enough.
        const frame = await extractFirstFrame(videoUrl)
        const r = await runDescribeImage({ provider, model, imageUrl: frame, apiKeys })
        setResult(r); update(id, { result: r })
      }}
    >
      <Label text="Provider" />
      <ProviderPills value={provider} onChange={p => update(id, { provider: p, llm: modelsForProvider(p, { vision: true })[0]?.model })} />
      {!hasAnyLLMKey(apiKeys) && <ApiKeyHint />}
      <Label text="Model" />
      <Select value={model} onChange={v => update(id, { llm: v })} options={opts.map(toSelectOption)} />
      {result && <p className="text-[10px] text-[var(--ink-soft)] italic line-clamp-3">{result}</p>}
    </BaseNode>
  )
}

// Text → Speech. Takes a script (typed or wired in) plus an optional
// style direction ("speak in a cheerful conspiratorial whisper") and
// produces an audio data URL the rest of the pipeline can use the same
// way as uploaded audio. Lip Sync, audio preview, etc. all consume it.
//
// Provider pills: OpenAI (gpt-4o-mini-tts, ~$0.015/minute), Google
// (gemini-2.5-flash-preview-tts, free in preview), MuAPI (MiniMax Speech).
export function TTSNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const [busy, setBusy] = useState(false)
  // Default-provider priority: ElevenLabs > OpenAI > Google > MuAPI.
  // ElevenLabs first because the free tier is high-quality and the user
  // has just lit it up.
  const provider = (data.provider as LLMProvider)
    || (apiKeys.elevenlabs ? 'elevenlabs' : apiKeys.openai ? 'openai' : apiKeys.google ? 'google' : 'muapi')
  // For ElevenLabs, pull the account's real voice library (premades the
  // account can use + shared voices it has added, e.g. Finn, + clones)
  // instead of the static 9-voice fallback. Fetched once per key.
  const [elevenVoices, setElevenVoices] = useState<Array<{ id: string; name: string }> | null>(null)
  useEffect(() => {
    if (provider !== 'elevenlabs' || !apiKeys.elevenlabs) return
    let cancelled = false
    import('@/lib/api/elevenlabs')
      .then(({ fetchElevenLabsVoices }) => fetchElevenLabsVoices())
      .then(vs => {
        if (cancelled || !vs.length) return
        setElevenVoices(vs.map(v => ({
          id: v.voice_id,
          name: v.category && v.category !== 'premade' ? `${v.name} (${v.category})` : v.name,
        })))
      })
      .catch(() => {}) // fall back to the static list on any failure
    return () => { cancelled = true }
  }, [provider, apiKeys.elevenlabs])
  const voices = provider === 'elevenlabs' && elevenVoices?.length ? elevenVoices : TTS_VOICES[provider]
  // Wired voiceId (from a Voice Cloner upstream) takes priority over
  // the dropdown — essential for ElevenLabs free tier, where library
  // voices are blocked and only cloned voices work.
  const wiredVoiceId = (data.voiceId as string) || ''
  const voice = wiredVoiceId || (data.voice as string) || voices[0]?.id
  return (
    <BaseNode id={id} title="Text → Speech" category="text" selected={selected as boolean}
      simpleExplanation="Turns a script into a spoken audio clip. Wire a Prompt with your script in, get audio out. For ElevenLabs free tier, wire a Voice Cloner in (library voices are paid-only). Pipe that into Lip Sync to make a video character say it."
      inputs={[
        { id: 'text', label: 'Script', type: 'text' },
        { id: 'voiceId', label: 'Voice ID (from Voice Cloner)', type: 'text' },
      ]}
      outputs={[{ id: 'audio', label: 'Audio', type: 'audio' }]}
      hasRunButton onRun={async () => {
        setBusy(true)
        try {
          const audioUrl = await runTTS({
            provider,
            text: (data.text as string) || (data.prompt as string) || '',
            voice,
            instructions: data.instructions as string | undefined,
            apiKeys,
          })
          update(id, { audioUrl })
        } finally { setBusy(false) }
      }}
    >
      <Label text="Provider" />
      <ProviderPills
        value={provider}
        onChange={p => update(id, { provider: p, voice: TTS_VOICES[p][0]?.id })}
        options={['openai', 'google', 'muapi', 'elevenlabs']}
      />
      {!apiKeys.openai && !apiKeys.google && !apiKeys.muapi && !apiKeys.elevenlabs && <ApiKeyHint />}
      <Label text="Voice" />
      {wiredVoiceId ? (
        <div className="px-3 py-2 rounded-lg" style={{ background: 'var(--accent-tint)' }}>
          <div className="text-[9px] uppercase tracking-wider text-[var(--accent)] mb-0.5">Using wired voice ID</div>
          <code className="text-[10px] text-[var(--ink)] break-all">{wiredVoiceId}</code>
          <div className="text-[9.5px] text-[var(--ink-mute)] mt-1">From upstream Voice Cloner. Disconnect to use the dropdown again.</div>
        </div>
      ) : (
        <Select value={voice} onChange={v => update(id, { voice: v })} options={voices.map(v => ({ id: v.id, name: v.name }))} />
      )}
      <Label text="Style direction (optional)" />
      <Textarea
        value={(data.instructions as string) || ''}
        onChange={v => update(id, { instructions: v })}
        placeholder="e.g. 'speak in a cheerful conspiratorial whisper' or 'casual UGC presenter, slightly excited'"
      />
      <Label text="Script" />
      <Textarea
        value={(data.text as string) || ''}
        onChange={v => update(id, { text: v })}
        placeholder="Or wire a Prompt node in. Both work — wired input wins."
      />
      {(data.audioUrl as string) ? (
        <div className="mt-2 rounded-2xl overflow-hidden clay-surface-soft p-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={data.audioUrl as string} controls className="w-full" />
        </div>
      ) : null}
      {busy && <p className="text-[10px] text-[var(--ink-faint)] italic mt-1">Generating audio…</p>}
    </BaseNode>
  )
}

// ElevenLabs Voice Cloner — takes 1+ audio samples (wired or pasted),
// creates an Instant Voice Clone, outputs the voice_id that downstream
// TTS nodes use. Cloned voices are free-tier-compatible AND free to
// re-use forever after the one-time creation.
//
// Per ElevenLabs docs, a clean ~30 second clip of single-speaker
// speech gives a solid clone. Multiple samples improve fidelity.
export function VoiceClonerNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const voiceId = (data.voiceId as string) || ''
  const name = (data.name as string) || ''
  const audioUrl = (data.audioUrl as string) || ''
  return (
    <BaseNode id={id} title="Voice Cloner" category="text" selected={selected as boolean}
      simpleExplanation="Wire in a 30+ second audio sample (your voice, a podcast clip, anything clean). Give it a name. Click Clone. ElevenLabs returns a voice_id you can wire into Text → Speech for unlimited future TTS in that voice. Free tier compatible."
      inputs={[{ id: 'audio', label: 'Audio Sample', type: 'audio' }]}
      outputs={[{ id: 'voiceId', label: 'Voice ID', type: 'text' }]}
      hasRunButton
      onRun={async () => {
        setBusy(true)
        setErr('')
        try {
          if (!audioUrl) throw new Error('Wire an audio sample into the left input first (Audio Upload node).')
          if (!name.trim()) throw new Error('Give the voice a name first (so you can identify it later).')
          const { cloneVoiceElevenLabs } = await import('@/lib/api/elevenlabs')
          const r = await cloneVoiceElevenLabs({
            name: name.trim(),
            description: (data.description as string)?.trim() || undefined,
            audioUrls: [audioUrl],
          })
          update(id, { voiceId: r.voice_id })
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <Label text="Voice Name" />
      <Textarea
        value={name}
        onChange={v => update(id, { name: v })}
        placeholder="e.g. 'My Brand Voice', 'Studio Narrator', 'Energetic Female'"
      />
      <Label text="Description (optional)" />
      <Textarea
        value={(data.description as string) || ''}
        onChange={v => update(id, { description: v })}
        placeholder="e.g. 'Calm, conversational male voice for product reviews'"
      />
      <div className="text-[10px] text-[var(--ink-mute)] mt-1">
        {audioUrl ? '✓ audio sample wired' : '⚠ wire an Audio Upload (30+ sec of clean speech)'}
      </div>
      {voiceId && (
        <div className="mt-2 px-3 py-2 rounded-lg" style={{ background: 'var(--accent-tint)' }}>
          <div className="text-[9px] uppercase tracking-wider text-[var(--accent)] mb-0.5">Cloned voice ID</div>
          <code className="text-[10px] text-[var(--ink)] break-all">{voiceId}</code>
          <div className="text-[9.5px] text-[var(--ink-mute)] mt-1">Wire this output into a Text → Speech node.</div>
        </div>
      )}
      {err && (
        <div className="mt-2 px-3 py-2 rounded-lg text-[10px]"
          style={{ background: 'color-mix(in srgb, var(--cat-video) 12%, transparent)', color: 'var(--cat-video)' }}>
          {err}
        </div>
      )}
      {busy && <p className="text-[10px] text-[var(--ink-faint)] italic mt-1">Cloning voice…</p>}
    </BaseNode>
  )
}

// Transcribes uploaded audio into text. Uses Whisper (OpenAI) or
// Gemini 2.5 Flash audio mode (Google). The transcript output can feed
// a Combiner to merge with the motion direction so the video model
// knows WHAT the person is saying — not just the lip-shape phonemes.
export function AudioTranscriberNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const [result, setResult] = useState('')
  // Whisper / Gemini audio only — MuAPI isn't surfaced here because its
  // text-to-text models don't reliably accept audio inputs.
  const provider = (data.provider as LLMProvider) || (apiKeys.openai ? 'openai' : 'google')
  return (
    <BaseNode id={id} title="Audio Transcriber" category="text" selected={selected as boolean}
      simpleExplanation="Listens to your uploaded audio and writes out the spoken script. Feed the transcript into a Prompt Combiner so the video model knows what is being said — not just lip shapes."
      inputs={[{ id: 'audio', label: 'Audio', type: 'audio' }]}
      outputs={[{ id: 'text', label: 'Transcript', type: 'text' }]}
      hasRunButton onRun={async () => {
        const r = await runTranscribeAudio({
          provider,
          audioUrl: (data.audioUrl as string) || '',
          language: data.language as string | undefined,
          apiKeys,
        })
        setResult(r); update(id, { result: r })
      }}
    >
      <Label text="Provider" />
      <ProviderPills value={provider} onChange={p => update(id, { provider: p })} options={['openai', 'google']} />
      {!apiKeys.openai && !apiKeys.google && <ApiKeyHint />}
      {result && (
        <p className="text-[10px] text-[var(--ink-soft)] italic mt-1 line-clamp-4 px-1">
          {result.length > 200 ? result.slice(0, 200) + '…' : result}
        </p>
      )}
    </BaseNode>
  )
}

export function PromptConcatNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const a = (data.textA as string) || ''
  const b = (data.textB as string) || ''
  const sep = (data.separator as string) || ' '
  const combined = [a, b].filter(Boolean).join(sep)
  useEffect(() => {
    if (combined !== (data.combined as string)) update(id, { combined })
  }, [combined, data.combined, id, update])
  return (
    <BaseNode id={id} title="Prompt Combiner" category="text" selected={selected as boolean}
      simpleExplanation="Connect two prompts and this merges them into one. Useful when you have different ideas you want to blend together."
      inputs={[
        { id: 'textA', label: 'Prompt A', type: 'text' },
        { id: 'textB', label: 'Prompt B', type: 'text' },
      ]}
      outputs={[{ id: 'text', label: 'Combined', type: 'text' }]}
    >
      <Label text="Separator" />
      <Select value={sep} onChange={v => update(id, { separator: v })} options={[
        { id: ' ', name: 'Space' },
        { id: ', ', name: 'Comma' },
        { id: '. ', name: 'Period' },
        { id: ' and ', name: 'and' },
        { id: '\n', name: 'New line' },
      ]} />
      {combined && <p className="text-[10px] text-[var(--ink-soft)] italic line-clamp-3">{combined}</p>}
    </BaseNode>
  )
}

// ── DIRECTOR FORMULA NODE ─────────────────────────────────────────────────────
// Structured image-prompt builder. Encodes the
// SHOT + LENS + LIGHT + TEXTURE + COMPOSITION + STYLE REF + VISION formula
// (Sergey Kabankov / AI Video Creators Skool lesson 1.2, banked in
// `prompt_director_formula.md` + `prompt_cinematography_vocab.md`).
//
// Vocabulary is taken VERBATIM from the cinematography vocab memory so
// the named tokens fire correctly on diffusion models that recognise
// them. Free-text slots stay open for subject + action + style ref +
// vision so the user has full creative latitude.
//
// Output is a single plain-text prompt string (photography mode — JSON
// would *hurt* per the JSON-only-for-stylized rule banked in the vocab
// memory). Wire the output into any prompt-accepting text input —
// Text → Image, Compositor, ReferenceSheet, Sheet generators, etc.

const SHOT_TYPES = [
  { id: '', name: '—' },
  { id: 'Extreme Close-Up (ECU)', name: 'ECU — Extreme Close-Up (intimacy, detail)' },
  { id: 'Close-Up (CU)',          name: 'CU — Close-Up (face, emotion)' },
  { id: 'Medium Shot (MS)',       name: 'MS — Medium Shot (waist-up, balance)' },
  { id: 'Full Shot (FS)',         name: 'FS — Full Shot (figure + environment)' },
  { id: 'Long Shot (LS)',         name: 'LS — Long Shot (atmosphere, scale)' },
  { id: 'Extreme Wide Shot (EWS)',name: 'EWS — Extreme Wide Shot (epic, hero-as-dot)' },
  { id: 'Over-the-Shoulder (OTS)',name: 'OTS — Over-the-Shoulder (presence)' },
  { id: 'Point of View (POV)',    name: 'POV — Point of View (immersion)' },
  { id: "Bird's-Eye View",         name: "Bird's-Eye View (top-down, abstraction)" },
  { id: "Worm's-Eye View",         name: "Worm's-Eye View (low, dominance)" },
]
const LENSES = [
  { id: '', name: '—' },
  { id: '14mm ultra-wide',  name: '14mm Ultra-wide (distortion, dramatic space)' },
  { id: '24mm wide',        name: '24mm Wide (environment, dynamic)' },
  { id: '35mm',             name: '35mm (natural perspective, environmental)' },
  { id: '50mm',             name: '50mm ("human eye" look)' },
  { id: '85mm portrait',    name: '85mm Portrait (compressed bg, isolated subject)' },
  { id: '135mm portrait',   name: '135mm Portrait (further compression)' },
  { id: '200mm telephoto',  name: '200mm Telephoto (flat bg, isolation)' },
]
const LIGHT_SOURCES = [
  { id: '', name: '—' },
  { id: 'natural daylight',       name: 'Natural daylight (alive, soft)' },
  { id: 'softbox / studio strobe', name: 'Softbox / studio strobe (commercial)' },
  { id: 'window light',           name: 'Window light (realistic, soft)' },
  { id: 'neon / LED signs',       name: 'Neon / LED (cyberpunk)' },
  { id: 'candlelight / fire',     name: 'Candlelight / fire (intimacy, mysticism)' },
  { id: 'practical lights in frame', name: 'Practicals in frame (life inside scene)' },
  { id: 'tungsten warm 3200K',    name: 'Tungsten warm 3200K (nostalgic)' },
  { id: 'overcast diffuse',       name: 'Overcast diffuse (even, gritty)' },
]
const LIGHT_DIRECTION = [
  { id: '', name: '—' },
  { id: 'front-lit',  name: 'Front-lit (flat, minimal shadows)' },
  { id: 'side-lit',   name: 'Side-lit (Rembrandt — depth, drama)' },
  { id: 'backlit',    name: 'Backlit (silhouette, halo)' },
  { id: 'rim light',  name: 'Rim light (contour, separation)' },
  { id: 'top light',  name: 'Top light (harsh downward shadow, mystery)' },
  { id: 'under light',name: 'Under-light (horror, surrealism)' },
]
const LIGHT_QUALITY = [
  { id: '', name: '—' },
  { id: 'hard light',     name: 'Hard light (sharp shadows, drama)' },
  { id: 'soft light',     name: 'Soft light (diffused, beauty)' },
  { id: 'diffused light', name: 'Diffused light (clean commercial)' },
]
const COMPOSITION = [
  { id: '', name: '—' },
  { id: 'rule of thirds',    name: 'Rule of Thirds' },
  { id: 'centered composition', name: 'Centered' },
  { id: 'negative space',    name: 'Negative Space' },
  { id: 'leading lines',     name: 'Leading Lines' },
  { id: 'foreground / midground / background layered depth', name: 'Layered Depth (FG / MG / BG)' },
  { id: 'symmetrical',       name: 'Symmetry' },
  { id: 'asymmetrical',      name: 'Asymmetry' },
]

function buildDirectorPrompt(d: Record<string, unknown>): string {
  const get = (k: string) => ((d[k] as string) || '').trim()
  const subject  = get('subject')
  const action   = get('action')
  const shot     = get('shot')
  const lens     = get('lens')
  const lightSrc = get('light_source')
  const lightDir = get('light_direction')
  const lightQ   = get('light_quality')
  const textures = get('textures')
  const composition = get('composition')
  const styleRef = get('style_ref')
  const vision   = get('vision')

  // Open with the shot type if specified, then subject + action.
  const opening = shot
    ? `${shot} of ${subject || 'the subject'}${action ? ` ${action}` : ''}`
    : (subject ? `${subject}${action ? ` ${action}` : ''}` : '')

  // Lens clause.
  const lensClause = lens ? `shot on a ${lens} lens` : ''

  // Lighting clause — name all four facets when set.
  const lightParts = [lightSrc, lightDir, lightQ].filter(Boolean)
  const lightClause = lightParts.length ? lightParts.join(', ') : ''

  // Texture / material emphasis clause.
  const textureClause = textures
    ? `Detailed textures on ${textures}`
    : ''

  // Composition.
  const compositionClause = composition || ''

  // Style reference (era / photographer / film).
  const styleClause = styleRef ? `Styled like ${styleRef}` : ''

  // Emotional vision.
  const visionClause = vision ? `evoking ${vision}` : ''

  // Assemble — drop empty clauses, comma-separate, ensure end punctuation.
  const parts = [
    opening,
    lensClause,
    lightClause,
    textureClause,
    compositionClause,
    [styleClause, visionClause].filter(Boolean).join(', '),
  ].filter(Boolean)

  if (parts.length === 0) return ''
  return parts.join('. ').replace(/\.\s*\./g, '.').trim().replace(/[.,]?$/, '.')
}

export function DirectorPromptNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const d = data as Record<string, unknown>
  const output = buildDirectorPrompt(d)

  // Keep the data.output field in sync so propagation downstream gets it.
  useEffect(() => {
    if (output !== (d.output as string | undefined)) update(id, { output })
  }, [output, d.output, id, update])

  return (
    <BaseNode id={id} title="Director Formula" category="text" selected={selected as boolean}
      simpleExplanation="Fill the 7 fields like a creative director writing a brief — subject + action, shot type, lens, lighting (3 facets), composition, style ref, vision. The node assembles a director-grade prompt that wires into any image generator. Vocabulary taken verbatim from cinematography sources."
      inputs={[]}
      outputs={[{ id: 'text', label: 'Director Prompt', type: 'text' }]}
    >
      <Label text="Subject (who / what)" />
      <input
        type="text"
        value={(d.subject as string) || ''}
        onChange={e => update(id, { subject: e.target.value })}
        placeholder="e.g. young woman, motocross rider, rustic loaf of bread"
        className="w-full rounded-md px-2 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />

      <Label text="Action (what they're doing)" />
      <input
        type="text"
        value={(d.action as string) || ''}
        onChange={e => update(id, { action: e.target.value })}
        placeholder="e.g. laughing while holding coffee, mid-lean on a dirt track"
        className="w-full rounded-md px-2 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />

      <Label text="Shot type" />
      <Select value={(d.shot as string) || ''} onChange={v => update(id, { shot: v })}
        options={SHOT_TYPES.map(s => ({ id: s.id, name: s.name }))} />

      <Label text="Lens / focal length" />
      <Select value={(d.lens as string) || ''} onChange={v => update(id, { lens: v })}
        options={LENSES.map(s => ({ id: s.id, name: s.name }))} />

      <Label text="Light — source" />
      <Select value={(d.light_source as string) || ''} onChange={v => update(id, { light_source: v })}
        options={LIGHT_SOURCES.map(s => ({ id: s.id, name: s.name }))} />

      <Label text="Light — direction" />
      <Select value={(d.light_direction as string) || ''} onChange={v => update(id, { light_direction: v })}
        options={LIGHT_DIRECTION.map(s => ({ id: s.id, name: s.name }))} />

      <Label text="Light — quality" />
      <Select value={(d.light_quality as string) || ''} onChange={v => update(id, { light_quality: v })}
        options={LIGHT_QUALITY.map(s => ({ id: s.id, name: s.name }))} />

      <Label text="Textures / materials to emphasise" />
      <input
        type="text"
        value={(d.textures as string) || ''}
        onChange={e => update(id, { textures: e.target.value })}
        placeholder="e.g. brushed metal, denim, skin pores, condensation on glass"
        className="w-full rounded-md px-2 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />

      <Label text="Composition" />
      <Select value={(d.composition as string) || ''} onChange={v => update(id, { composition: v })}
        options={COMPOSITION.map(s => ({ id: s.id, name: s.name }))} />

      <Label text="Style reference (era / photographer / film)" />
      <input
        type="text"
        value={(d.style_ref as string) || ''}
        onChange={e => update(id, { style_ref: e.target.value })}
        placeholder="e.g. 1990s Marlboro campaigns, Blade Runner 2049, Annie Leibovitz"
        className="w-full rounded-md px-2 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />

      <Label text="Emotional vision (how it should feel)" />
      <input
        type="text"
        value={(d.vision as string) || ''}
        onChange={e => update(id, { vision: e.target.value })}
        placeholder="e.g. raw speed and unpolished realism, lonely Sunday morning"
        className="w-full rounded-md px-2 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />

      {output && (
        <div className="mt-1 rounded-md p-2 text-[10px] italic" style={{ background: 'var(--bg-elevated)', color: 'var(--ink-soft)' }}>
          {output}
        </div>
      )}
    </BaseNode>
  )
}

export function LLMNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const [result, setResult] = useState('')
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const provider = (data.provider as LLMProvider) || pickDefaultProvider(apiKeys)
  const hasImage = !!data.imageUrl
  // If a wired image is present, only show vision-capable models.
  const opts = modelsForProvider(provider, { vision: hasImage })
  const model = (data.model as string) || opts[0]?.model || ''
  return (
    <BaseNode id={id} title="Run Any LLM" category="text" selected={selected as boolean}
      simpleExplanation="Talk to any AI brain (ChatGPT, Gemini, Claude) directly inside your workflow. Ask questions, get descriptions, or have it write prompts."
      inputs={[{ id: 'text', label: 'Message', type: 'text' }, { id: 'image', label: 'Image (optional)', type: 'image' }]}
      outputs={[{ id: 'text', label: 'Response', type: 'text' }]}
      hasRunButton onRun={async () => {
        const r = await runLLM({
          provider, model,
          message: (data.message as string) || '',
          imageUrl: data.imageUrl as string | undefined,
          apiKeys,
        })
        setResult(r); update(id, { result: r })
      }}
    >
      <Label text="Provider" />
      <ProviderPills value={provider} onChange={p => update(id, { provider: p, model: modelsForProvider(p, { vision: hasImage })[0]?.model })} />
      {!hasAnyLLMKey(apiKeys) && <ApiKeyHint />}
      <Label text="Model" />
      <Select value={model} onChange={v => update(id, { model: v })} options={opts.map(toSelectOption)} />
      <Textarea value={(data.message as string) || ''} onChange={v => update(id, { message: v })} placeholder="What do you want to ask?" />
      {result && <p className="text-[10px] text-[var(--ink-soft)] mt-1 italic line-clamp-3">{result}</p>}
    </BaseNode>
  )
}

export function ImageDescriberNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const [result, setResult] = useState('')
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const provider = (data.provider as LLMProvider) || pickDefaultProvider(apiKeys)
  const opts = modelsForProvider(provider, { vision: true })
  const model = (data.llm as string) || opts[0]?.model || ''
  return (
    <BaseNode id={id} title="Image Describer" category="text" selected={selected as boolean}
      simpleExplanation="Give it a photo and it tells you exactly what's in it as a detailed prompt. Perfect for recreating a style."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'text', label: 'Description', type: 'text' }]}
      hasRunButton onRun={async () => {
        const r = await runDescribeImage({ provider, model, imageUrl: (data.imageUrl as string) || '', apiKeys })
        setResult(r); update(id, { result: r })
      }}
    >
      <Label text="Provider" />
      <ProviderPills value={provider} onChange={p => update(id, { provider: p, llm: modelsForProvider(p, { vision: true })[0]?.model })} />
      {!hasAnyLLMKey(apiKeys) && <ApiKeyHint />}
      <Label text="Model" />
      <Select value={model} onChange={v => update(id, { llm: v })} options={opts.map(toSelectOption)} />
      {result && <p className="text-[10px] text-[var(--ink-soft)] italic line-clamp-3">{result}</p>}
    </BaseNode>
  )
}

// Image → JSON. Vision LLM produces a strict JSON description of the
// image — wire the output into any text input (prompt enhancer,
// compositor prompt, T2I prompt) to lock identity/location with a
// text spec, complementing image references.
export function ImageToJsonNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const provider = (data.provider as LLMProvider) || pickDefaultProvider(apiKeys)
  const opts = modelsForProvider(provider, { vision: true })
  const model = (data.llm as string) || opts[0]?.model || ''
  const kind = (data.kind as ImageToJsonKind) || 'auto'
  const result = (data.result as string) || ''
  const refUrls = [
    data.image1Url, data.image2Url, data.image3Url, data.image4Url, data.image5Url,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  const wired = refUrls.length
  const kindOptions = [
    { id: 'auto',     name: 'Auto-detect',        description: 'Let the LLM pick keys based on what it sees.' },
    { id: 'location', name: 'Location / building', description: 'Bias toward environment, branding, materials, signage.' },
    { id: 'person',   name: 'Person',              description: 'Bias toward identity, face, clothing, pose, lighting.' },
    { id: 'product',  name: 'Product',             description: 'Bias toward form factor, colourway, labels, packaging.' },
  ]
  return (
    <BaseNode id={id} title="Image → JSON" category="text" selected={selected as boolean}
      simpleExplanation="Vision LLM produces a strict JSON description of one or several images of the same subject. Wire optional Extra Instructions (positive direction: 'include hex codes', 'list every logo separately') and Negative (avoid: 'don't speculate about brands not visible'). Output JSON wires into any text input for downstream identity lock."
      inputs={[
        { id: 'image1', label: 'Image 1', type: 'image' },
        { id: 'image2', label: 'Image 2', type: 'image' },
        { id: 'image3', label: 'Image 3', type: 'image' },
        { id: 'image4', label: 'Image 4', type: 'image' },
        { id: 'image5', label: 'Image 5', type: 'image' },
        { id: 'extra', label: 'Extra Direction (optional)', type: 'text' },
        { id: 'negative', label: 'Negative (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'text', label: 'JSON', type: 'text' }]}
      hasRunButton onRun={async () => {
        const r = await runImageToJson({
          provider, model,
          imageUrls: refUrls,
          kind,
          extraInstructions: (data.extraInstructions as string) || '',
          negativeInstructions: (data.negative_prompt as string) || '',
          apiKeys,
        })
        update(id, { result: r })
      }}
    >
      <Label text="Provider" />
      <ProviderPills value={provider} onChange={p => update(id, { provider: p, llm: modelsForProvider(p, { vision: true })[0]?.model })} />
      {!hasAnyLLMKey(apiKeys) && <ApiKeyHint />}
      <Label text="Model" />
      <Select value={model} onChange={v => update(id, { llm: v })} options={opts.map(toSelectOption)} />
      <Label text="Subject" />
      <Select value={kind} onChange={v => update(id, { kind: v as ImageToJsonKind })}
        options={kindOptions} />
      <Label text="Extra extraction direction (optional)" />
      <Textarea
        value={(data.extraInstructions as string) || ''}
        onChange={v => update(id, { extraInstructions: v })}
        placeholder="e.g. 'include hex codes for every visible colour', 'list every logo separately with its position', 'capture material thickness'"
      />
      <NegativePromptArea
        data={data as Record<string, unknown>}
        id={id}
        placeholder="e.g. 'do not speculate about brands not visible', 'skip background crowd details', 'don't infer materials I can't see'"
      />
      <div className="text-[10px] text-[var(--ink-mute)] mt-1">
        {wired === 0 ? 'Wire up to 5 images on the left.' : `${wired} image${wired === 1 ? '' : 's'} wired`}
      </div>
      {result && (
        <pre className="text-[10px] text-[var(--ink-soft)] bg-[var(--bg-elevated)] rounded-md p-2 max-h-32 overflow-y-auto scrollbar-on-hover whitespace-pre-wrap break-words">
          {result.length > 600 ? result.slice(0, 600) + '\n…' : result}
        </pre>
      )}
    </BaseNode>
  )
}

// ── IMAGE NODES ───────────────────────────────────────────────────────────────
export function TextToImageNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const hasRef = !!data.referenceUrl
  const { slug, spec, controls } = useModelControls(id, data as Record<string, unknown>, {
    category: 'Text to Image',
    defaultModel: 'flux-2-pro',
  })
  // Only show the Style Ref handle when the chosen T2I model actually
  // accepts a reference image. Pure T2I models (e.g. older Imagen, basic
  // Flux Dev) skip it; Nano Banana / Flux Kontext / GPT-Image expose it.
  const acceptsStyleRef = !!(spec?.params.image_url || spec?.params.images_list)
  const inputs: Array<{ id: string; label: string; type?: string }> = [
    { id: 'text', label: 'Prompt', type: 'text' },
  ]
  if (acceptsStyleRef) inputs.push({ id: 'reference', label: 'Style Ref', type: 'image' })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  if (data.aspectRatio) pills.push({ label: String(data.aspectRatio) })
  if (data.imageSize) pills.push({ label: String(data.imageSize) })
  if (acceptsStyleRef && hasRef) pills.push({ label: 'style ref' })
  return (
    <ImageFirstNode id={id} title="Text → Image" category="image" selected={selected as boolean}
      simpleExplanation="Type a description and it draws a picture. Models that accept a STYLE REFERENCE image (Nano Banana, Flux Kontext, GPT-Image) expose a second Style Ref handle. Pure T2I models hide it."
      inputs={inputs}
      outputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputUrl={data.imageUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(spec, data as Record<string, unknown>, {
          images_list: hasRef ? (data.referenceUrl as string) : undefined,
          image_url:   hasRef ? (data.referenceUrl as string) : undefined,
        })
        const res = await runModel(slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { imageUrl: res.url, lastRoute: res.route })
      }}
    >
      <Textarea value={(data.prompt as string) || ''} onChange={v => update(id, { prompt: v })} placeholder="Describe what you want to create…" />
      {acceptsStyleRef && hasRef && (
        <div className="rounded-2xl overflow-hidden clay-surface-soft relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.referenceUrl as string} alt="style ref" className="w-full max-h-24 object-cover" />
          <span
            className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[8.5px] font-medium uppercase tracking-wider"
            style={{ background: 'var(--bg-surface)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}
          >
            style ref
          </span>
        </div>
      )}
      {controls}
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

// Shared runner used by every "single input image, single output image" node.
// Lets each node body stay tiny — just declare the title, simpleExplanation,
// inputs, default model + (optional) filter, and the run handler is identical.
function useImageEditNode(id: string, data: Record<string, unknown>, opts: {
  category: string
  defaultModel: string
  filter?: (m: import('@/lib/api/capabilities').ModelSpec) => boolean
}) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data, opts)
  const onRun = async () => {
    // Pass both `image_url` AND `images_list` — buildPayload picks
    // whichever the model's schema actually accepts (e.g. nano-banana-
    // pro-edit requires images_list; clarity-upscaler takes image_url).
    const url = data.imageUrl as string | undefined
    const payload = buildPayload(ctrl.spec, data, {
      image_url:   url,
      images_list: url ? [url] : undefined,
    })
    const res = await runModel(ctrl.slug, payload, {
      apiKeys,
      preferredRoute: data.route as RouteId | undefined,
    })
    update(id, { outputUrl: res.url, lastRoute: res.route })
  }
  return { ...ctrl, onRun }
}

export function ImageToImageNode({ id, selected, data }: NodeProps) {
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'flux-kontext-pro-i2i',
    filter: m => !/upscale|background|object-eraser|face-swap|relight|dress-change|extension|reframe|skin|color-photo|ghibli|anime|product-shot|product-photography|portrait-stylist|photo-pack|watermark/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  if (data.aspectRatio) pills.push({ label: String(data.aspectRatio) })
  return (
    <ImageFirstNode id={id} title="Image → Image" category="image" selected={selected as boolean}
      simpleExplanation="Give it a photo + a description and it transforms the photo. Like 'make this look like an oil painting.'"
      inputs={[{ id: 'image', label: 'Source Image', type: 'image' }, { id: 'text', label: 'Prompt', type: 'text' }]}
      outputs={[{ id: 'image', label: 'New Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
      <PromptArea data={data} id={id} />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function UpscaleNode({ id, selected, data }: NodeProps) {
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'topaz-image-upscale',
    filter: m => /upscale|upscaler/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  if (data.scale) pills.push({ label: `${data.scale}x` })
  return (
    <ImageFirstNode id={id} title="Upscale" category="image" selected={selected as boolean}
      simpleExplanation="Makes small or blurry images bigger and sharper. It actually invents new detail — turn a tiny image into a crisp 4K masterpiece."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'HD Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
    </ImageFirstNode>
  )
}

export function BGRemoveNode({ id, selected, data }: NodeProps) {
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'ai-background-remover',
    filter: m => /background|bg-remov|rmbg/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Remove Background" category="image" selected={selected as boolean}
      simpleExplanation="Cuts out the background of any photo automatically. Subject stays, background disappears. Perfect for cutout images."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Cutout', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
    </ImageFirstNode>
  )
}

export function RelightNode({ id, selected, data }: NodeProps) {
  // No native relight on MuAPI in the schema — closest is Flux Kontext with a
  // relight prompt. Keep the node available; route via Replicate/fal once
  // those adapters land (phase 2). For now this surfaces Kontext.
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'flux-kontext-pro-i2i',
    filter: m => /kontext|relight|iclight/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Relight" category="image" selected={selected as boolean}
      simpleExplanation="Changes where the light is coming from in a photo. Make daytime look like sunset, or add dramatic studio lighting — without a studio."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }, { id: 'text', label: 'Lighting Prompt', type: 'text' }]}
      outputs={[{ id: 'image', label: 'Relit Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
      <PromptArea data={data} id={id} placeholder="e.g. warm sunset lighting, studio light left…" />
    </ImageFirstNode>
  )
}

export function InpaintNode({ id, selected, data }: NodeProps) {
  // MuAPI doesn't expose a dedicated inpaint family — Kontext + Nano Banana
  // edit handle inpaint via instruction. Surface those.
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'flux-kontext-pro-i2i',
    filter: m => /kontext|nano-banana.*edit|qwen-image-edit/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Inpaint" category="image" selected={selected as boolean}
      simpleExplanation="Paint over something you don't want and the AI fills it in naturally. Remove people, erase logos — it blends in seamlessly."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }, { id: 'mask', label: 'Mask (painted area)', type: 'mask' }, { id: 'text', label: 'What to fill with', type: 'text' }]}
      outputs={[{ id: 'image', label: 'Edited Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
      <PromptArea data={data} id={id} />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function OutpaintNode({ id, selected, data }: NodeProps) {
  // Outpaint via Ideogram Reframe (aspect-resize) or AI Image Extension.
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'ideogram-v3-reframe',
    filter: m => /reframe|extension|outpaint/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  if (data.aspectRatio) pills.push({ label: String(data.aspectRatio) })
  return (
    <ImageFirstNode id={id} title="Outpaint" category="image" selected={selected as boolean}
      simpleExplanation="Makes your image wider or taller by generating what would be outside the frame. Like zooming out — the AI imagines what's beyond the edges."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }, { id: 'text', label: 'Prompt', type: 'text' }]}
      outputs={[{ id: 'image', label: 'Extended Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
      <PromptArea data={data} id={id} />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function FaceSwapNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'ai-image-face-swap',
    filter: m => /face-swap|pulid/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Face Swap" category="image" selected={selected as boolean}
      simpleExplanation="Put your face (or anyone's face) onto a different body or scene. Handles skin tone, lighting and angle automatically."
      inputs={[{ id: 'source', label: 'Your Face Image', type: 'image' }, { id: 'target', label: 'Target Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Result', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={async () => {
        // Face swap takes TWO images — source (face) + target. Most MuAPI
        // face-swap endpoints expose `images_list` with [target, source].
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          images_list: [data.targetUrl as string, data.sourceUrl as string].filter(Boolean) as string[] as never,
          image_url: data.targetUrl as string | undefined,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { outputUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
    </ImageFirstNode>
  )
}

export function ObjectRemoveNode({ id, selected, data }: NodeProps) {
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'ai-object-eraser',
    filter: m => /object-eraser|object-remove|inpaint/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Object Remove" category="image" selected={selected as boolean}
      simpleExplanation="Point at anything and poof — it's gone. The AI fills in what the background looks like. Remove tourists, wires, anything."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }, { id: 'mask', label: 'Painted Selection', type: 'mask' }]}
      outputs={[{ id: 'image', label: 'Clean Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
    </ImageFirstNode>
  )
}

// Compositor — drag/resize layer editor with two output modes:
//   • Flat: deterministic pixel composite. No AI, no API cost. The
//     polaroid IS the output (whatever you arranged is exactly what
//     gets exported).
//   • AI Blend: flattens the same arrangement, then sends it as the
//     FIRST reference to a multi-ref edit model (Nano Banana Pro Edit,
//     Seedream Edit, etc.). The model uses the layout as a position
//     guide and re-renders with native lighting / perspective match.
//     Best of both worlds — user places, AI blends.
export function CompositorNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'nano-banana-pro-edit',
    filter: m => /nano-banana.*edit|seedream.*edit|qwen-image-edit|flux-redux|flux-kontext.*max|gpt-image-\d(\.\d)?-edit|gpt-image-\d-image-to-image|gpt4o-edit|gpt4o-image-to-image/i.test(m.name),
  })
  const mode = ((data.mode as string) === 'ai' ? 'ai' : 'flat') as 'flat' | 'ai'
  const sceneUrl = data.sceneUrl as string | undefined
  const subjectUrls = [
    data.subjectUrl  as string | undefined,
    data.subject2Url as string | undefined,
    data.subject3Url as string | undefined,
    data.subject4Url as string | undefined,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  const layers = (Array.isArray(data.layers) ? (data.layers as CompLayer[]) : []) as CompLayer[]
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null)

  // Sync wired subject URLs → layers (add new, remove orphans).
  // Position defaults stagger so multiple new layers don't pile up.
  useEffect(() => {
    const currentUrls = new Set(layers.map(l => l.url))
    const wantedSet = new Set(subjectUrls)
    const orphansRemoved = layers.filter(l => wantedSet.has(l.url))
    const next: CompLayer[] = [...orphansRemoved]
    let addedIdx = 0
    for (const url of subjectUrls) {
      if (!currentUrls.has(url)) {
        const offset = (next.length + addedIdx) * 0.08
        next.push({
          url,
          x: Math.min(0.6, 0.2 + offset),
          y: Math.min(0.6, 0.2 + offset),
          scale: 0.5,
        })
        addedIdx++
      }
    }
    const changed =
      next.length !== layers.length ||
      next.some((l, i) => l.url !== layers[i]?.url)
    if (changed) update(id, { layers: next })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectUrls.join('|'), layers.length])

  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  pills.push({ label: mode === 'ai' ? 'ai blend' : 'flat', tone: 'accent' })
  if (mode === 'ai' && ctrl.spec?.name) pills.push({ label: ctrl.spec.name })
  if (layers.length) pills.push({ label: `${layers.length} layer${layers.length === 1 ? '' : 's'}` })

  const handleRun = async () => {
    if (!sceneUrl && layers.length === 0) throw new Error('Wire a scene OR at least one subject.')
    const flatDataUrl = await flattenLayers({ sceneUrl, layers })
    if (mode === 'flat') {
      // Persist the flat composite to R2 so downstream nodes get a
      // stable HTTPS URL (data: URLs don't survive refresh and break
      // IDB blob roundtrips).
      try {
        const { uploadToR2 } = await import('@/lib/store/r2Upload')
        const up = await uploadToR2(flatDataUrl, { prefix: 'generated/compositor-flat' })
        update(id, { outputUrl: up.url })
      } catch (e) {
        console.warn('[compositor flat] R2 upload failed, keeping data: URL', e)
        update(id, { outputUrl: flatDataUrl })
      }
      return
    }
    // AI Blend: upload the flat composite first so the AI model receives
    // an HTTPS ref. Then call the multi-ref edit model with the flat as
    // ref 1 followed by the individual subjects so the model can lock
    // identity per subject while using the flat as the layout guide.
    const { uploadToR2 } = await import('@/lib/store/r2Upload')
    const flatUp = await uploadToR2(flatDataUrl, { prefix: 'generated/compositor-flat' })
    const refs: string[] = [flatUp.url, ...layers.map(l => l.url)]
    const userPrompt = ((data.prompt as string) || '').trim() ||
      'Blend the layers into a single coherent scene. Match lighting, perspective, and color grade across all elements. Preserve the layout from the first reference image exactly.'
    const payload = buildPayload(
      ctrl.spec,
      { ...(data as Record<string, unknown>), prompt: userPrompt },
      { images_list: refs as never, image_url: refs[0] },
    )
    const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
    update(id, { outputUrl: res.url, lastRoute: res.route })
  }

  return (
    <ImageFirstNode id={id} title="Compositor" category="image" selected={selected as boolean}
      simpleExplanation="Visual layer editor. Wire a SCENE + up to 4 SUBJECTS, then drag / resize / reorder them in the polaroid. Two output modes: FLAT (exact pixel composite, no AI) or AI BLEND (sends the arrangement to Nano Banana Pro Edit which re-renders with matched lighting and perspective)."
      inputs={[
        { id: 'subject',      label: 'Subject 1', type: 'image' },
        { id: 'subject2',     label: 'Subject 2', type: 'image' },
        { id: 'subject3',     label: 'Subject 3', type: 'image' },
        { id: 'subject4',     label: 'Subject 4', type: 'image' },
        { id: 'scene',        label: 'Scene',     type: 'image' },
        { id: 'text',         label: 'AI Prompt', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Composited', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={handleRun}
      editorContent={
        <CompositorCanvas
          sceneUrl={sceneUrl}
          layers={layers}
          onChange={next => update(id, { layers: next })}
          selected={selectedLayer}
          onSelect={setSelectedLayer}
        />
      }
    >
      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-1 rounded-full nodrag" style={{ background: 'var(--bg-elevated)' }}>
        {(['flat', 'ai'] as const).map(m => {
          const active = mode === m
          return (
            <button
              key={m}
              type="button"
              onClick={() => update(id, { mode: m })}
              className="flex-1 px-3 py-1 rounded-full text-[10.5px] font-medium uppercase tracking-[0.1em] transition-colors"
              style={active ? {
                background: 'var(--bg-surface)',
                color: 'var(--ink)',
                boxShadow: 'var(--shadow-clay-sm, 0 1px 2px rgba(0,0,0,0.08))',
              } : { color: 'var(--ink-mute)' }}
            >{m === 'flat' ? 'Flat composite' : 'AI blend'}</button>
          )
        })}
      </div>
      {/* When output exists, give the user a way back to the editor. */}
      {Boolean(data.outputUrl) && (
        <button
          type="button"
          onClick={() => update(id, { outputUrl: undefined })}
          className="w-full text-[10.5px] uppercase tracking-[0.1em] py-1.5 rounded-full nodrag transition-colors"
          style={{ background: 'var(--bg-elevated)', color: 'var(--ink-mute)' }}
          title="Clear the result and return to the layer editor"
        >Edit layout again</button>
      )}
      {mode === 'ai' && (
        <>
          {ctrl.controls}
          <PromptArea data={data as Record<string, unknown>} id={id}
            placeholder="Optional — extra direction (e.g. 'natural daylight, subject 1 holds subject 2'). The layout from the editor is automatically used as the layout reference." />
          <NegativePromptArea data={data as Record<string, unknown>} id={id} />
        </>
      )}
      <div className="text-[10px] text-[var(--ink-mute)] flex flex-col gap-0.5">
        <span>{sceneUrl ? '✓ Scene wired' : 'no Scene (transparent backdrop)'}</span>
        <span>{layers.length === 0 ? 'no Subjects (wire 1-4)' : `${layers.length} subject${layers.length === 1 ? '' : 's'} on canvas · drag to move · corner to resize · ▲▼ to reorder · ⌫ to delete`}</span>
      </div>
    </ImageFirstNode>
  )
}

// Reference Sheet — multi-reference image stage. Wire up to 6 photos of
// the SAME subject/location into ref1…ref6 and the node sends all of them
// to a multi-ref edit model (Nano Banana Pro by default) along with the
// prompt. Output is a single image that you can then feed into a
// Compositor as either the subject or scene reference.
export function ReferenceSheetNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'nano-banana-pro-edit',
    // Multi-ref edit models are ideal here (they lock identity across
    // 1-5 refs). gpt4o-edit + gpt4o-image-to-image are included even
    // though they're single-ref, so the OpenAI pill lights up — users
    // who pick them get worse multi-subject coherence than Nano Banana
    // Pro Edit / Seedream Edit, in exchange for OpenAI-direct billing.
    filter: m => /nano-banana.*edit|seedream.*edit|qwen-image-edit|flux-redux|flux-kontext.*max|gpt-image-\d(\.\d)?-edit|gpt-image-\d-image-to-image|gpt4o-edit|gpt4o-image-to-image/i.test(m.name),
  })
  const refUrls = [
    data.ref1Url, data.ref2Url, data.ref3Url,
    data.ref4Url, data.ref5Url, data.ref6Url,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  const wired = refUrls.length

  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/6 refs` })
  return (
    <ImageFirstNode id={id} title="Reference Sheet" category="image" selected={selected as boolean}
      simpleExplanation="Feed up to 6 photos of the SAME thing (a person, a place, a product) and one prompt. The model uses them all as identity / location anchors. Better than asking one model to 'imagine four angles' from a single photo."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'ref6', label: 'Ref 6', type: 'image' },
        { id: 'text', label: 'Prompt', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Sheet', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          images_list: refUrls as never,
          image_url: refUrls[0],
        })
        const res = await runModel(ctrl.slug, payload, {
          apiKeys,
          preferredRoute: data.route as RouteId | undefined,
        })
        update(id, { outputUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1">
        {wired === 0 ? 'Wire some reference images on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired`}
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="e.g. 'Generate a 4-panel reference sheet of this same location from different angles. Keep architecture, materials, and brand identical.'" />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

// ── KIND-LOCKED SHEET GENERATORS ──────────────────────────────────────────
// Three sheet nodes (Character / Environment / Product). Each takes 1-5
// reference photos of the SAME subject, bakes a detailed system prompt
// describing the canonical sheet layout for that subject type, appends
// any user prompt, and runs Nano Banana Pro Edit (or any multi-ref edit
// model). The output is a single sheet image; pipe it into Image→JSON
// to extract a strict spec for downstream compositors.

// Higgsfield-Soul-style photoreal block enriched with Prompt Blue's
// banked learnings ([[prompt-cinematography-vocab]],
// [[prompt-director-formula]], [[prompt-realism-anti-ai-avatar]]).
// Soul's recipe is hi-fidelity skin + lens specs + colour grade + grain
// + lighting language applied at the per-panel level.
const SOUL_STYLE_PEOPLE = `

SOUL-STYLE PHOTO REALISM (apply to every panel):
- Shot on a full-frame mirrorless, 85mm prime at f/2.0, ISO 200, 1/250s. Headshot panels may use 85-135mm portrait band for subject isolation; full-body panels use 35-50mm standard.
- Lighting (name ALL four facets per panel): SOURCE — large diffused softbox or natural window. DIRECTION — 45-degree side-lit (Rembrandt) for headshots, soft top-front for full body. QUALITY — soft, even, no hard shadows. TEMPERATURE — warm 3200-3500K studio neutral.
- Colour grade: Kodak Portra 400 character — warm midtones, gentle roll-off in highlights, slightly desaturated greens.

ANTI-FAKE REALISM (apply to every panel — defaults skip these, name them explicitly):
- Skin: VISIBLE pore detail, peach-fuzz, fine micro-shadow under the eyes, natural redness in the cheeks, subsurface scattering. NO plastic, NO waxy smoothing, NO beauty-filter sheen, NO airbrushing.
- Hair: individual strand definition at the edges, natural flyaways, visible roots, accurate root colour darker than the length if dyed, soft frizz on side-lit panels.
- Eyes: catchlight from the key light, iris texture readable, lashes individually rendered, faint vein in the sclera, natural moisture.
- Hands: anatomically correct — five fingers, accurate fingernail length, visible knuckle creases, no fused joints, no extra fingers.
- Mouth: natural lip texture (vertical lines), slight asymmetry, real teeth shape if visible.
- Subtle film grain throughout. No HDR over-processing, no tone-mapped halos, no over-sharpening artefacts.
- The phrase "ultra realism" is welcome. The phrase "8k" is NOT — it's cargo-cult and pushes toward glossy AI look. Texture nouns (pores, flyaways, roots, fabric weave) do the real work.

ANATOMY: count fingers, symmetric ears, natural shoulder lines, believable neck proportion, real ankle width, no plastic glow on collarbones or jawline.`

const SOUL_STYLE_PLACE = `

SOUL-STYLE PHOTO REALISM (apply to every panel):
- Shot on a full-frame mirrorless. Hero exteriors: 24mm wide at f/8, ISO 100, tripod. Approach / 3/4 angles: 35mm at f/8. Detail callouts: 50mm at f/4-5.6. Interior panels: 24mm at f/4 with available light.
- Lighting per panel matches the labelled time-of-day (name all four facets per panel):
  · GOLDEN HOUR — natural sunlight, side-lit warm 3000K, soft long shadows
  · MIDDAY — natural sunlight, top-front neutral 5500K, short hard shadows
  · BLUE HOUR — natural ambient cool 7000K + practical signage glow warm 3000K, soft mixed
  · NIGHT — signage and practicals only (LED neon, sodium-vapour), pools of light around fixtures, deep shadows
- Architectural detail: visible material grain (brick mortar lines, panel seams, cladding texture, glass reflections, weld lines on steel).
- Composition: 24mm panels use leading lines + layered foreground/midground/background depth. Detail callouts use negative space around the focal element.
- Signage: every letter sharply rendered, no doubled glyphs, no warped kerning, no mirrored logos. Spell brand exactly as in reference image. If reference shows specific letters in a specific font, reproduce them.
- Colour grade: subtle commercial-real-estate look — accurate whites, controlled saturation, clean shadows. No HDR halos around buildings. No fake bloom on signage.
- Sharp focus across the structure; mild atmospheric depth on wider shots. Subtle film grain.`

const SOUL_STYLE_PRODUCT = `

SOUL-STYLE PHOTO REALISM (apply to every panel):
- Shot on a full-frame mirrorless. Hero angles: 50-85mm at f/8, ISO 100, tripod. Detail callouts: 100mm macro at f/11, focus-stacked feel. In-hand panels: 50mm at f/4-5.6 with shallow depth on the hand.
- Lighting (name all four facets):
  · SOURCE — large softbox key, white fill card camera-right, subtle rim from behind
  · DIRECTION — key from upper-left at 45 degrees, fill camera-right at 90 degrees, rim from behind
  · QUALITY — soft, even, no harsh specular hotspots
  · TEMPERATURE — neutral daylight 5500K
- Surface detail (NAME the texture per material): anodised aluminium grain, matte plastic micro-pattern, brushed steel direction, leather pores + grain direction, fabric weave + thread count visible, glass reflections + edge bevels, paper fluting + fibre direction.
- Specular highlights accurate to the material (sharp on glass, soft on matte plastic, broad on brushed metal).
- Branding: every letter / logo / wordmark crisp, no mirrored or scrambled marks, no fake variants. Spell brand exactly as in reference image.
- Composition: hero angles use centred composition with negative space around the product. Detail callouts use macro framing with the focal feature filling 60-70% of the frame.
- Colour grade: clean commercial product look — neutral whites, accurate hues, controlled contrast. Subtle even contact shadow beneath the product (no harsh cast).
- Sharp edge-to-edge focus on the product. Background clean white / very light grey, no clutter. Subtle grain at most. No HDR processing, no fake reflections, no over-sharpening halos.`

const CHARACTER_SHEET_BAKED_PROMPT = `Generate a comprehensive CHARACTER REFERENCE SHEET of the SAME person shown in the reference image(s). Arrange every panel cleanly on a single white / very-light-grey background, like a professional studio model sheet.

LAYOUT (top to bottom):

ROW 1 — HEAD SHOTS (8 panels in a horizontal strip, each labelled below in small sans-serif):
1. "Neutral front" — facing camera, neutral expression
2. "Smile front" — facing camera, warm natural closed-lip or light smile
3. "Thoughtful front" — facing camera, slight brow furrow / contemplative
4. "Right 3/4 profile" — head turned ~45 degrees to subject's right
5. "Left 3/4 profile" — head turned ~45 degrees to subject's left
6. "Right Profile" — full 90 degrees to subject's right
7. "Right Profile" — slight chin raise variant
8. "Left Profile" — full 90 degrees to subject's left

ROW 2 — FULL BODY (4 large panels, labelled "FRONT", "RIGHT SIDE", "BACK", "LEFT SIDE"):
- Standing relaxed, arms at sides, same outfit, same lighting, same neutral background
- Show entire body from head to feet

LEFT COLUMN — SWATCHES (small stacked squares, no labels needed):
- Clothing fabric textures (top, bottom, belt/strap if present)
- Skin tone
- Hair colour
- Eye colour

RIGHT COLUMN — DETAIL CALLOUTS (small panels with labels):
- "Right Hand" — close-up of right hand, fingers visible
- "Shoulder Profile" — close-up of collar and shoulder seam
- One eye in macro detail
- "Overhead view" — top-of-head looking down

BOTTOM RIGHT — ACCESSORIES (if visible in the references):
- Microphone, jewellery, glasses, badge, lanyard — each isolated on the background

HARD RULES:
- SAME exact person across every panel — identical face, body proportions, hair length and colour, skin tone, age, eye colour.
- SAME exact outfit / clothing across every panel unless the references clearly show multiple outfits.
- Even, soft, flat studio lighting. No dramatic shadows.
- Photorealistic, sharp focus, high resolution.
- Labels typed cleanly below each panel in small sans-serif type.
- Use the supplied reference image(s) as the source of truth for facial features, body proportions, clothing, hair, skin. Do NOT invent or change identity.
- Do NOT add text/captions other than the panel labels listed above.${SOUL_STYLE_PEOPLE}`

const ENVIRONMENT_SHEET_BAKED_PROMPT = `Generate a comprehensive ENVIRONMENT / LOCATION REFERENCE SHEET of the SAME place shown in the reference image(s). Arrange every panel cleanly on a single white / light-grey background, like an architect's reference board.

LAYOUT (top to bottom):

ROW 1 — EXTERIOR ANGLES (4-6 panels, labelled below):
- "Hero front" — straight-on wide
- "Right 3/4" — angled view from the right
- "Left 3/4" — angled view from the left
- "Right side"
- "Left side"
- "Rear" — if appropriate

ROW 2 — TIME OF DAY (3-4 panels, labelled):
- "Golden hour"
- "Midday"
- "Blue hour / dusk"
- "Night" (signage lit)

ROW 3 — INTERIOR (if applicable, 2-3 panels): wide, mid, detail.

LEFT COLUMN — SWATCHES (stacked):
- Primary and secondary brand colours
- Wall / cladding material texture
- Roof / signage material
- Floor / pavement material

RIGHT COLUMN — DETAIL CALLOUTS (small panels with labels):
- "Signage close-up" — every letter of the brand name spelled correctly, no mirroring, no scrambled glyphs
- "Entrance"
- "Key architectural detail"

BOTTOM — BRANDING SHEET:
- Brand logo isolated
- Primary / secondary colour chips

HARD RULES:
- SAME exact location across every panel — identical architecture, materials, signage, brand identity.
- ALL brand text and signage spelled correctly. No mirroring or flipping of the logo or text. If the reference shows specific letters, reproduce them exactly.
- Photorealistic, accurate ambient lighting per time-of-day panel.
- Labels typed cleanly below each panel in small sans-serif type.
- Use the supplied reference image(s) as the source of truth for architecture, materials, signage, brand. Do NOT invent or change the place.
- Do NOT add text/captions other than the panel labels listed above.${SOUL_STYLE_PLACE}`

const PRODUCT_SHEET_BAKED_PROMPT = `Generate a comprehensive PRODUCT REFERENCE SHEET of the SAME product shown in the reference image(s). Arrange every panel cleanly on a single white background, like a manufacturer's spec sheet.

LAYOUT (top to bottom):

ROW 1 — HERO ANGLES (5-6 panels, labelled below):
- "Front"
- "Right 3/4"
- "Left 3/4"
- "Right side"
- "Back"
- "Top-down"

ROW 2 — IN-HAND / IN-USE (2-3 panels):
- "In hand" — product held in a hand, neutral pose
- "Mid-use" — product being used as intended
- "Scale reference" — beside a common object for size

ROW 3 — DETAIL CALLOUTS (small panels with labels):
- "Brand mark" — logo / wordmark on the product, spelled correctly
- "Ports / buttons" — interface detail close-up
- "Material / finish" — macro of surface texture

LEFT COLUMN — SWATCHES (stacked):
- All colourways the product comes in (or the colourway shown)
- Material samples

BOTTOM — PACKAGING (if visible in the references):
- Box / sleeve / label isolated

HARD RULES:
- SAME exact product across every panel — identical form factor, proportions, materials, colourway.
- All brand text / logos spelled correctly. No mirroring or flipping.
- Clean white or very neutral background. Even, soft product-photography lighting. No harsh shadows.
- Photorealistic, sharp focus, high resolution.
- Labels typed cleanly below each panel in small sans-serif type.
- Use the supplied reference image(s) as the source of truth for shape, materials, branding. Do NOT invent or change the product.
- Do NOT add text/captions other than the panel labels listed above.${SOUL_STYLE_PRODUCT}`

// B-ROLL BOARD — supporting cutaway frames for video / campaign.
// Multiple short-shot frames tied together by ONE colour grade and
// lighting era. Mixed focal lengths and crop types so an editor has
// real options. Director-formula vocabulary applied per-frame.
const B_ROLL_BOARD_BAKED_PROMPT = `Generate a B-ROLL REFERENCE BOARD — 6-9 cutaway-style frames that share the SAME colour grade, lighting era, and camera language as the reference image(s). Arrange the frames cleanly on a single neutral background like an editor's contact sheet.

LAYOUT (frames labelled below each, in a rough 3x3 or 3x2 grid):

A mix of these shot types — pick the ones that fit the subject in the reference:
  - "Hands close-up" — hands working, touching, holding the subject (50mm at f/2.8, shallow depth, ECU/CU range)
  - "Texture macro" — a tight close-up of a key material from the scene (100mm macro at f/8, focus on grain / weave / surface)
  - "Atmosphere detail" — light catching a surface, steam, condensation, dust motes, fabric movement (50mm at f/4)
  - "Wide establishing" — the environment without the main subject prominent (24-35mm at f/8, full context)
  - "Mid action" — the subject doing something secondary / candid (35-50mm at f/2.8, MS framing)
  - "Over-the-shoulder" — OTS of the subject or an action (35mm at f/2.8)
  - "POV detail" — first-person view of an interaction (24mm at f/2.8)
  - "Tilt-down or tilt-up reveal" — a single frame from a motion shot (35mm at f/4)
  - "Negative space mood" — the subject small in the frame, environment dominant (50mm at f/4 with leading lines / atmosphere)

LIGHTING per frame: ALL frames inherit the SAME source / direction / colour-temperature from the reference scene. Quality may vary slightly (e.g. one macro can have harder light for texture, the wide can have softer fill). Frames must read as having been shot on the same day with the same camera and grade.

COLOUR GRADE per frame: identical across the board — matches the reference. No frame is graded differently.

COMPOSITION per frame: vary deliberately — some centred, some negative-space-led, some rule-of-thirds, some leading lines. Editor needs visual variety inside the same visual world.

HARD RULES:
- The subject / location / product across all frames must be the same one shown in the reference image(s). Do NOT invent new subjects.
- No two frames are identical. Each frame has its own role (hands / texture / atmosphere / wide / mid / OTS / POV / motion-reveal / negative-space).
- Every frame is photoreal at the reference's level of fidelity. Subtle film grain. No HDR halos. No bloom.
- Labels typed cleanly below each frame in small sans-serif. Do NOT add other text or captions.
- Use the supplied reference image(s) as the source of truth for visual language. Match grade pixel-faithfully.${SOUL_STYLE_PLACE}`

// STORYBOARD — sequential narrative panels with shot + action labels.
// Format-aware: numbered panels in reading order, each captioned with
// shot type + camera language + one-line action description.
const STORYBOARD_BAKED_PROMPT = `Generate a SEQUENTIAL STORYBOARD — 6-9 numbered panels showing a narrative beat-by-beat. Arrange the panels in a clean grid (3 columns × 2 or 3 rows) on a neutral background.

EACH PANEL (labelled below the frame):
- "01" through "0N" — numbered in reading order (left-to-right, top-to-bottom)
- Shot type code in capitals: ECU / CU / MS / FS / LS / EWS / OTS / POV
- One-line action description in sentence case

PROGRESSION RULES:
- Establish: panel 01 sets the scene with a wider shot (FS / LS / EWS).
- Build: subsequent panels move closer (MS → CU) to drive emotional intensity.
- Cut: at least one panel breaks the rhythm with an OTS, POV, or detail insert.
- Climax: a tighter shot (CU / ECU) on the key emotional or narrative beat.
- Land: the final panel either returns wide (LS / EWS for resolution) or holds the climax with breathing room.

CONSISTENCY ACROSS PANELS:
- Same subject / character / location across all panels — do NOT swap actors or settings mid-story unless the narrative demands it.
- Same colour grade and lighting era — daylight stays daylight, golden hour stays golden hour, unless a time-cut is explicitly part of the story.
- Same camera character — panels feel shot on the same camera body and lens family, not a mix of styles.

VISUAL STYLE per panel:
- Photoreal hero frames at production-pre-vis quality (not rough sketches). Each panel should look like a captured film still.
- Camera + lens + lighting follow director-formula discipline. Use the SHOT type label to determine framing: ECU = lips/eyes scale, CU = face/chest scale, MS = waist-up, FS = full body, LS = body small in frame, EWS = hero is a dot.

LABELS:
- Below each frame: "01 — CU — Sarah looks up from the coffee, eyes catching the light"
- Capitalise the shot code. Keep action descriptions to one line, present tense.

HARD RULES:
- Same character / subject identity across all panels.
- No new text or captions inside the frames themselves — only the panel labels below.
- Photoreal, sharp, subtle grain, no HDR halos.
- Use the supplied reference image(s) as the canonical look — character, location, costume, palette. Match identity exactly.${SOUL_STYLE_PEOPLE}`

// MASCOT BOARD — brand mascot bible. Designed character (often non-human),
// orthographic views + expressions + poses + brand colours.
const MASCOT_BOARD_BAKED_PROMPT = `Generate a MASCOT REFERENCE BOARD — a brand-mascot bible. Arrange every panel cleanly on a single white background like a professional character design model sheet.

LAYOUT (top to bottom):

ROW 1 — ORTHOGRAPHIC VIEWS (4 panels, labelled below):
- "FRONT" — straight-on, neutral standing pose
- "RIGHT 3/4" — 45-degree turn to subject's right
- "SIDE" — full 90-degree profile
- "BACK" — straight-on from behind

ROW 2 — EXPRESSIONS (6 head-only panels in a horizontal strip, labelled below):
- "Neutral" · "Happy" · "Surprised" · "Thoughtful" · "Excited" · "Determined"
- Same lighting, same angle (3/4 front), same neutral background per panel

ROW 3 — POSES (4-5 panels, labelled below):
- "Waving hello" · "Holding the product" · "Running / mid-action" · "Sitting / relaxed" · "Pointing / presenting"

LEFT COLUMN — BRAND PALETTE (stacked colour swatches, hex labels below each):
- Primary brand colour
- Secondary brand colour
- Accent colour
- Skin / fur / shell base colour
- Outfit or accessory colour

RIGHT COLUMN — DETAIL CALLOUTS (small panels with labels):
- Face close-up (eye + mouth detail)
- Hand / paw close-up
- One signature feature (logo placement, accessory, prop)

BOTTOM — SCALE REFERENCE: the mascot standing next to a generic human silhouette so scale is unambiguous.

HARD RULES:
- SAME exact mascot identity across every panel — shape, colour, proportions, outfit, accessories. Do NOT redesign between panels.
- Style: cleanly rendered illustration / stylized 3D look (NOT photoreal). Lock the style from the reference image(s). If references are 2D, stay 2D; if 3D, stay 3D.
- Even, soft lighting on every panel. White / very-light-grey background.
- Labels typed cleanly below each panel in small sans-serif.
- Do NOT add text inside the frames other than panel labels.
- Use the supplied reference image(s) as the canonical mascot. Reproduce shape, colour, proportions exactly. The reference IS the mascot.

STYLISTIC RULES per Prompt Blue's JSON-vs-text rule: this is a stylized board, so JSON-like attribute language is welcome ("eye_shape: round large", "ear_count: 2", "primary_colour: #F4A12E"). Plain-text descriptions also work.`

// CREATURE BOARD — concept art for creatures / monsters / animals.
// Orthographic views + anatomy callouts + scale + material swatches.
const CREATURE_BOARD_BAKED_PROMPT = `Generate a CREATURE REFERENCE BOARD — a concept art bible for a creature, monster, or designed animal. Arrange every panel cleanly on a single neutral background like a film production design model sheet.

LAYOUT (top to bottom):

ROW 1 — ORTHOGRAPHIC VIEWS (5 panels, labelled below):
- "FRONT" — straight-on, neutral standing or resting pose
- "RIGHT 3/4" — 45-degree turn to subject's right
- "SIDE" — full 90-degree profile
- "BACK" — straight-on from behind
- "TOP-DOWN" — overhead view showing silhouette / spine layout

ROW 2 — DETAIL CALLOUTS (4-5 panels, labelled below):
- "Head / face detail" — close-up of facial features, teeth, eyes
- "Limb / hand / paw / claw detail" — close-up of forelimb tip with notes on grip / weapon
- "Signature feature detail" — wings, horns, tail, dorsal spines — whatever defines this creature
- "Skin / fur / scale / feather macro" — material texture at high magnification
- "Joint / articulation detail" — how a key joint moves, for animation planning

LEFT COLUMN — MATERIAL SWATCHES (stacked, no labels needed):
- Primary skin / fur / scale colour
- Secondary accent colour
- Underbelly / contrast colour
- Eye colour
- Claw / horn / nail material

RIGHT COLUMN — POSE / SILHOUETTE STUDIES (small panels):
- "Hunting / attacking pose"
- "Resting / coiled pose"
- "Threat display" — wings spread, hackles up, mouth open

BOTTOM — SCALE REFERENCE: the creature standing or coiled next to a generic 1.8m human silhouette for unambiguous scale.

HARD RULES:
- SAME exact creature identity across every panel — anatomy, colour, proportions, distinguishing features. Do NOT redesign between panels.
- Style: photoreal concept art OR cleanly rendered 3D — lock the style from the reference image(s). If references are illustration, stay illustration.
- Lighting: soft, even, top-front (showcase lighting, not dramatic). White / very-light-grey background.
- ANATOMICAL CONSISTENCY: limb count, eye count, joint placement, tail length, wing-membrane structure must be identical across every panel. Count and verify.
- Labels typed cleanly below each panel in small sans-serif.
- Do NOT add text inside the frames other than panel labels.
- Use the supplied reference image(s) as the canonical creature. Reproduce shape, colour, anatomy, materials exactly.${SOUL_STYLE_PRODUCT}`

function useSheetNode(
  id: string,
  data: Record<string, unknown>,
  bakedPrompt: string,
) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data, {
    category: 'Image to Image',
    defaultModel: 'nano-banana-pro-edit',
    // Multi-ref edit models are ideal here (they lock identity across
    // 1-5 refs). gpt4o-edit + gpt4o-image-to-image are included even
    // though they're single-ref, so the OpenAI pill lights up — users
    // who pick them get worse multi-subject coherence than Nano Banana
    // Pro Edit / Seedream Edit, in exchange for OpenAI-direct billing.
    filter: m => /nano-banana.*edit|seedream.*edit|qwen-image-edit|flux-redux|flux-kontext.*max|gpt-image-\d(\.\d)?-edit|gpt-image-\d-image-to-image|gpt4o-edit|gpt4o-image-to-image/i.test(m.name),
  })
  const refUrls = [
    data.ref1Url, data.ref2Url, data.ref3Url,
    data.ref4Url, data.ref5Url,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  const wired = refUrls.length
  const subjectJson = ((data.subjectJson as string) || '').trim()
  const hasJsonSpec = subjectJson.length > 0

  const onRun = async () => {
    // Fail loud BEFORE the API call if no refs are wired — otherwise
    // MuAPI returns "images_list: between 1 and 10 image URLs" which
    // points at the wrong layer. The real fix is upstream wiring.
    if (refUrls.length === 0) {
      throw new Error('No reference photos wired. Connect at least 1 image into Ref 1-5 on the left.')
    }
    const userPrompt = ((data.prompt as string) || '').trim()
    // Compose: baked sheet layout + optional wired JSON spec (from
    // Image→JSON upstream — acts as a locked text-anchor for identity)
    // + optional user direction. Same pattern Compositor uses.
    const parts: string[] = [bakedPrompt]
    if (subjectJson) {
      parts.push(`\nSUBJECT SPEC (locked — must match exactly, this is the canonical identity):\n${subjectJson}`)
    }
    if (userPrompt) {
      parts.push(`\nADDITIONAL DIRECTION FROM USER:\n${userPrompt}`)
    }
    const composed = parts.join('\n')
    const payload = buildPayload(ctrl.spec, { ...data, prompt: composed }, {
      images_list: refUrls as never,
      image_url: refUrls[0],
    })
    const res = await runModel(ctrl.slug, payload, {
      apiKeys,
      preferredRoute: data.route as RouteId | undefined,
    })
    update(id, { outputUrl: res.url, lastRoute: res.route })
  }
  return { ctrl, refUrls, wired, hasJsonSpec, subjectJsonLen: subjectJson.length, onRun }
}

export function CharacterBoardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, CHARACTER_SHEET_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="Character Board" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos of a person AND optionally a JSON spec from Image→JSON. Generates a studio model board (8 head expressions, 4 full-body angles, hand/eye/shoulder close-ups, fabric and skin-tone swatches) with anti-fake realism + director-formula lighting baked in. Feed the output into Image→JSON downstream to lock identity for compositors."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Extra Direction (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Sheet', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked Character Board prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter identity lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Optional — extra direction (e.g. 'wearing a navy suit', 'mid-30s, athletic build'). The full sheet layout is already baked in." />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function LocationBoardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, ENVIRONMENT_SHEET_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="Location Board" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos of a place AND optionally a JSON spec. Generates a location reference board — exterior angles, time-of-day variants (golden/midday/blue/night), signage close-ups, brand swatches. Director-formula lens + 4-facet lighting baked per panel. Feed the output into Image→JSON downstream."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Extra Direction (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Sheet', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked Location Board prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter location lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Optional — extra direction (e.g. 'Applegreen forecourt, Dunshaughlin', 'spell APPLEGREEN exactly, do not mirror the logo'). The full sheet layout is already baked in." />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function ProductBoardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, PRODUCT_SHEET_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="Product Board" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos of a product AND optionally a JSON spec. Generates a spec-board — hero angles, in-hand shots, brand-mark and material close-ups, colourway swatches. Director-formula lens + 4-facet softbox lighting baked per panel. Feed the output into Image→JSON downstream."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Extra Direction (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Sheet', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked Product Board prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter product lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Optional — extra direction (e.g. 'matte black colourway', 'show the carry case too'). The full sheet layout is already baked in." />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function BRollBoardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, B_ROLL_BOARD_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="B-roll Board" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos of your scene / subject / product. Generates 6-9 cutaway-style frames sharing one colour grade and lighting era — hands, atmosphere details, environment beats, lifestyle moments. Use for video edit asset library or campaign supporting shots."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Extra Direction (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Board', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked B-roll Board prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter look lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Optional — extra direction (e.g. 'lean into café atmosphere', 'add more hand-detail shots'). The full B-roll layout is already baked in." />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function StoryboardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, STORYBOARD_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="Storyboard" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos of your character / scene / setting + an extra-direction line describing the story beat-by-beat. Generates 6-9 numbered panels, each labelled with shot type (ECU / CU / MS / FS / LS) and a one-line action. Photoreal hero frames at pre-vis quality."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Story Beats (recommended)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Board', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked Storyboard prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter character lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Beat-by-beat story (recommended): e.g. '1. Sarah enters café. 2. Spots stranger across room. 3. They lock eyes. 4. Sarah looks down. 5. Stranger walks over. 6. Sarah looks back up smiling.'" />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function MascotBoardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, MASCOT_BOARD_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="Mascot Board" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos / concept art of a brand mascot. Generates a mascot bible — 4 orthographic views (front / 3-4 / side / back), 6 expressions, 4-5 poses, brand palette swatches, face + hand detail callouts, scale reference next to a human. Locks the mascot for consistent reuse across campaigns."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Extra Direction (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Board', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked Mascot Board prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter mascot lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Optional — extra direction (e.g. 'big-eye chibi style, friendly café shop owner energy', 'mascot is a fox, primary colour #FF6A00'). The full mascot-bible layout is already baked in." />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function CreatureBoardNode({ id, selected, data }: NodeProps) {
  const { ctrl, wired, hasJsonSpec, subjectJsonLen, onRun } = useSheetNode(id, data as Record<string, unknown>, CREATURE_BOARD_BAKED_PROMPT)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (wired) pills.push({ label: `${wired}/5 refs` })
  if (hasJsonSpec) pills.push({ label: 'json locked' })
  return (
    <ImageFirstNode id={id} title="Creature Board" category="image" selected={selected as boolean}
      simpleExplanation="Wire 1-5 photos / concept art of a creature, monster, or designed animal. Generates a creature concept-art bible — 5 orthographic views (front / 3-4 / side / back / top-down), face / limb / signature-feature / texture / joint detail callouts, material swatches (skin / fur / scales / feathers), threat-display + resting + hunting pose silhouettes, scale reference next to a human."
      inputs={[
        { id: 'ref1', label: 'Ref 1', type: 'image' },
        { id: 'ref2', label: 'Ref 2', type: 'image' },
        { id: 'ref3', label: 'Ref 3', type: 'image' },
        { id: 'ref4', label: 'Ref 4', type: 'image' },
        { id: 'ref5', label: 'Ref 5', type: 'image' },
        { id: 'subjectJson', label: 'JSON Spec (optional)', type: 'text' },
        { id: 'text', label: 'Extra Direction (optional)', type: 'text' },
      ]}
      outputs={[{ id: 'image', label: 'Board', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {ctrl.controls}
      <div className="text-[10px] text-[var(--ink-mute)] mt-1 flex flex-col gap-0.5">
        <span>{wired === 0 ? 'Wire 1-5 reference photos on the left.' : `${wired} reference${wired === 1 ? '' : 's'} wired · baked Creature Board prompt active`}</span>
        <span>{hasJsonSpec ? `✓ JSON spec locked (${subjectJsonLen}c)` : 'no JSON spec (optional — wire an Image→JSON for tighter creature lock)'}</span>
      </div>
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Optional — extra direction (e.g. 'six-legged, bioluminescent dorsal stripes, ambush predator', 'wingspan 4m, feathered tail, primary colour deep teal'). The full creature-bible layout is already baked in." />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function OutfitChangeNode({ id, selected, data }: NodeProps) {
  const { spec, controls, onRun } = useImageEditNode(id, data as Record<string, unknown>, {
    category: 'Image to Image',
    defaultModel: 'ai-dress-change',
    filter: m => /dress-change|outfit|fashion|try-on/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (spec?.name) pills.push({ label: spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Outfit Change" category="image" selected={selected as boolean}
      simpleExplanation="Virtually try on different outfits. Describe the clothing and the AI puts it on the person. Great for fashion and e-commerce."
      inputs={[{ id: 'image', label: 'Person Image', type: 'image' }, { id: 'text', label: 'Outfit Description', type: 'text' }]}
      outputs={[{ id: 'image', label: 'Styled Image', type: 'image' }]}
      outputUrl={data.outputUrl as string | undefined}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={onRun}
    >
      {controls}
      <PromptArea data={data} id={id} placeholder="e.g. red formal dress, casual jeans and hoodie…" />
    </ImageFirstNode>
  )
}

// ── VIDEO NODES ───────────────────────────────────────────────────────────────
export function TextToVideoNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Text to Video',
    defaultModel: 'kling-v2.1-master-t2v',
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (data.duration) pills.push({ label: `${data.duration}s` })
  if (data.aspectRatio) pills.push({ label: String(data.aspectRatio) })
  return (
    <ImageFirstNode id={id} title="Text → Video" category="video" selected={selected as boolean}
      simpleExplanation="Type what you want to see and it creates a video. The dropdown shows only what each model truly supports."
      inputs={[{ id: 'text', label: 'Prompt', type: 'text' }]}
      outputs={[{ id: 'video', label: 'Video', type: 'video' }]}
      outputUrl={data.videoUrl as string | undefined}
      outputKind="video"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>)
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { videoUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
      <Label text="Mode preset" />
      <ModePicker id={id} data={data as Record<string, unknown>} />
      <PromptArea data={data as Record<string, unknown>} id={id} />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function ImageToVideoNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Image to Video',
    defaultModel: 'kling-v2.1-master-i2v',
  })
  const hasFirst = !!data.imageUrl
  const hasLast = !!data.endImageUrl
  // Only show "transition mode" if the chosen model actually supports a
  // last_image param — otherwise the second frame is silently ignored.
  const supportsLastFrame = !!ctrl.spec?.params.last_image
  const isTransition = hasFirst && hasLast && supportsLastFrame
  // Multi-ref support: the schema's images_list.maxItems is authoritative.
  // Many i2v models declare images_list as a generic field but cap it at
  // 1 (Sora 2, Veo 3 base, Grok Imagine) — those collapse to single-image.
  // Models with maxItems > 1 (or unbounded) show that many ref handles,
  // capped at 9 to keep the card readable. Schema-driven, no allowlist.
  const imagesListSpec = ctrl.spec?.params.images_list
  const maxRefs = imagesListSpec?.maxItems ?? (imagesListSpec ? 9 : 0)
  const supportsImagesList = maxRefs > 1
  const refCount = Math.min(maxRefs, 9)
  // Keep the sparse layout for thumbnail labels (REF 1/3/5 when user wires
  // ref1+ref3+ref5) and compress for the actual request body.
  const refSlots: Array<string | undefined> = [
    data.ref1Url as string | undefined, data.ref2Url as string | undefined,
    data.ref3Url as string | undefined, data.ref4Url as string | undefined,
    data.ref5Url as string | undefined, data.ref6Url as string | undefined,
    data.ref7Url as string | undefined, data.ref8Url as string | undefined,
    data.ref9Url as string | undefined,
  ]
  const refUrls = refSlots.filter((v): v is string => typeof v === 'string' && v.length > 0)
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (data.duration) pills.push({ label: `${data.duration}s` })
  if (isTransition) pills.push({ label: 'transition' })
  else if (supportsImagesList && refUrls.length) pills.push({ label: `${refUrls.length}/${refCount} refs` })
  // Render only the inputs the chosen model actually accepts. Default Kling
  // collapses to First Frame + Motion Prompt; transition models add Last
  // Frame; multi-ref models add ref handles equal to their maxItems
  // (Pixverse 2, Wan 2.1 Reference 5, Vidu Q1/Q2 7, Seedance Omni 9).
  const inputs: Array<{ id: string; label: string; type?: string }> = [
    { id: 'firstImage', label: 'First Frame', type: 'image' },
  ]
  if (supportsLastFrame) {
    inputs.push({ id: 'lastImage', label: 'Last Frame (optional)', type: 'image' })
  }
  if (supportsImagesList) {
    for (let i = 1; i <= refCount; i++) {
      inputs.push({ id: `ref${i}`, label: `Ref ${i}`, type: 'image' })
    }
  }
  inputs.push({ id: 'text', label: 'Motion Prompt', type: 'text' })
  return (
    <ImageFirstNode id={id} title="Image → Video" category="video" selected={selected as boolean}
      simpleExplanation="Animate a single photo (First Frame), wire First + Last for transition (Veo 3.1), or wire multiple references for reference-conditioned models. Ref handle count is set by the chosen model: Sora 2 / Veo 3 base = 1, Pixverse = 2, Veo 3.1 Reference = 3, Wan 2.1 Reference = 5, Vidu Q1/Q2 + Kling O1 Reference = 7, Seedance Omni = 9. Address each in the prompt as @image1..@imageN."
      inputs={inputs}
      outputs={[{ id: 'video', label: 'Video', type: 'video' }]}
      outputUrl={data.videoUrl as string | undefined}
      outputKind="video"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const firstUrl = data.imageUrl as string | undefined
        // images_list priority: explicit ref1..ref9 wires > firstImage
        // fallback. firstImage stays as image_url for traditional I2V
        // models. buildPayload only forwards what the spec exposes,
        // so both paths coexist cleanly.
        const imagesList: string[] | undefined =
          refUrls.length > 0
            ? refUrls
            : firstUrl ? [firstUrl] : undefined
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          image_url: firstUrl,
          last_image: data.endImageUrl as string | undefined,
          images_list: imagesList,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { videoUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
      <Label text="Mode preset" />
      <ModePicker id={id} data={data as Record<string, unknown>} />
      {(hasFirst || hasLast) && (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <FramePreview label="FIRST" url={data.imageUrl as string} />
          <FramePreview label={supportsLastFrame ? 'LAST' : 'LAST (ignored)'} url={data.endImageUrl as string} />
        </div>
      )}
      {isTransition && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--cat-video)' }} />
          <span className="text-[10px] text-[var(--ink-mute)] uppercase tracking-[0.1em]">Transition mode</span>
        </div>
      )}
      {supportsImagesList && (
        <div className="mt-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--cat-image)' }} />
            <span className="text-[10px] text-[var(--ink-mute)] uppercase tracking-[0.1em]">
              Multi-reference · {refUrls.length}/{refCount} wired · @image1..@image{refCount} in prompt
            </span>
          </div>
          {refUrls.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {refSlots.slice(0, refCount).map((url, i) => (
                url ? <FramePreview key={i} label={`REF ${i + 1}`} url={url} /> : null
              ))}
            </div>
          )}
        </div>
      )}
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder={supportsImagesList ? `Reference each image with @image1..@image${refCount}, e.g. '@image1 walks past @image2 at golden hour'…` : "Describe the motion e.g. 'gentle wind blowing hair'…"} />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

function FramePreview({ label, url }: { label: string; url?: string }) {
  return (
    <div className="rounded-md overflow-hidden border border-[var(--line)]" style={{ aspectRatio: '1 / 1' }}>
      <div className="relative w-full h-full bg-[var(--bg-elevated)]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <span className="text-[9px] text-[var(--ink-faint)] uppercase tracking-wider">empty</span>
          </div>
        )}
        <span
          className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8.5px] font-medium uppercase tracking-wider"
          style={{ background: 'var(--bg-surface)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

export function VideoToVideoNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Video to Video',
    defaultModel: 'runway-aleph-v2v',
    // Exclude video upscale (its own node) and watermark add/remove tools.
    filter: m => !/upscale|watermark|combiner|clipping|captions/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Video → Video" category="video" selected={selected as boolean}
      simpleExplanation="Transform a video's look completely. 'Make this look like anime' or 'make it look like 1970s film.' Same motion, new style."
      inputs={[{ id: 'video', label: 'Source Video', type: 'video' }, { id: 'text', label: 'Style Prompt', type: 'text' }]}
      outputs={[{ id: 'video', label: 'Styled Video', type: 'video' }]}
      outputUrl={data.outputVideoUrl as string | undefined}
      outputKind="video"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          video_url: data.videoUrl as string | undefined,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { outputVideoUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Style description e.g. 'anime style, vibrant colors'…" />
      <NegativePromptArea data={data as Record<string, unknown>} id={id} />
    </ImageFirstNode>
  )
}

export function LipSyncNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Audio to Video',
    defaultModel: 'sync-lipsync',
    filter: m => /lipsync|lip-sync|latent-sync|creatify|veed/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Lip Sync" category="video" selected={selected as boolean}
      simpleExplanation="Upload a video of a person and an audio clip — it animates their lips to match the audio."
      inputs={[{ id: 'video', label: 'Person Video', type: 'video' }, { id: 'audio', label: 'Audio', type: 'audio' }]}
      outputs={[{ id: 'video', label: 'Synced Video', type: 'video' }]}
      outputUrl={data.outputVideoUrl as string | undefined}
      outputKind="video"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          video_url: data.videoUrl as string | undefined,
          audio_url: data.audioUrl as string | undefined,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { outputVideoUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
    </ImageFirstNode>
  )
}

export function VideoUpscaleNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Video to Video',
    defaultModel: 'topaz-video-upscale',
    filter: m => /video-upscaler|video-upscale|topaz-video|seedvr.*video/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Video Upscale" category="video" selected={selected as boolean}
      simpleExplanation="Makes blurry or low-quality videos look sharp and crisp."
      inputs={[{ id: 'video', label: 'Video', type: 'video' }]}
      outputs={[{ id: 'video', label: 'HD Video', type: 'video' }]}
      outputUrl={data.outputVideoUrl as string | undefined}
      outputKind="video"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          video_url: data.videoUrl as string | undefined,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { outputVideoUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
    </ImageFirstNode>
  )
}

export function SpeechToVideoNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  // Speech-driven avatars live in the Audio to Video category (talking-head
  // models that take a portrait + audio and animate the speech).
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Audio to Video',
    defaultModel: 'infinitetalk-image-to-video',
    filter: m => /infinitetalk|avatar|speech-to-video|wan2.2-speech/i.test(m.name),
  })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  return (
    <ImageFirstNode id={id} title="Speech → Video" category="video" selected={selected as boolean}
      simpleExplanation="Take a portrait photo, add a voice recording, and get a video of that person speaking. Perfect for AI avatars."
      inputs={[{ id: 'image', label: 'Portrait Image', type: 'image' }, { id: 'audio', label: 'Speech Audio', type: 'audio' }]}
      outputs={[{ id: 'video', label: 'Talking Video', type: 'video' }]}
      outputUrl={data.videoUrl as string | undefined}
      outputKind="video"
      paramPills={pills}
      hasRunButton onRun={async () => {
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          image_url: data.imageUrl as string | undefined,
          audio_url: data.audioUrl as string | undefined,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        update(id, { videoUrl: res.url, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
    </ImageFirstNode>
  )
}

// ── EDITING NODES ─────────────────────────────────────────────────────────────
export function CropNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Crop" category="edit" selected={selected as boolean}
      simpleExplanation="Cut your image or video to a specific size. Choose 16:9 for YouTube, 9:16 for TikTok, or 1:1 for Instagram. Instant, no AI needed."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Cropped', type: 'image' }]}
    >
      <Label text="Aspect Ratio" />
      <Select value={(data.ratio as string) || '16:9'} onChange={v => update(id, { ratio: v })} options={[
        { id: '16:9', name: '16:9 (YouTube / widescreen)' },
        { id: '9:16', name: '9:16 (TikTok / Reels)' },
        { id: '1:1',  name: '1:1 (Instagram)' },
        { id: '4:3',  name: '4:3 (classic)' },
        { id: '3:4',  name: '3:4 (portrait)' },
        { id: '21:9', name: '21:9 (cinematic)' },
      ]} />
    </BaseNode>
  )
}

export function BlurNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Blur" category="edit" selected={selected as boolean}
      simpleExplanation="Makes things fuzzy. Blur backgrounds, censor things, or create a dreamy soft-focus effect. Slide to control how blurry."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Blurred', type: 'image' }]}
    >
      <Slider label="Blur intensity" value={(data.blur as number) || 10} onChange={v => update(id, { blur: v })} max={50} />
    </BaseNode>
  )
}

export function LevelsNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Levels" category="edit" selected={selected as boolean}
      simpleExplanation="Make your image brighter, darker, or more contrasty. Like the basic sliders in your phone's photo editor but in your workflow."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Adjusted', type: 'image' }]}
    >
      <Slider label="Brightness" value={(data.brightness as number) || 0} onChange={v => update(id, { brightness: v })} min={-100} max={100} />
      <Slider label="Contrast" value={(data.contrast as number) || 0} onChange={v => update(id, { contrast: v })} min={-100} max={100} />
      <Slider label="Highlights" value={(data.highlights as number) || 0} onChange={v => update(id, { highlights: v })} min={-100} max={100} />
    </BaseNode>
  )
}

export function InvertNode({ id, selected }: NodeProps) {
  return (
    <BaseNode id={id} title="Invert" category="edit" selected={selected as boolean}
      simpleExplanation="Flips all colors to their opposite — like a photo negative. Black becomes white. Very useful for flipping masks."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Inverted', type: 'image' }]}
    />
  )
}

export function ExtractFrameNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Extract Frame" category="edit" selected={selected as boolean}
      simpleExplanation="Grab any single frame from a video and save it as a still image. Pick the exact moment you want — frame by frame."
      inputs={[{ id: 'video', label: 'Video', type: 'video' }]}
      outputs={[{ id: 'image', label: 'Frame', type: 'image' }]}
    >
      <Slider label="Frame number" value={(data.frame as number) || 0} onChange={v => update(id, { frame: v })} min={0} max={300} />
    </BaseNode>
  )
}

export function PainterNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const bg = data.imageUrl as string | undefined
  return (
    <BaseNode id={id} title="Painter" category="edit" selected={selected as boolean}
      simpleExplanation="Brush directly on the canvas. Paint MASKS for Inpaint / Object Remove, or sketch overlays that flow downstream as images."
      inputs={[{ id: 'image', label: 'Backdrop (optional)', type: 'image' }]}
      outputs={[{ id: 'image', label: 'Painted', type: 'image' }, { id: 'mask', label: 'Mask', type: 'mask' }]}
    >
      <PainterCanvas
        backgroundUrl={bg}
        onChange={(mask, composite) => {
          // outputUrl flows to image inputs downstream; maskUrl flows to mask inputs.
          update(id, { maskUrl: mask, outputUrl: composite })
        }}
      />
    </BaseNode>
  )
}

// ── MASK NODES ────────────────────────────────────────────────────────────────
export function MaskExtractorNode({ id, selected }: NodeProps) {
  return (
    <BaseNode id={id} title="Mask Extractor" category="mask" selected={selected as boolean}
      simpleExplanation="Click on objects in your image and it automatically traces around them. Magic scissors that cut out exactly what you want."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputs={[{ id: 'mask', label: 'Mask', type: 'mask' }]}
      hasRunButton onRun={async () => {}}
    />
  )
}

export function MaskByTextNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Mask by Text" category="mask" selected={selected as boolean}
      simpleExplanation="Describe what to select — 'the person's hair' or 'the car' — and it draws the selection automatically. No clicking needed."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }, { id: 'text', label: 'What to select', type: 'text' }]}
      outputs={[{ id: 'mask', label: 'Mask', type: 'mask' }]}
      hasRunButton onRun={async () => {}}
    >
      <Textarea value={(data.prompt as string) || ''} onChange={v => update(id, { prompt: v })} placeholder="Describe what to select e.g. 'the sky' or 'the person'…" />
    </BaseNode>
  )
}

export function MatteGrowShrinkNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Matte Grow/Shrink" category="mask" selected={selected as boolean}
      simpleExplanation="Makes your selection slightly bigger or smaller. Use this to clean up rough edges."
      inputs={[{ id: 'mask', label: 'Mask', type: 'mask' }]}
      outputs={[{ id: 'mask', label: 'Adjusted Mask', type: 'mask' }]}
    >
      <Slider label="Grow (+) / Shrink (−)" value={(data.amount as number) || 0} onChange={v => update(id, { amount: v })} min={-20} max={20} />
    </BaseNode>
  )
}

export function MergeAlphaNode({ id, selected }: NodeProps) {
  return (
    <BaseNode id={id} title="Merge Alpha" category="mask" selected={selected as boolean}
      simpleExplanation="Takes your image and your mask and combines them — the masked area becomes transparent. How you get cutout images with no background."
      inputs={[{ id: 'image', label: 'Image', type: 'image' }, { id: 'mask', label: 'Mask', type: 'mask' }]}
      outputs={[{ id: 'image', label: 'Transparent Image', type: 'image' }]}
    />
  )
}

export function VideoMatteNode({ id, selected }: NodeProps) {
  return (
    <BaseNode id={id} title="Video Matte" category="mask" selected={selected as boolean}
      simpleExplanation="Removes the background from every frame of a video automatically. Tracks your subject — like a green screen without the green screen."
      inputs={[{ id: 'video', label: 'Video', type: 'video' }]}
      outputs={[{ id: 'mask', label: 'Video Mask', type: 'mask' }]}
      hasRunButton onRun={async () => {}}
    />
  )
}

// ── INTEGRATION NODES ─────────────────────────────────────────────────────────
export function FigmaImportNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const { apiKeys } = useWorkflowStore()
  const url = (data.figmaUrl as string) || ''
  const imageUrl = data.imageUrl as string | undefined
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  pills.push({ label: 'figma api', tone: 'accent' })
  if (url) {
    try { pills.push({ label: new URL(url).hostname.replace(/^www\./, '') }) } catch {}
  }
  return (
    <ImageFirstNode id={id} title="Import from Figma" category="helper" selected={selected as boolean}
      simpleExplanation="Paste a Figma frame URL. Right-click any frame in Figma → Copy link to selection. Hit Run to pull it in as an image."
      outputs={[{ id: 'image', label: 'Image', type: 'image' }]}
      outputUrl={imageUrl}
      outputKind="image"
      paramPills={pills}
      hasRunButton onRun={async () => {
        if (!apiKeys.figma) throw new Error('Figma PAT missing — add it in Settings.')
        const { parseFigmaUrl, fetchFigmaNodeImage } = await import('@/lib/api/figma')
        const parsed = parseFigmaUrl(url)
        if (!parsed) throw new Error('Could not parse Figma URL — need a frame link.')
        const png = await fetchFigmaNodeImage(apiKeys.figma, parsed.fileKey, parsed.nodeId)
        update(id, { imageUrl: png })
      }}
    >
      <Label text="Figma URL" />
      <Textarea
        value={url}
        onChange={v => update(id, { figmaUrl: v })}
        placeholder="https://www.figma.com/design/…?node-id=…"
      />
    </ImageFirstNode>
  )
}

// ── UPLOAD NODES ──────────────────────────────────────────────────────────────
function useFileToDataUrl(id: string, dataKey: string) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      if (url) update(id, { [dataKey]: url, fileName: file.name })
    }
    reader.readAsDataURL(file)
  }
}

export function ImageUploadNode({ id, selected, data }: NodeProps) {
  const load = useFileToDataUrl(id, 'imageUrl')
  const url = data.imageUrl as string | undefined
  const fileName = data.fileName as string | undefined
  return (
    <BaseNode id={id} title="Upload Image" category="helper" selected={selected as boolean}
      simpleExplanation="Pick an image from your computer. It becomes the starting point for any image workflow."
      outputs={[{ id: 'image', label: 'Image', type: 'image' }]}
    >
      <label
        className="block w-full rounded-md border border-dashed border-[var(--line)] hover:border-[var(--accent)] cursor-pointer transition-colors nodrag overflow-hidden"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) load(f) }}
        />
        {url ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={fileName || 'uploaded'} className="w-full object-contain max-h-40" />
            <div className="absolute bottom-1 left-1 right-1 truncate text-[9.5px] text-[var(--ink-soft)] bg-[var(--bg-surface)]/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
              {fileName || 'image'}
            </div>
          </div>
        ) : (
          <div className="h-24 flex flex-col items-center justify-center gap-1 text-[var(--ink-mute)]">
            <span className="text-[11px]">Click to choose an image</span>
            <span className="text-[9.5px] text-[var(--ink-faint)]">or paste (Ctrl/⌘+V) · PNG, JPG, WebP</span>
          </div>
        )}
      </label>
    </BaseNode>
  )
}

export function VideoUploadNode({ id, selected, data }: NodeProps) {
  const load = useFileToDataUrl(id, 'videoUrl')
  const url = data.videoUrl as string | undefined
  const fileName = data.fileName as string | undefined
  return (
    <BaseNode id={id} title="Upload Video" category="helper" selected={selected as boolean}
      simpleExplanation="Pick a video file (mp4, mov, webm). Feed it into Video → Video, Lip Sync, or other video tools."
      outputs={[{ id: 'video', label: 'Video', type: 'video' }]}
    >
      <label
        className="block w-full rounded-md border border-dashed border-[var(--line)] hover:border-[var(--accent)] cursor-pointer transition-colors nodrag overflow-hidden"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) load(f) }}
        />
        {url ? (
          <div className="relative">
            <video src={url} controls className="w-full max-h-40 bg-black" />
            <div className="absolute bottom-1 left-1 right-1 truncate text-[9.5px] text-[var(--ink-soft)] bg-[var(--bg-surface)]/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
              {fileName || 'video'}
            </div>
          </div>
        ) : (
          <div className="h-24 flex flex-col items-center justify-center gap-1 text-[var(--ink-mute)]">
            <span className="text-[11px]">Click to choose a video</span>
            <span className="text-[9.5px] text-[var(--ink-faint)]">MP4, MOV, WebM</span>
          </div>
        )}
      </label>
    </BaseNode>
  )
}

export function AudioUploadNode({ id, selected, data }: NodeProps) {
  const load = useFileToDataUrl(id, 'audioUrl')
  const url = data.audioUrl as string | undefined
  const fileName = data.fileName as string | undefined
  return (
    <BaseNode id={id} title="Upload Audio" category="helper" selected={selected as boolean}
      simpleExplanation="Pick an audio file (mp3, wav). Feed it into Lip Sync or Speech → Video."
      outputs={[{ id: 'audio', label: 'Audio', type: 'audio' }]}
    >
      <label
        className="block w-full rounded-md border border-dashed border-[var(--line)] hover:border-[var(--accent)] cursor-pointer transition-colors nodrag overflow-hidden"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) load(f) }}
        />
        {url ? (
          <div className="p-2">
            <audio src={url} controls className="w-full" style={{ height: 32 }} />
            <div className="mt-1 truncate text-[9.5px] text-[var(--ink-mute)]">{fileName || 'audio'}</div>
          </div>
        ) : (
          <div className="h-20 flex flex-col items-center justify-center gap-1 text-[var(--ink-mute)]">
            <span className="text-[11px]">Click to choose audio</span>
            <span className="text-[9.5px] text-[var(--ink-faint)]">MP3, WAV, OGG</span>
          </div>
        )}
      </label>
    </BaseNode>
  )
}

// ── URL IMPORT — paste a website link, get its readable content ───────────────
export function UrlImportNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const url = (data.url as string) || ''
  const title = data.pageTitle as string | undefined
  const mode = (data.extractMode as string) || 'free'
  const assets = (data.assets as string[] | undefined) ?? []
  const picked = (data.selectedAssets as string[] | undefined) ?? []

  const toggleAsset = (u: string) => {
    const next = picked.includes(u) ? picked.filter(p => p !== u) : [...picked, u]
    // First pick drives the Cover Image output so it flows to the carousel
    // hook background; the full set stays in data.selectedAssets.
    update(id, { selectedAssets: next, imageUrl: next[0] })
  }

  return (
    <BaseNode id={id} title="Import from URL" category="helper" selected={selected as boolean}
      simpleExplanation="Paste any website link. Free mode extracts the readable text directly ($0). Google mode uses Gemini to clean the text AND recover the page's images and logo. Tap the recovered assets to pick which ones flow into your carousel as references — a tick marks the chosen ones."
      outputs={[
        { id: 'text', label: 'Page Text', type: 'text' },
        { id: 'logo', label: 'Logo', type: 'image' },
        { id: 'image', label: 'Selected Image', type: 'image' },
      ]}
      hasRunButton onRun={async () => {
        if (!url.trim()) throw new Error('Paste a URL first.')
        const res = await fetch('/api/proxy/fetch-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        })
        const j = await res.json()
        if (!j.ok) throw new Error(j.error || `Fetch failed (${res.status})`)
        let composed = [`# ${j.title}`, j.description, j.text].filter(Boolean).join('\n\n')
        if (mode === 'google') {
          composed = await runLLM({
            provider: 'google', model: 'gemini-2.5-flash', apiKeys,
            message:
              'You are cleaning a scraped web page to feed a social-media carousel generator. ' +
              'Extract the main content only: remove navigation, cookie notices, ads, and boilerplate. ' +
              'Keep the title, key selling points, and substantive body as readable prose. ' +
              'Output the cleaned content only, no commentary.\n\n' + composed.slice(0, 12000),
          })
        }
        const foundImages = (j.images as string[] | undefined) ?? (j.image ? [j.image] : [])
        // Auto-pick the cover (og:image / logo) so a first run is useful
        // even before the user touches the gallery.
        const autoPick = j.image ? [j.image] : foundImages.slice(0, 1)
        update(id, {
          result: composed, pageTitle: j.title,
          assets: foundImages, selectedAssets: autoPick, imageUrl: autoPick[0],
          // Detected brand logo → its own output handle for the carousel.
          logoDetected: (j.logo as string | undefined) || autoPick[0],
        })
      }}
    >
      <input
        type="url"
        value={url}
        onChange={e => update(id, { url: e.target.value })}
        placeholder="https://example.com/article"
        className="w-full rounded-full px-3 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />
      <Label text="Extraction" />
      <Select value={mode} onChange={v => update(id, { extractMode: v })} options={[
        { id: 'free', name: 'Free — text only', cost: '$' },
        { id: 'google', name: 'Google — clean text + assets', description: 'Gemini cleans the copy and recovers the page images + logo. Needs a Google key.', cost: '$' },
      ]} />
      {title && (
        <div className="rounded-2xl clay-surface-soft px-2.5 py-2" style={{ background: 'var(--bg-elevated)' }}>
          <p className="text-[11px] font-medium text-[var(--ink)] line-clamp-2">{title}</p>
          <p className="text-[9.5px] text-[var(--ink-mute)] mt-0.5">
            {((data.result as string) || '').length.toLocaleString()} characters · {assets.length} asset{assets.length === 1 ? '' : 's'} recovered
          </p>
        </div>
      )}
      {assets.length > 0 && (
        <>
          <Label text={`Assets — tap to use in carousel (${picked.length} picked)`} />
          <div className="grid grid-cols-3 gap-1.5">
            {assets.map((u, i) => {
              const on = picked.includes(u)
              return (
                <button key={i} type="button" onClick={() => toggleAsset(u)}
                  className="relative rounded-lg overflow-hidden nodrag cursor-pointer transition-all"
                  style={{ outline: on ? '2px solid var(--accent)' : '2px solid transparent', opacity: on ? 1 : 0.7 }}
                  title={on ? 'Selected — tap to remove' : 'Tap to use as carousel reference'}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="w-full aspect-square object-cover"
                    onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }} />
                  {on && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                      style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}>
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </BaseNode>
  )
}

// ── CAROUSEL BOARD — page text → rendered social carousel slides ──────────────
export function CarouselBoardNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const slideCount = (data.slideCount as number) || 6
  // Derive the display set from the per-slide fields (the single source of
  // truth — persisted to IDB, survives reload). No giant `slides` array in
  // the store, which is what blew the localStorage quota.
  const slides = Array.from({ length: 10 }, (_, i) => data[`slide${i + 1}Url`] as string | undefined)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const brandColor = (data.brandColor as string) || '#1B1813'
  const textColor = (data.textColor as string) || '#FBFAF6'
  const accentColor = (data.accentColor as string) || '#EA580C'
  const handle = (data.handle as string) || ''
  const llmUsed = data.llmUsed as string | undefined
  const finish = (data.finish as string) || 'flat'
  const colorMode = (data.colorMode as string) || 'auto'

  const downloadSlide = (dataUrl: string, i: number) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `carousel-slide-${i + 1}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }

  // Bulk export — fire each slide download in sequence. The 250ms gap
  // keeps Chrome from throttling rapid-fire downloads. No zip dep needed.
  const downloadAll = async () => {
    for (let i = 0; i < slides.length; i++) {
      downloadSlide(slides[i], i)
      await new Promise(r => setTimeout(r, 250))
    }
  }

  // One output handle per slide (slide1..slideN follows the count slider),
  // same dynamic-handle pattern as Image→Video's refs.
  const outputs = Array.from({ length: slideCount }, (_, i) => (
    { id: `slide${i + 1}`, label: `Slide ${i + 1}`, type: 'image' }
  ))

  return (
    <BaseNode id={id} title="Carousel Board" category="image" selected={selected as boolean}
      simpleExplanation="Turns any text (wire in an Import from URL, or paste directly) into a ready-to-post social carousel: hook slide, point slides, CTA slide. Wire a Logo in to brand every slide and a Reference Image for the hook background. Finish 'Flat' renders locally for free; 'AI Enhance' passes each slide through Nano Banana Pro Edit (~$0.12/slide). One output handle per slide."
      inputs={[
        { id: 'text', label: 'Source Text', type: 'text' },
        { id: 'logo', label: 'Logo (optional)', type: 'image' },
        { id: 'ref', label: 'Reference Image (optional)', type: 'image' },
      ]}
      outputs={outputs}
      hasRunButton onRun={async () => {
        const source = ((data.sourceText as string) || '').trim()
        if (!source) throw new Error('No source text. Wire an Import from URL node in, or paste text below.')
        const direction = ((data.prompt as string) || '').trim()
        const provider = pickDefaultProvider(apiKeys)
        const model = modelsForProvider(provider)[0]?.model || ''
        const raw = await runLLM({
          provider, model, apiKeys,
          // Direction goes FIRST and is authoritative — it steers audience,
          // angle, and voice above the raw source content.
          message:
            (direction
              ? `PRIMARY BRIEF (this governs everything — audience, angle, voice, offer):\n${direction}\n\n`
              : '') +
            `Using the brief above and the source content below, write a ${slideCount}-slide ` +
            `social media carousel script for this brand.\n` +
            `Slide 1 kind "hook": a scroll-stopping title (max 8 words), optional 1-line body.\n` +
            `Middle slides kind "point": one concrete insight each — title max 10 words, body max 25 words.\n` +
            `Last slide kind "cta": a call to action naming the brand.\n` +
            `Match the brand's real voice and offering from the content — do not invent generic filler.\n` +
            `Respond with STRICT JSON only, no markdown fences:\n` +
            `{"slides":[{"kind":"hook","title":"...","body":"..."}, ...]}\n` +
            `\nSOURCE CONTENT:\n${source.slice(0, 9000)}`,
        })
        const json = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '').trim()
        let parsed: { slides?: CarouselSlide[] }
        try { parsed = JSON.parse(json) } catch {
          throw new Error('LLM returned unparseable JSON — run again.')
        }
        if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
          throw new Error('LLM returned no slides — run again.')
        }
        // Wired brand assets — failures downgrade gracefully to no asset.
        let logoImg: HTMLImageElement | undefined
        let bgImg: HTMLImageElement | undefined
        if (data.logoUrl) logoImg = await loadImage(data.logoUrl as string).catch(() => undefined) ?? undefined
        if (data.refImageUrl) bgImg = await loadImage(data.refImageUrl as string).catch(() => undefined) ?? undefined

        // Auto theme: sample real brand colors from the logo (preferred) or
        // reference image, so slides match the site. Manual mode keeps the
        // pickers.
        let style = { brandColor, textColor, accentColor, handle }
        if (colorMode === 'auto') {
          const src = logoImg || bgImg
          if (src) {
            const t = sampleBrandTheme(src)
            style = { ...t, handle }
            update(id, { brandColor: t.brandColor, textColor: t.textColor, accentColor: t.accentColor })
          }
        }

        // AI mode: render WITHOUT the logo, enhance, then composite the logo
        // on top so the model can't mangle it. Flat mode bakes it directly.
        const renderAssets = finish === 'ai' ? { bg: bgImg } : { logo: logoImg, bg: bgImg }
        let rendered = parsed.slides.map((s, i) => renderSlide(s, i, parsed.slides!.length, style, renderAssets))

        if (finish === 'ai') {
          const enhanced: string[] = []
          for (const slideUrl of rendered) {
            const res = await runModel('nano-banana-pro-edit', {
              prompt:
                'Elevate this social media slide design: add subtle depth, soft gradients, ' +
                'and premium texture to the background. KEEP every word of text EXACTLY as-is, ' +
                'same position, same size, fully readable. Do not add new text or objects.',
              images_list: [slideUrl],
            }, { apiKeys, preferredRoute: data.route as RouteId | undefined })
            enhanced.push(res.url)
          }
          // Re-stamp the logo crisply on top of every enhanced slide.
          rendered = logoImg
            ? await Promise.all(enhanced.map(u => compositeLogo(u, logoImg!)))
            : enhanced
        }

        // Clear any stale slide fields beyond the new count, then set the
        // fresh set. imageUrl mirrors slide 1 for the node's own preview.
        const slidePatch: Record<string, unknown> = {}
        for (let i = 0; i < 10; i++) slidePatch[`slide${i + 1}Url`] = rendered[i] ?? undefined
        update(id, {
          ...slidePatch,
          imageUrl: rendered[0],
          llmUsed: `${provider} · ${model}${finish === 'ai' ? ' + nano-banana-pro-edit' : ''}`,
        })
      }}
    >
      <Label text="Colors" />
      <Select value={colorMode} onChange={v => update(id, { colorMode: v })} options={[
        { id: 'auto', name: 'Auto — match brand', description: 'Samples real colors from the wired Logo / Reference Image.' },
        { id: 'custom', name: 'Custom — pick manually' },
      ]} />
      {colorMode === 'custom' && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label text="Background" />
            <input type="color" value={brandColor} onChange={e => update(id, { brandColor: e.target.value })}
              className="w-full h-7 rounded-md nodrag cursor-pointer border-0" style={{ background: 'var(--bg-elevated)' }} />
          </div>
          <div>
            <Label text="Text" />
            <input type="color" value={textColor} onChange={e => update(id, { textColor: e.target.value })}
              className="w-full h-7 rounded-md nodrag cursor-pointer border-0" style={{ background: 'var(--bg-elevated)' }} />
          </div>
          <div>
            <Label text="Accent" />
            <input type="color" value={accentColor} onChange={e => update(id, { accentColor: e.target.value })}
              className="w-full h-7 rounded-md nodrag cursor-pointer border-0" style={{ background: 'var(--bg-elevated)' }} />
          </div>
        </div>
      )}
      <Label text="Slides" />
      <Slider label="Count" value={slideCount} onChange={v => update(id, { slideCount: v })} min={4} max={10} step={1} />
      <Label text="Finish" />
      <Select value={finish} onChange={v => update(id, { finish: v })} options={[
        { id: 'flat', name: 'Flat — rendered locally', cost: '$' },
        { id: 'ai', name: 'AI Enhance — Nano Banana Pro Edit', description: `Each slide gets an AI design pass. ~$0.12 × ${slideCount} slides ≈ $${(0.12 * slideCount).toFixed(2)}`, cost: '$$$' },
      ]} />
      <input
        type="text"
        value={handle}
        onChange={e => update(id, { handle: e.target.value })}
        placeholder="@yourbrand"
        className="w-full rounded-full px-3 py-1.5 text-[11px] nodrag clay-surface-soft border-0 focus:outline-none placeholder-[var(--ink-faint)]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--ink)' }}
      />
      <Label text="Direction (optional)" />
      <PromptArea data={data as Record<string, unknown>} id={id} placeholder="Steer the script — e.g. 'punchy, for Irish EV buyers, lead with price' or 'professional LinkedIn tone'…" />
      <Label text="Source text (or wire Import from URL)" />
      <Textarea
        value={(data.sourceText as string) || ''}
        onChange={v => update(id, { sourceText: v })}
        placeholder="Paste article text here, or wire an Import from URL node into the Source Text handle…"
        lint={false}
      />
      {llmUsed && (
        <p className="text-[9.5px] text-[var(--ink-faint)]">script by {llmUsed} · slides rendered locally, $0</p>
      )}
      {slides.length > 0 && (
        <>
          <button type="button" onClick={downloadAll}
            className="clay-press w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-[11.5px] font-medium nodrag mt-1"
            style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}>
            Download all {slides.length} slides
          </button>
          <Label text="Or click a single slide to download" />
          <div className="grid grid-cols-3 gap-1.5">
            {slides.map((s, i) => (
              <button key={i} type="button" onClick={() => downloadSlide(s, i)}
                className="relative rounded-lg overflow-hidden nodrag cursor-pointer hover:brightness-110 transition-all"
                title={`Download slide ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s} alt={`Slide ${i + 1}`} className="w-full aspect-[4/5] object-cover" />
                <span className="absolute bottom-0.5 right-1 text-[8px] font-semibold text-white/80">{i + 1}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </BaseNode>
  )
}

// ── HELPER NODES ──────────────────────────────────────────────────────────────
export function CompareNode({ id, selected }: NodeProps) {
  return (
    <BaseNode id={id} title="Compare" category="helper" selected={selected as boolean}
      simpleExplanation="Put two images side by side with a draggable slider. Perfect for before/after."
      inputs={[{ id: 'before', label: 'Before', type: 'image' }, { id: 'after', label: 'After', type: 'image' }]}
      outputs={[]}
    >
      <div className="w-full h-16 bg-[var(--bg-elevated)] rounded-md border border-[var(--line)] flex items-center justify-center">
        <span className="text-[var(--ink-faint)] text-[11px]">Before / After preview</span>
      </div>
    </BaseNode>
  )
}

export function StickyNoteNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <div className={`rounded-xl p-3 min-w-[160px] border ${selected ? 'border-[var(--cat-helper)]' : 'border-[var(--cat-helper)]/30'}`}
      style={{ background: 'var(--accent-tint)' }}>
      <p className="text-[10px] text-[var(--cat-helper)] mb-1 uppercase tracking-wide">Note</p>
      <textarea
        value={(data.note as string) || ''}
        onChange={e => update(id, { note: e.target.value })}
        placeholder="Write a note…"
        rows={4}
        className="w-full bg-transparent text-[11px] text-[var(--ink)] nodrag resize-none focus:outline-none placeholder-[var(--ink-faint)]"
      />
    </div>
  )
}

export function IteratorNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  return (
    <BaseNode id={id} title="Iterator" category="helper" selected={selected as boolean}
      simpleExplanation="Run the same process on multiple images at once. Instead of generating 10 images one by one, the Iterator does them in a batch."
      inputs={[{ id: 'any', label: 'List of inputs', type: 'any' }]}
      outputs={[{ id: 'any', label: 'List of outputs', type: 'any' }]}
    >
      <Slider label="Batch size" value={(data.batchSize as number) || 3} onChange={v => update(id, { batchSize: v })} min={1} max={20} step={1} />
    </BaseNode>
  )
}

// ── 3D NODE — schema-driven dispatcher, surfaces Meshy 6 + Tripo3D ────────────
export function ImageTo3DNode({ id, selected, data }: NodeProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  // Schema-driven: every "Image to 3D" model surfaces (Meshy 6, Tripo3D
  // H31/P1) plus the legacy Meshy v4 direct routes. Default = Tripo3D
  // H31 image-to-3d ($0.30) — cheapest decent-quality path.
  const ctrl = useModelControls(id, data as Record<string, unknown>, {
    category: 'Image to 3D',
    defaultModel: 'tripo3d-h31-image-to-3d',
    // 3D only runs on Meshy (direct) or Loometo/MuAPI (Tripo, Meshy 6) —
    // OpenAI/Gemini can't do 3D, so don't offer them here.
    providers: ['muapi', 'meshy'],
  })
  const hasImage = !!data.imageUrl
  const hasImagesList = !!ctrl.spec?.params.images_list
  const acceptsImage = !!ctrl.spec?.params.image_url
  const acceptsPrompt = !!ctrl.spec?.params.prompt
  // Multi-view models (Tripo3D H31 Multiview, Meshy 6 Multi-image) take
  // up to 4 angle photos of the same subject.
  const multiRefSlots: Array<string | undefined> = [
    data.ref1Url as string | undefined, data.ref2Url as string | undefined,
    data.ref3Url as string | undefined, data.ref4Url as string | undefined,
  ]
  const multiRefUrls = multiRefSlots.filter((v): v is string => typeof v === 'string' && v.length > 0)
  const inputs: Array<{ id: string; label: string; type?: string }> = []
  if (acceptsImage) inputs.push({ id: 'image', label: hasImagesList ? 'Image' : 'Image (optional)', type: 'image' })
  if (hasImagesList) {
    inputs.push({ id: 'ref1', label: 'Front', type: 'image' })
    inputs.push({ id: 'ref2', label: 'Side', type: 'image' })
    inputs.push({ id: 'ref3', label: 'Back', type: 'image' })
    inputs.push({ id: 'ref4', label: 'Top', type: 'image' })
  }
  if (acceptsPrompt) inputs.push({ id: 'text', label: 'Prompt', type: 'text' })
  const pills: Array<{ label: string; tone?: 'default' | 'accent' }> = []
  if (ctrl.spec?.name) pills.push({ label: ctrl.spec.name, tone: 'accent' })
  if (data.topology) pills.push({ label: String(data.topology) })
  if (data.target_polycount) pills.push({ label: `${data.target_polycount} polys` })
  if (hasImagesList && multiRefUrls.length) pills.push({ label: `${multiRefUrls.length}/4 views` })
  return (
    <ImageFirstNode id={id} title="Image → 3D" category="edit" selected={selected as boolean}
      simpleExplanation="Generate a 3D mesh from one image, multiple angle photos, or a text prompt. Tripo3D H31 ($0.20-$0.30) is the cheapest; Meshy 6 ($0.50) is most detailed. Drag the mesh to rotate. After the GLB loads, a 2D snapshot is auto-captured so downstream image nodes have a usable image to consume; download serves the .glb."
      inputs={inputs}
      outputs={[
        { id: 'image', label: 'Rendered Shot', type: 'image' },
        { id: 'mesh', label: 'Mesh (GLB)', type: 'mesh' },
      ]}
      outputUrl={data.outputUrl as string | undefined}
      meshUrl={data.glbUrl as string | undefined}
      outputKind="mesh"
      onMeshSnapshot={dataUrl => update(id, { outputUrl: dataUrl })}
      paramPills={pills}
      hasRunButton onRun={async () => {
        // buildPayload only forwards what the spec exposes — so passing
        // both image_url and images_list works whether the model takes
        // one or the other.
        const payload = buildPayload(ctrl.spec, data as Record<string, unknown>, {
          image_url: hasImage ? (data.imageUrl as string) : (multiRefUrls[0] as string | undefined),
          images_list: hasImagesList && multiRefUrls.length > 0 ? (multiRefUrls as never) : undefined,
        })
        const res = await runModel(ctrl.slug, payload, { apiKeys, preferredRoute: data.route as RouteId | undefined })
        // Store GLB separately so the snapshot can land on outputUrl.
        // Until the snapshot captures (~half a second post-load), outputUrl
        // stays at the previous run's snapshot or undefined.
        update(id, { glbUrl: res.url, outputUrl: undefined, lastRoute: res.route })
      }}
    >
      {ctrl.controls}
      {hasImagesList && multiRefUrls.length > 0 && (
        <div className="mt-1 grid grid-cols-4 gap-1">
          {multiRefSlots.map((url, i) => (
            url ? <FramePreview key={i} label={['FRONT', 'SIDE', 'BACK', 'TOP'][i]} url={url} /> : null
          ))}
        </div>
      )}
      {acceptsPrompt && (
        <PromptArea data={data as Record<string, unknown>} id={id}
          placeholder={hasImage || multiRefUrls.length ? "Optional — extra direction (e.g. 'PBR materials, low-poly')" : "Describe the 3D object — e.g. 'a stylized wooden chair, low-poly'"} />
      )}
    </ImageFirstNode>
  )
}

// ── OUTPUT NODE ───────────────────────────────────────────────────────────────
export function OutputNode({ id, selected, data }: NodeProps) {
  const [downloading, setDownloading] = useState(false)
  const [stlBusy, setStlBusy] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')

  // Fetch the GLB, convert to STL in-browser, and download it. STL drops
  // color/materials (geometry only) — exactly what a slicer wants.
  const handleDownloadStl = async () => {
    const url = data.meshUrl as string
    if (!url || stlBusy) return
    setStlBusy(true)
    try {
      const glb = await (await fetch(url, { mode: 'cors' })).arrayBuffer()
      const { glbToStl } = await import('@/lib/flow/glbToStl')
      const blob = new Blob([glbToStl(glb)], { type: 'model/stl' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href; a.download = 'loometo-model.stl'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 2000)
    } catch (err) {
      console.error('STL export failed:', err)
      window.alert(`STL export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStlBusy(false)
    }
  }

  const handleDownload = async (kind: 'image' | 'video' | 'audio' | 'mesh') => {
    const url = (kind === 'image' ? data.imageUrl : kind === 'video' ? data.videoUrl : kind === 'audio' ? data.audioUrl : data.meshUrl) as string
    if (!url) return
    setDownloading(true)
    const ext = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'glb'
    try {
      // For data: URLs the anchor trick works directly. For remote
      // (R2 / cross-origin) URLs the browser ignores the `download`
      // attribute and just navigates to the file — so we fetch the bytes
      // ourselves, wrap them in a blob: URL (same-origin), and trigger
      // the anchor on that. blob: URLs honor `download` everywhere.
      let href = url
      let revoke: (() => void) | null = null
      if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) throw new Error(`Download fetch failed: ${res.status}`)
        const blob = await res.blob()
        href = URL.createObjectURL(blob)
        revoke = () => URL.revokeObjectURL(href)
      }
      const a = document.createElement('a')
      a.href = href
      a.download = `loometo-output.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      if (revoke) setTimeout(revoke, 2000)
    } catch (err) {
      console.error('Download failed:', err)
      // Last-resort fallback: open in a new tab so the user can
      // right-click → Save As manually.
      window.open(url, '_blank', 'noopener')
    } finally {
      setTimeout(() => setDownloading(false), 1000)
    }
  }

  const handleCopy = async () => {
    const isImage = !!data.imageUrl
    const url = (data.imageUrl || data.videoUrl) as string
    if (!url) return
    setCopyState('copying')
    try {
      // Prefer real binary copy for images (paste into Figma / Paper / etc.)
      if (isImage && typeof window !== 'undefined' && 'ClipboardItem' in window) {
        const blob = await (await fetch(url)).blob()
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      } else {
        // Videos and fallback path: copy the URL as text
        await navigator.clipboard.writeText(url)
      }
      setCopyState('copied')
    } catch {
      // Last-ditch fallback — copy URL string
      try { await navigator.clipboard.writeText(url); setCopyState('copied') }
      catch { setCopyState('error') }
    }
    setTimeout(() => setCopyState('idle'), 1800)
  }

  return (
    <BaseNode id={id} title="Output" category="output" selected={selected as boolean}
      simpleExplanation="The finish line. Connect image, video, and/or audio here to preview and download each. Pair Veo video + TTS audio here, then combine in your editor (CapCut / DaVinci)."
      inputs={[
        { id: 'image', label: 'Image', type: 'image' },
        { id: 'video', label: 'Video', type: 'video' },
        { id: 'audio', label: 'Audio', type: 'audio' },
        { id: 'mesh', label: '3D Model', type: 'mesh' },
      ]}
      outputs={[]}
    >
      {!!data.imageUrl && (
        <div className="space-y-1.5">
          <ImagePreview url={data.imageUrl as string} />
          <button onClick={() => handleDownload('image')}
            className="clay-press w-full py-2 rounded-full text-[11px] font-medium nodrag"
            style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}>
            {downloading ? 'Downloading…' : 'Download image'}
          </button>
        </div>
      )}
      {!!data.videoUrl && (
        <div className="space-y-1.5 mt-2">
          <VideoPreview url={data.videoUrl as string} />
          <button onClick={() => handleDownload('video')}
            className="clay-press w-full py-2 rounded-full text-[11px] font-medium nodrag"
            style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}>
            {downloading ? 'Downloading…' : 'Download video'}
          </button>
        </div>
      )}
      {!!data.audioUrl && (
        <div className="space-y-1.5 mt-2">
          <audio src={data.audioUrl as string} controls className="w-full rounded-md" />
          <button onClick={() => handleDownload('audio')}
            className="clay-press w-full py-2 rounded-full text-[11px] font-medium nodrag"
            style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}>
            {downloading ? 'Downloading…' : 'Download audio'}
          </button>
        </div>
      )}
      {!!data.meshUrl && (
        <div className="space-y-1.5 mt-2">
          <div className="rounded-2xl overflow-hidden clay-surface-soft nodrag" style={{ aspectRatio: '4 / 3', background: 'var(--bg-canvas)' }}>
            {/* @ts-expect-error model-viewer is a custom element loaded by CDN */}
            <model-viewer src={data.meshUrl as string} camera-controls auto-rotate className="nodrag" style={{ width: '100%', height: '100%', background: 'transparent' }} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => handleDownload('mesh')}
              className="clay-press py-2 rounded-full text-[11px] font-medium nodrag"
              style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}>
              {downloading ? '…' : 'GLB'}
            </button>
            {/* STL = geometry only (no color), the 3D-printing standard.
                Converted from the GLB in-browser, zero server round-trip. */}
            <button onClick={handleDownloadStl}
              className="clay-press py-2 rounded-full text-[11px] font-medium nodrag"
              style={{ background: 'var(--bg-surface)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}
              title="Geometry-only STL for slicers (Cura, PrusaSlicer, Bambu)">
              {stlBusy ? '…' : 'STL (print)'}
            </button>
          </div>
        </div>
      )}
      {!data.imageUrl && !data.videoUrl && !data.audioUrl && !data.meshUrl && (
        <div className="w-full h-20 rounded-2xl flex items-center justify-center clay-surface-soft" style={{ background: 'var(--bg-elevated)' }}>
          <span className="text-[var(--ink-faint)] text-[11px] text-center">Connect image, video, audio,<br />or a 3D model to preview it here</span>
        </div>
      )}
      {!!(data.imageUrl || data.videoUrl) && (
        <button
          onClick={handleCopy}
          className="clay-press w-full mt-2 py-2 rounded-full text-[11px] font-medium nodrag"
          style={{
            background:
              copyState === 'copied' ? 'var(--cat-image)' :
              copyState === 'error' ? 'var(--cat-video)' :
              'var(--bg-surface)',
            color: copyState === 'copied' || copyState === 'error' ? 'var(--bg-surface)' : 'var(--ink-soft)',
          }}
        >
          {copyState === 'copying' ? 'Copying…' :
           copyState === 'copied'  ? 'Copied to clipboard' :
           copyState === 'error'   ? 'Copy failed' :
           'Copy to clipboard'}
        </button>
      )}
    </BaseNode>
  )
}
