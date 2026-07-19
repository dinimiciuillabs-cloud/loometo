'use client'
import { useMemo } from 'react'
import Select from '@/components/ui/Select'
import { type ModelSpec, type ParamSpec } from '@/lib/api/capabilities'
import { listRoutes, type RouteId } from '@/lib/api/router'
import { useCapabilities } from '@/lib/api/useCapabilities'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import RoutePicker from '@/components/ui/RoutePicker'
import ProviderPills from '@/components/ui/ProviderPills'
import { type LLMProvider } from '@/lib/api/llm'
import { isRecommended, cautionFor } from '@/lib/api/recommendations'

// Map of param-name → human label rendered in the node UI. Anything not
// listed here is treated as advanced and hidden (still sent if set).
const LABELS: Record<string, string> = {
  aspect_ratio: 'Aspect Ratio',
  duration: 'Duration (s)',
  resolution: 'Resolution',
  num_images: 'Number of images',
  style: 'Style',
  render_speed: 'Render speed',
  generate_audio: 'Generate audio',
  camera_fixed: 'Lock camera',
  upscale_factor: 'Upscale ×',
  quality: 'Quality',
  size: 'Size',
}

// Common params we surface as a selector. Everything else is silently
// passed through with its default until we explicitly need it.
const SURFACE_PARAMS = Object.keys(LABELS)

function Label({ text }: { text: string }) {
  return (
    <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)] mt-2 mb-1">
      {text}
    </div>
  )
}

// Picks a sensible default value for a param: existing user value > schema
// default > first enum value > undefined.
function valueFor(values: Record<string, unknown>, name: string, p: ParamSpec): unknown {
  if (values[name] !== undefined && values[name] !== null) return values[name]
  if (p.default !== undefined && p.default !== null) return p.default
  if (p.enum && p.enum.length) return p.enum[0]
  return undefined
}

// Render one param as a selector or toggle.
function ParamField({ name, p, value, onChange }: {
  name: string
  p: ParamSpec
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = LABELS[name] ?? name
  if (p.type === 'boolean') {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-[11px] text-[var(--ink-soft)]">{label}</span>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className="w-9 h-5 rounded-full nodrag relative transition-colors"
          style={{ background: value ? 'var(--accent)' : 'var(--bg-elevated)' }}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
            style={{ left: value ? 18 : 2 }}
          />
        </button>
      </div>
    )
  }
  if (p.enum && p.enum.length) {
    const options = p.enum.map(v => ({ id: String(v), name: String(v) }))
    return (
      <>
        <Label text={label} />
        <Select
          value={String(value ?? '')}
          onChange={v => onChange(coerce(p.type, v))}
          options={options}
        />
      </>
    )
  }
  // Numeric without enum — surface as a number input (rare; mostly for
  // num_images, etc.).
  if (p.type === 'int' || p.type === 'integer' || p.type === 'number') {
    return (
      <div className="py-1">
        <Label text={label} />
        <input
          type="number"
          value={typeof value === 'number' ? value : (Number(p.default ?? 0))}
          min={p.minimum}
          max={p.maximum}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full rounded-full px-3 py-1.5 text-[11.5px] text-[var(--ink)] nodrag focus:outline-none clay-surface-soft border-0"
          style={{ background: 'var(--bg-elevated)' }}
        />
      </div>
    )
  }
  return null
}

function coerce(type: string | undefined, v: string): unknown {
  if (type === 'int' || type === 'integer' || type === 'number') return Number(v)
  if (type === 'boolean') return v === 'true'
  return v
}

// Render all surfaceable params for a model. Hides prompt (rendered
// separately by each node) and URL params (those come from input handles).
export default function AutoParamFields({ spec, values, onChange }: {
  spec: ModelSpec
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}) {
  const fields = useMemo(() => {
    return Object.entries(spec.params)
      .filter(([name, p]) => {
        if (name === 'prompt') return false
        if (p.field === 'image' || p.field === 'video' || p.field === 'audio') return false
        return SURFACE_PARAMS.includes(name)
      })
      // Order: aspect → duration → resolution → other surface params.
      .sort(([a], [b]) => SURFACE_PARAMS.indexOf(a) - SURFACE_PARAMS.indexOf(b))
  }, [spec])

  if (fields.length === 0) return null

  return (
    <>
      {fields.map(([name, p]) => (
        <ParamField
          key={name}
          name={name}
          p={p}
          value={valueFor(values, name, p)}
          onChange={v => onChange(name, v)}
        />
      ))}
    </>
  )
}

// Turn a model slug into a readable name, preserving version tokens
// (v2.1, 2.5, 4.5) and known acronyms (AI, T2V, I2V, V2V, GPT, LTX,
// MMAudio, VIDU, OVI, SDXL, SD, PBR). The schema's `variant` field is
// useless on its own — multiple models share "Text to Image".
const ACRONYMS = new Set(['ai','t2v','i2v','v2v','t2i','i2i','gpt','ltx','sd','sdxl','vidu','ovi','pbr','tts','lora','hd','rmbg','sam','vfx','mcp','llm'])
// Cheap-/medium-/premium tier inferred from model slug + category. Used
// only when router.ts doesn't have an explicit costUsd for the model —
// it's a heuristic so EVERY dropdown row shows a $/$$/$$$ badge instead
// of going blank for unmapped models.
//
// Rules (most → least specific):
//   ● Premium markers anywhere in name: pro, master, ultra, max, premium,
//     opus, 4k, gpt-5, claude-opus  → $$$
//   ● Cheap markers anywhere: fast, schnell, lite, mini, nano, turbo,
//     standard, draft, flash, dev   → $
//   ● Video category by default → $$$ (any video gen is expensive)
//   ● Otherwise → $$
const PREMIUM_PAT = /\b(pro|master|ultra|max|premium|opus|4k|gpt-?5|claude-opus|sora-2-pro|veo3\.?1\b|kling-v[23])\b/i
const CHEAP_PAT   = /\b(fast|schnell|lite|mini|nano|turbo|standard|std|draft|flash|dev|hidream-i1-fast|gpt-image-1)\b/i
function tierFromName(slug: string, category: string): '$' | '$$' | '$$$' {
  // Premium always wins over cheap (a "pro fast" model is still premium).
  if (PREMIUM_PAT.test(slug)) return '$$$'
  if (CHEAP_PAT.test(slug)) return '$'
  if (category.toLowerCase().includes('video')) return '$$$'
  return '$$'
}

function prettifyModelName(slug: string): string {
  return slug
    .split('-')
    // Split letter-digit fusions: 'imagen4' → ['imagen','4'], 'wan2.7' → ['wan','2.7']
    .flatMap(part => {
      const m = part.match(/^([a-z]+)(\d.*)$/i)
      return m ? [m[1], m[2]] : [part]
    })
    .map(part => {
      // Preserve version tokens like v2.1, v4.5
      if (/^v\d/i.test(part)) return 'v' + part.slice(1)
      // Preserve bare versions like 2.1, 4.5
      if (/^\d+(\.\d+)?$/.test(part)) return part
      const lower = part.toLowerCase()
      if (ACRONYMS.has(lower)) return part.toUpperCase()
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

// Model picker that lists models in a given category with their description
// and cost (cheapest route from router.ts). Optional `filter` narrows the
// category list further — e.g. UpscaleNode wants only upscale models,
// not every Image-to-Image model.
export function ModelPicker({ category, value, onChange, models, filter }: {
  category: string
  value: string
  onChange: (slug: string) => void
  models: ModelSpec[]
  filter?: (m: ModelSpec) => boolean
}) {
  const options = useMemo(() => {
    return models
      .filter(m => m.category === category && (filter ? filter(m) : true))
      .map(m => {
        const cheapest = listRoutes(m.name)[0]
        // Explicit cost from router > name-based heuristic. Heuristic
        // covers the 200+ models that don't have an entry in ROUTES so
        // every option in the dropdown gets a tier badge.
        const cost = typeof cheapest?.costUsd === 'number'
          ? (cheapest.costUsd < 0.05 ? '$' : cheapest.costUsd < 0.20 ? '$$' : '$$$')
          : tierFromName(m.name, m.category)
        return {
          id: m.name,
          name: prettifyModelName(m.name),
          // Pass the full description — Select truncates inline and expands
          // on deliberate hover so users can read the whole blurb.
          description: m.description,
          cost,
          recommended: isRecommended(category, m.name),
          caution: cautionFor(m.name),
        }
      })
      // Recommended picks float to the top; the rest stay family-grouped
      // (Kling clustered, Veo clustered, etc.) via alpha sort.
      .sort((a, b) =>
        (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0) ||
        a.id.localeCompare(b.id))
  }, [category, models, filter])

  return <Select value={value} onChange={onChange} options={options} />
}

// All-in-one model controls block that every "model-driven" node uses.
// Renders: label row with route picker, model dropdown, auto-rendered
// parameter fields. Each node's only remaining responsibility is its own
// input wiring + the onRun handler.
//
// Returns the resolved { slug, spec } so the parent can build the payload.
// Provider pill IDs (used by ProviderPills) ↔ router route IDs.
const PROVIDER_TO_ROUTE: Record<LLMProvider, RouteId> = {
  openai:     'openai-direct',
  google:     'google-direct',
  muapi:      'muapi',
  meshy:      'meshy-direct',
  // ElevenLabs has no generic image/video routes — it only lights up
  // the TTS node, which uses its own ProviderPills options list. The
  // image/video useModelControls flow never asks ElevenLabs to resolve
  // a model, so mapping to 'muapi' as a placeholder is harmless.
  elevenlabs: 'muapi',
}
const ROUTE_TO_PROVIDER: Partial<Record<RouteId, LLMProvider>> = {
  'openai-direct': 'openai',
  'google-direct': 'google',
  'muapi':         'muapi',
  'meshy-direct':  'meshy',
}

// Default provider pills for generic image/video/edit nodes. Nodes with a
// different real backend set (e.g. the 3D node → Meshy + Loometo) pass
// their own list via opts.providers.
const DEFAULT_PROVIDERS: LLMProvider[] = ['openai', 'google', 'muapi']

export function useModelControls(id: string, data: Record<string, unknown>, opts: {
  category: string
  defaultModel: string
  filter?: (m: ModelSpec) => boolean
  // Which provider pills to show. Defaults to OpenAI/Gemini/Loometo. The
  // 3D node passes ['muapi', 'meshy'] since OpenAI/Gemini can't do 3D.
  providers?: LLMProvider[]
}): { slug: string; spec: ModelSpec | undefined; controls: React.ReactNode } {
  const providerList = opts.providers ?? DEFAULT_PROVIDERS
  const update = useWorkflowStore(s => s.updateNodeData)
  const { models, loading } = useCapabilities()
  const slug = (data.model as string) || opts.defaultModel
  const spec = useMemo(() => models.find(m => m.name === slug), [models, slug])

  // Resolve which provider is currently active: explicit data.route wins
  // — but only if that route is still in the available set (the
  // DISABLE_DIRECT_PROVIDERS flag in router.ts strips google/openai,
  // and a stale data.route from before the flag was set would otherwise
  // make the pill render in a "ghost" inactive state). Falls back to
  // MuAPI since every model has a MuAPI route via DEFAULT_ROUTES.
  const provider: LLMProvider = useMemo(() => {
    const availableRouteIds = new Set(listRoutes(slug).map(r => r.id))
    const r = data.route as RouteId | undefined
    if (r && availableRouteIds.has(r) && ROUTE_TO_PROVIDER[r]) return ROUTE_TO_PROVIDER[r]!
    const firstRoute = listRoutes(slug)[0]?.id
    return (firstRoute && ROUTE_TO_PROVIDER[firstRoute]) || 'muapi'
  }, [data.route, slug])

  // When provider pill changes: set the route, and if the currently
  // selected model isn't available via the new provider, switch to the
  // first model that IS — so the dropdown never shows a model the chosen
  // provider can't run.
  const onProviderChange = (next: LLMProvider) => {
    const newRoute = PROVIDER_TO_ROUTE[next]
    const currentSupports = listRoutes(slug).some(r => r.id === newRoute)
    if (currentSupports) {
      update(id, { route: newRoute })
      return
    }
    const fallback = models.find(m =>
      m.category === opts.category
      && (opts.filter ? opts.filter(m) : true)
      && listRoutes(m.name).some(r => r.id === newRoute)
    )
    update(id, { route: newRoute, ...(fallback ? { model: fallback.name } : {}) })
  }

  // Filter ModelPicker by the active provider so the dropdown only lists
  // models the chosen provider can actually run.
  const providerFilteredFilter = (m: ModelSpec) => {
    const baseOk = opts.filter ? opts.filter(m) : true
    if (!baseOk) return false
    return listRoutes(m.name).some(r => r.id === PROVIDER_TO_ROUTE[provider])
  }

  // For each provider, does ANY model in this category support it? If no,
  // the pill dims out — clicking it would route to nowhere.
  // muapi is the universal fallback so it's always available, but we still
  // compute it for symmetry (in case a future category ever excludes it).
  const unavailable = useMemo(() => {
    const matches = (m: ModelSpec) => m.category === opts.category && (opts.filter ? opts.filter(m) : true)
    const candidates = models.filter(matches)
    const set = new Set<LLMProvider>()
    for (const prov of providerList) {
      const route = PROVIDER_TO_ROUTE[prov]
      const ok = candidates.some(m => listRoutes(m.name).some(r => r.id === route))
      if (!ok) set.add(prov)
    }
    return set
  }, [models, opts.category, opts.filter, providerList])

  const controls = (
    <>
      <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)] mt-1 mb-1">Provider</div>
      {/* Show every provider that has at least one model in this
          category — pills with no key render faded with a tooltip. The
          generic generator nodes (image/video gen + edit + boards) skip
          ElevenLabs since audio isn't in scope; the TTS node passes its
          own options list and includes ElevenLabs there. */}
      <ProviderPills value={provider} onChange={onProviderChange} options={providerList} unavailable={unavailable} />
      <div className="flex items-center justify-between mt-2 mb-1">
        <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {loading ? 'Loading models…' : 'Model'}
        </span>
        <RoutePicker
          modelSlug={slug}
          value={data.route as RouteId | undefined}
          onChange={r => update(id, { route: r })}
        />
      </div>
      {!loading && (
        <ModelPicker
          category={opts.category}
          filter={providerFilteredFilter}
          value={slug}
          onChange={v => update(id, { model: v })}
          models={models}
        />
      )}
      {spec && (
        <AutoParamFields
          spec={spec}
          values={data}
          onChange={(k, v) => update(id, { [k]: v })}
        />
      )}
    </>
  )

  return { slug, spec, controls }
}

// Build the API payload from a spec + the node's data, plus any
// wired-in URLs (image_url, video_url, etc.). Schema-driven: only
// includes params the model actually accepts.
export function buildPayload(
  spec: ModelSpec | undefined,
  data: Record<string, unknown>,
  urls: Record<string, string | string[] | undefined> = {},
): Record<string, unknown> {
  if (!spec) return {}
  const params: Record<string, unknown> = {}
  // Prompt always goes through (most models have it). If the user has
  // supplied a negative prompt, weave it into the prompt text UNLESS
  // the model exposes a native negative_prompt parameter — in that
  // case, leave the prompt alone and let the loop below pass the
  // negative through its dedicated field.
  if (spec.params.prompt && data.prompt) {
    const negRaw = data.negative_prompt
    const neg = typeof negRaw === 'string' ? negRaw.trim() : ''
    const hasNativeNegative = !!spec.params.negative_prompt
    params.prompt = (neg && !hasNativeNegative)
      ? `${data.prompt}\n\nNEGATIVE — must NOT include: ${neg}`
      : data.prompt
  }
  // Wire any provided URLs into params the spec exposes.
  if (spec.params.image_url && urls.image_url) params.image_url = urls.image_url
  if (spec.params.last_image && urls.last_image) params.last_image = urls.last_image
  if (spec.params.video_url && urls.video_url) params.video_url = urls.video_url
  if (spec.params.audio_url && urls.audio_url) params.audio_url = urls.audio_url
  if (spec.params.images_list && urls.images_list) {
    // images_list takes an array of URLs. Drop empty / falsy entries
    // AND omit the field entirely if nothing is left — MuAPI rejects
    // `images_list: []` with a confusing 422 instead of just ignoring
    // the field.
    const v = urls.images_list
    const arr = Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []
    if (arr.length > 0) params.images_list = arr
  }
  // Pull every other surface param from data (or default).
  for (const [pname, pspec] of Object.entries(spec.params)) {
    if (pname === 'prompt') continue
    if (pspec.field === 'image' || pspec.field === 'video' || pspec.field === 'audio') continue
    const v = data[pname] !== undefined ? data[pname] : pspec.default
    if (v !== undefined && v !== null && params[pname] === undefined) params[pname] = v
  }
  return params
}

