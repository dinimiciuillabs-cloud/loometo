// Generation Preset store. A preset is a SAVED node configuration —
// prompt, model, settings, route — that can be reloaded into any
// node of the same type. The point is to make winning configs durable
// so they don't evaporate when the canvas changes.
//
// Lives in localStorage under `loometo:preset:<nodeType>:<presetId>`
// so presets are scoped per node type — a Compositor preset won't
// accidentally land in a Text→Image node.
//
// Reference values that are node-instance state (uploaded images,
// generated outputs, last errors) are STRIPPED before saving — a
// preset is configuration, not media. Heavy data lives in IDB / R2.

// Heavy media fields — values are stored in IDB / R2, not in node.data
// permanently. Stripped from presets so a preset never carries a 30MB
// data: URL inside its JSON. Kept in sync with the lists in
// workflowStore.ts and blobStore.ts.
const HEAVY_KEYS = new Set<string>([
  'imageUrl', 'endImageUrl', 'subjectUrl', 'sceneUrl',
  'outputUrl', 'videoUrl', 'audioUrl', 'maskUrl',
  'referenceUrl', 'sourceUrl', 'targetUrl', 'beforeUrl', 'afterUrl',
  'thumbnailUrl',
  // Multi-ref nodes (ReferenceSheet + the three Sheet generators)
  'ref1Url', 'ref2Url', 'ref3Url', 'ref4Url', 'ref5Url', 'ref6Url',
  // Image→JSON multi-image inputs
  'image1Url', 'image2Url', 'image3Url', 'image4Url', 'image5Url',
])

export interface NodePreset {
  id: string                        // unique stable id (slug of name + timestamp)
  name: string                      // human-readable name
  nodeType: string                  // e.g. 'compositorNode'
  data: Record<string, unknown>     // sanitized snapshot of node.data
  savedAt: number                   // ms epoch
  version: number                   // for future schema migrations
}

const PREFIX = 'loometo:preset:'

// Fields that are ALWAYS node-instance state (not configuration) and
// should never be saved into a preset. Heavy media URLs are also
// excluded via HEAVY_KEYS so we never accidentally serialise a
// 30MB Veo data: URL into a preset slot.
const RUNTIME_KEYS = new Set([
  // Generation runtime state
  'lastError', 'lastRoute', 'isRunning', 'status', 'result',
  // Output URLs of any kind (regenerated on each Run)
  'outputUrl', 'videoUrl', 'audioUrl', 'maskUrl',
  // Display-only labels we shouldn't override on Load
  'title', 'label',
])

function sanitizeForPreset(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (RUNTIME_KEYS.has(k)) continue
    if (HEAVY_KEYS.has(k)) continue
    if (v === undefined || v === null) continue
    // Skip string data: URLs anywhere (defensive in case HEAVY_KEYS misses one)
    if (typeof v === 'string' && v.startsWith('data:')) continue
    out[k] = v
  }
  return out
}

function key(nodeType: string, id: string): string {
  return `${PREFIX}${nodeType}:${id}`
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Save the current node.data as a preset under the given name. Returns
 * the preset id. Strips heavy media + runtime state automatically.
 */
export function savePreset(
  nodeType: string,
  name: string,
  data: Record<string, unknown>,
): NodePreset {
  if (typeof window === 'undefined') {
    throw new Error('savePreset can only run in the browser')
  }
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Preset name required')

  const id = `${slugify(trimmed)}-${Date.now().toString(36)}`
  const preset: NodePreset = {
    id,
    name: trimmed,
    nodeType,
    data: sanitizeForPreset(data),
    savedAt: Date.now(),
    version: 1,
  }
  localStorage.setItem(key(nodeType, id), JSON.stringify(preset))
  return preset
}

/** Get a preset by id + nodeType. Returns null if not found. */
export function getPreset(nodeType: string, id: string): NodePreset | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(key(nodeType, id))
  if (!raw) return null
  try { return JSON.parse(raw) as NodePreset } catch { return null }
}

/**
 * List all presets compatible with the given node type, newest first.
 * Returns the lightweight skeleton — for the full data, call getPreset.
 */
export function listPresets(nodeType: string): Array<Pick<NodePreset, 'id' | 'name' | 'savedAt'>> {
  if (typeof window === 'undefined') return []
  const prefix = `${PREFIX}${nodeType}:`
  const out: NodePreset[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(prefix)) continue
    try {
      const p = JSON.parse(localStorage.getItem(k)!) as NodePreset
      out.push(p)
    } catch {
      // skip corrupt entries
    }
  }
  return out
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(p => ({ id: p.id, name: p.name, savedAt: p.savedAt }))
}

/** Delete a preset by id + nodeType. */
export function deletePreset(nodeType: string, id: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(key(nodeType, id)) } catch {}
}

/**
 * Rename a preset (lightweight — preserves id + data + savedAt).
 */
export function renamePreset(nodeType: string, id: string, newName: string): NodePreset | null {
  const existing = getPreset(nodeType, id)
  if (!existing) return null
  const trimmed = newName.trim()
  if (!trimmed) return existing
  const next: NodePreset = { ...existing, name: trimmed }
  localStorage.setItem(key(nodeType, id), JSON.stringify(next))
  return next
}

/**
 * Export ALL presets for a given node type as a single JSON blob.
 * Useful for sharing winning configs across machines / projects /
 * with another Blue.
 */
export function exportPresets(nodeType: string): string {
  if (typeof window === 'undefined') return '[]'
  const prefix = `${PREFIX}${nodeType}:`
  const all: NodePreset[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(prefix)) continue
    try { all.push(JSON.parse(localStorage.getItem(k)!) as NodePreset) } catch {}
  }
  return JSON.stringify(all, null, 2)
}

/**
 * Import a JSON blob produced by exportPresets. Returns the count
 * imported. Existing presets with the same id are overwritten — the
 * caller should de-dupe upstream if they want merge-not-clobber.
 */
export function importPresets(jsonBlob: string): number {
  if (typeof window === 'undefined') return 0
  let parsed: unknown
  try { parsed = JSON.parse(jsonBlob) } catch { return 0 }
  if (!Array.isArray(parsed)) return 0
  let count = 0
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const p = item as Partial<NodePreset>
    if (!p.id || !p.nodeType || !p.data) continue
    localStorage.setItem(key(p.nodeType, p.id), JSON.stringify(p))
    count++
  }
  return count
}
