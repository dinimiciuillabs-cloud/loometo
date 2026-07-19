// Heavy media (data: URLs for uploads and generated images/videos/audio)
// lives in IndexedDB, not localStorage. localStorage has a ~5MB cap per
// origin which fills after one or two image generations; IDB gets
// hundreds of MB.
//
// Keying: `${nodeId}:${fieldName}` → string (data URL). We snapshot the
// whole map on every save and restore the whole map on hydrate, rather
// than reaching into individual nodes — keeps the call sites trivial.

const DB_NAME  = 'loometo-blobs'
const STORE    = 'blobs'
const VERSION  = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') return Promise.reject(new Error('IDB unavailable on server'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB()
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function blobGet(key: string): Promise<string | undefined> {
  const store = await tx('readonly')
  return new Promise((resolve, reject) => {
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as string | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function blobSet(key: string, value: string): Promise<void> {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const req = store.put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function blobDelete(key: string): Promise<void> {
  const store = await tx('readwrite')
  return new Promise((resolve, reject) => {
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function blobGetAll(): Promise<Record<string, string>> {
  const store = await tx('readonly')
  return new Promise((resolve, reject) => {
    const out: Record<string, string> = {}
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return resolve(out)
      out[cursor.key as string] = cursor.value as string
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

// HEAVY_KEYS in workflowStore.ts list every field that's known to hold
// a media URL. We mirror that list here so we know which fields to
// fish out of node.data for IDB.
const HEAVY_KEYS = [
  'imageUrl', 'endImageUrl', 'subjectUrl', 'sceneUrl',
  'outputUrl', 'videoUrl', 'audioUrl', 'maskUrl',
  'referenceUrl', 'sourceUrl', 'targetUrl', 'beforeUrl', 'afterUrl',
  'thumbnailUrl',
  // ReferenceSheetNode + imageToVideoNode (omni-reference) wires:
  // ref1Url..ref9Url. Boards use 1..5, ReferenceSheet uses 1..6, I2V
  // uses 1..9 for Seedance-style omni-reference models. One list
  // covers all of them.
  'ref1Url', 'ref2Url', 'ref3Url', 'ref4Url', 'ref5Url', 'ref6Url',
  'ref7Url', 'ref8Url', 'ref9Url',
]

// IDB keys are namespaced by workflow name so clearing the canvas or
// switching workflows can't nuke another workflow's blobs. Unnamed
// canvases use a reserved bucket. Key format:
//   wf:${workflow}${nodeId}:${field}
// The  (unit separator) makes the workflow boundary unambiguous
// even if a workflow name contains a colon.
const WF_SEP = ''
const UNNAMED = '__unnamed__'

function wfKey(workflow: string | null | undefined, nodeId: string, field: string): string {
  return `wf:${workflow || UNNAMED}${WF_SEP}${nodeId}:${field}`
}

function parseWfKey(key: string): { workflow: string; nodeId: string; field: string } | null {
  if (!key.startsWith('wf:')) return null
  const rest = key.slice(3)
  const sepIdx = rest.indexOf(WF_SEP)
  if (sepIdx < 0) return null
  const workflow = rest.slice(0, sepIdx)
  const tail = rest.slice(sepIdx + 1)
  const colonIdx = tail.lastIndexOf(':')
  if (colonIdx < 0) return null
  return { workflow, nodeId: tail.slice(0, colonIdx), field: tail.slice(colonIdx + 1) }
}

// Snapshot all heavy-field values from a nodes array into IDB,
// scoped to the given workflow. Orphan sweep only deletes keys
// belonging to THIS workflow — keys in other workflows are left alone.
export async function persistNodeBlobs(
  nodes: Array<{ id: string; data?: Record<string, unknown> }>,
  workflow: string | null = null,
): Promise<number> {
  const writes: Array<Promise<void>> = []
  const liveKeys = new Set<string>()
  for (const n of nodes) {
    const d = n.data
    if (!d) continue
    for (const k of HEAVY_KEYS) {
      const v = d[k]
      if (typeof v === 'string' && v.startsWith('data:')) {
        const key = wfKey(workflow, n.id, k)
        liveKeys.add(key)
        writes.push(blobSet(key, v))
      }
    }
  }
  // Sweep orphans WITHIN THIS WORKFLOW ONLY. Keys for other workflows
  // are untouched.
  const existing = await blobGetAll()
  const ourPrefix = `wf:${workflow || UNNAMED}${WF_SEP}`
  for (const k of Object.keys(existing)) {
    if (!k.startsWith(ourPrefix)) continue
    if (!liveKeys.has(k)) writes.push(blobDelete(k))
  }
  await Promise.all(writes)
  return writes.length
}

// Rehydrate: pull blobs for THIS workflow back onto the nodes array.
// Falls back to legacy unprefixed keys (`${nodeId}:${field}`) so any
// blobs written before the namespacing change still rehydrate once.
export async function rehydrateNodeBlobs<T extends { id: string; data?: Record<string, unknown> }>(
  nodes: T[],
  workflow: string | null = null,
): Promise<T[]> {
  const all = await blobGetAll()
  if (Object.keys(all).length === 0) return nodes
  return nodes.map(n => {
    let patched: Record<string, unknown> | undefined
    for (const k of HEAVY_KEYS) {
      const namespaced = wfKey(workflow, n.id, k)
      const legacy = `${n.id}:${k}`
      const v = all[namespaced] ?? all[legacy]
      if (v) {
        if (!patched) patched = { ...(n.data ?? {}) }
        patched[k] = v
      }
    }
    return patched ? { ...n, data: patched } : n
  })
}

// Delete every blob belonging to a single workflow. Used by
// deleteWorkflow so dead workflows don't leak IDB storage.
export async function deleteWorkflowBlobs(workflow: string | null): Promise<number> {
  const all = await blobGetAll()
  const ourPrefix = `wf:${workflow || UNNAMED}${WF_SEP}`
  const deletes: Array<Promise<void>> = []
  for (const k of Object.keys(all)) {
    if (k.startsWith(ourPrefix)) deletes.push(blobDelete(k))
  }
  await Promise.all(deletes)
  return deletes.length
}
