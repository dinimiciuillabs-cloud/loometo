// Capabilities loader — sources MuAPI's authoritative model+parameter schema
// from `public/muapi-schema.json` (267 models, complete enums + defaults).
//
// The file is fetched once at runtime and cached for the session. Every
// model selector in the app should pull its allowed values from here so
// we never offer a duration / aspect / preset that the model actually
// rejects.

export interface ParamSpec {
  type?: string             // 'string' | 'int' | 'integer' | 'boolean' | 'array'
  default?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  maxItems?: number         // for array params — caps how many entries the model accepts
  description?: string
  title?: string
  field?: string            // hint: 'image', 'video', 'audio' → expects URL
}

export interface ModelSpec {
  name: string              // canonical slug — also the MuAPI endpoint id
  category: string          // 'Text to Video' | 'Image to Image' | …
  variant: string           // 'Master Text to Video'
  family: string            // 'kling-v2.1'
  group_of?: string         // 'video' | 'image' | 'effects' | …
  description: string
  params: Record<string, ParamSpec>
}

interface RawSchemaEntry {
  name: string
  category: string
  variant: string
  family: string
  group_of?: string
  description: string
  input_schema?: {
    schemas?: {
      input_data?: {
        properties?: Record<string, ParamSpec>
      }
    }
  }
}

let cache: ModelSpec[] | null = null
let inflight: Promise<ModelSpec[]> | null = null

function normalize(raw: RawSchemaEntry[]): ModelSpec[] {
  return raw.map(r => ({
    name: r.name,
    category: r.category,
    variant: r.variant,
    family: r.family,
    group_of: r.group_of,
    description: r.description,
    params: r.input_schema?.schemas?.input_data?.properties ?? {},
  }))
}

// Bump this when muapi-schema.json is hand-edited (new model added,
// param surface changed). The browser caches JSON files in /public/
// aggressively — without a version query, a hard-refresh is required
// every schema change. Format: YYYY-MM-DD-Nn where N=daily edit count.
const SCHEMA_VERSION = '2026-07-06-meshy-direct'

export async function loadCapabilities(): Promise<ModelSpec[]> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = fetch(`/muapi-schema.json?v=${SCHEMA_VERSION}`)
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load muapi-schema.json (HTTP ${r.status})`)
      return r.json() as Promise<RawSchemaEntry[]>
    })
    .then(raw => {
      cache = normalize(raw)
      return cache
    })
    .finally(() => { inflight = null })
  return inflight
}

// Synchronous accessor — only safe after loadCapabilities() has resolved at
// least once. Returns [] until then. UI should call loadCapabilities() at
// boot (e.g. in the workflow store) and then this stays hot.
export function allModelsSync(): ModelSpec[] {
  return cache ?? []
}

export function getModelSpec(name: string): ModelSpec | undefined {
  return (cache ?? []).find(m => m.name === name)
}

export function listModelsByCategory(category: string): ModelSpec[] {
  return (cache ?? []).filter(m => m.category === category)
}

export function listModelsByFamily(family: string): ModelSpec[] {
  return (cache ?? []).filter(m => m.family === family)
}

// Get the allowed values for a parameter. Returns:
//   - The enum list if defined.
//   - For ints with min/max but no enum: null (continuous range — UI should
//     render a number input, not a dropdown).
//   - undefined if the param doesn't exist on this model.
export function getAllowedValues(modelName: string, param: string): unknown[] | null | undefined {
  const m = getModelSpec(modelName)
  if (!m) return undefined
  const p = m.params[param]
  if (!p) return undefined
  if (p.enum && p.enum.length) return p.enum
  return null
}

export function getDefault(modelName: string, param: string): unknown {
  return getModelSpec(modelName)?.params[param]?.default
}

// Heuristic: does this param expect a URL to media the user has uploaded
// or produced upstream? Schema marks these with `field: 'image' | 'video' | 'audio'`.
export function isUrlParam(p: ParamSpec): boolean {
  return p.field === 'image' || p.field === 'video' || p.field === 'audio'
}
