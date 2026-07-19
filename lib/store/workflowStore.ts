import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Node, Edge, addEdge, applyNodeChanges, applyEdgeChanges, Connection, NodeChange, EdgeChange } from '@xyflow/react'
import { propagateFromNode } from '@/lib/flow/propagate'
import { rehydrateNodeBlobs, deleteWorkflowBlobs } from './blobStore'
import { generateDisplayName, backfillDisplayNames } from '@/lib/flow/nodeNaming'

export interface APIKeys {
  muapi: string
  openai: string
  google: string
  replicate: string
  falai: string
  stability: string
  ideogram: string
  meshy: string
  figma: string
  elevenlabs: string
}


interface WorkflowStore {
  nodes: Node[]
  edges: Edge[]
  apiKeys: APIKeys
  showAPIPanel: boolean
  showMascot: boolean
  selectedNodeId: string | null
  onboardingDismissed: boolean
  // Demo mode — when true, the canvas renders as a read-only showcase:
  // Run buttons hidden, preset/settings disabled, no API key panel,
  // no editing, no canvas-op writes. Used by the public /demo/[slug]
  // route on the marketing site. Lives outside `persist` partialize
  // so it never accidentally bleeds into the editor app.
  demoMode: boolean
  // Node IDs currently in the "external actor is operating on me" state.
  // Painted with a rainbow shimmer in BaseNode so the user can see which
  // node Claude Code / a script just touched. Auto-clears after timeout.
  pulsingNodeIds: string[]
  // Shared lightbox state — any image/video/3d preview can open it via
  // openLightbox(). A single overlay component at app root reads this.
  lightbox: { kind: 'image' | 'video' | '3d'; url: string; thumbnailUrl?: string } | null
  // Auto-save: the name of the workflow we're currently working in. Null
  // means "Untitled" — still persisted to localStorage via partialize, but
  // not duplicated into a named slot.
  currentWorkflowName: string | null
  lastAutoSaveAt: number

  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  addNode: (node: Node) => void
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  deleteNode: (nodeId: string) => void
  deleteEdge: (edgeId: string) => void
  setAPIKeys: (keys: Partial<APIKeys>) => void
  setShowAPIPanel: (show: boolean) => void
  setShowMascot: (show: boolean) => void
  setSelectedNodeId: (id: string | null) => void
  dismissOnboarding: () => void
  resetOnboarding: () => void
  clearCanvas: () => void
  saveWorkflow: (name: string) => void
  loadWorkflow: (name: string) => boolean
  listWorkflows: () => Array<{ name: string; savedAt: number; nodeCount: number }>
  deleteWorkflow: (name: string) => void
  renameWorkflow: (oldName: string, newName: string) => boolean
  duplicateWorkflow: (name: string, newName: string) => boolean
  // Export returns the workflow JSON string (or null if not found). Caller
  // handles the file download. Skeleton only — IDB blobs not embedded.
  exportWorkflow: (name: string) => string | null
  // Import validates shape, then writes under the given name. Returns
  // true on success.
  importWorkflow: (name: string, json: string) => boolean
  pulseNode: (nodeId: string, durationMs?: number) => void
  unpulseNode: (nodeId: string) => void
  openLightbox: (kind: 'image' | 'video' | '3d', url: string, thumbnailUrl?: string) => void
  closeLightbox: () => void
  setCurrentWorkflowName: (name: string | null) => void
  markAutoSaved: () => void
  setDemoMode: (on: boolean) => void
}

const WF_PREFIX = 'loometo:workflow:'

// Strip any field whose value is a base64 data: URL or otherwise large
// enough to torch localStorage. Returns a shallow-cloned node with
// only the slimmed data object. Used by both the live partialize and the
// useAutoSave hook so neither path can quota-bust.
const HEAVY_KEYS = new Set([
  'imageUrl', 'endImageUrl', 'subjectUrl', 'sceneUrl',
  'outputUrl', 'videoUrl', 'audioUrl', 'maskUrl',
  'referenceUrl', 'sourceUrl', 'targetUrl', 'beforeUrl', 'afterUrl',
  'thumbnailUrl',
  'ref1Url', 'ref2Url', 'ref3Url', 'ref4Url', 'ref5Url',
  'ref6Url', 'ref7Url', 'ref8Url', 'ref9Url',
  'logoUrl', 'refImageUrl', 'logoDetected',
  'slide1Url', 'slide2Url', 'slide3Url', 'slide4Url', 'slide5Url',
  'slide6Url', 'slide7Url', 'slide8Url', 'slide9Url', 'slide10Url',
])

export function stripHeavyData<T extends { data?: Record<string, unknown> }>(node: T): T {
  const d = node.data
  if (!d) return node
  let mutated = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d)) {
    const heavy =
      (typeof v === 'string' && v.startsWith('data:')) ||
      // Arrays of data: URLs (e.g. carousel slide sets) blow the quota
      // just as hard as a single blob — drop them from localStorage too.
      (Array.isArray(v) && v.some(x => typeof x === 'string' && x.startsWith('data:'))) ||
      (HEAVY_KEYS.has(k) && typeof v === 'string' && v.length > 2048)
    if (heavy) {
      mutated = true
      continue
    }
    out[k] = v
  }
  return mutated ? { ...node, data: out } : node
}

// Module-scoped timer map for pulseNode. Lives outside the store so we
// don't ferry timer handles through state; node IDs are the keys.
const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      apiKeys: {
        muapi: '',
        openai: '',
        google: '',
        replicate: '',
        falai: '',
        stability: '',
        ideogram: '',
        meshy: '',
        figma: '',
        elevenlabs: '',
      },
      showAPIPanel: false,
      showMascot: true,
      selectedNodeId: null,
      onboardingDismissed: false,
      demoMode: false,
      pulsingNodeIds: [],
      lightbox: null,
      currentWorkflowName: null,
      lastAutoSaveAt: 0,

      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),

      onNodesChange: (changes) =>
        set({ nodes: applyNodeChanges(changes, get().nodes) }),

      onEdgesChange: (changes) => {
        const nextEdges = applyEdgeChanges(changes, get().edges)
        // When edges are added (e.g. via a paste, programmatic connect,
        // or any path that doesn't go through onConnect), re-run
        // propagation from every new edge's source so downstream nodes
        // immediately reflect upstream values that already exist.
        const addedSources = new Set<string>()
        for (const c of changes) {
          if (c.type === 'add' && c.item?.source) addedSources.add(c.item.source)
        }
        let nodes = get().nodes
        addedSources.forEach(src => {
          nodes = propagateFromNode(nodes, nextEdges, src)
        })
        set({ edges: nextEdges, nodes })
      },

      onConnect: (connection) => {
        const newEdges = addEdge(
          { ...connection, type: 'accent' },
          get().edges,
        )
        const nodes = connection.source
          ? propagateFromNode(get().nodes, newEdges, connection.source)
          : get().nodes
        set({ edges: newEdges, nodes })
      },

      addNode: (node) => {
        // Auto-assign a unique short displayName (e.g. "char-board-3",
        // "img-json-1") if the caller didn't supply one. This is the
        // human-readable chip rendered on the node header and the
        // canonical identifier both Blues use when addressing nodes.
        const nodes = get().nodes
        const existingName = node.data?.displayName
        const hasName = typeof existingName === 'string' && existingName.length > 0
        const finalNode: Node = hasName || !node.type
          ? node
          : { ...node, data: { ...(node.data ?? {}), displayName: generateDisplayName(node.type, nodes) } }
        set({ nodes: [...nodes, finalNode] })
      },

      updateNodeData: (nodeId, data) => {
        const merged = get().nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
        )
        const propagated = propagateFromNode(merged, get().edges, nodeId)
        set({ nodes: propagated })
      },

      deleteNode: (nodeId) => {
        set({
          nodes: get().nodes.filter(n => n.id !== nodeId),
          edges: get().edges.filter(e => e.source !== nodeId && e.target !== nodeId),
        })
      },

      deleteEdge: (edgeId) => {
        set({ edges: get().edges.filter(e => e.id !== edgeId) })
      },

      setAPIKeys: (keys) =>
        set({ apiKeys: { ...get().apiKeys, ...keys } }),

      setShowAPIPanel: (show) => set({ showAPIPanel: show }),
      setShowMascot: (show) => set({ showMascot: show }),
      setSelectedNodeId: (id) => set({ selectedNodeId: id }),
      dismissOnboarding: () => set({ onboardingDismissed: true }),
      resetOnboarding: () => set({ onboardingDismissed: false }),
      clearCanvas: () => set({ nodes: [], edges: [], currentWorkflowName: null, lastAutoSaveAt: 0 }),

      saveWorkflow: (name) => {
        const payload = {
          nodes: get().nodes.map(stripHeavyData),
          edges: get().edges,
          savedAt: Date.now(),
          version: 1,
        }
        try {
          localStorage.setItem(WF_PREFIX + name, JSON.stringify(payload))
          set({ currentWorkflowName: name, lastAutoSaveAt: payload.savedAt })
        } catch (e) {
          console.error('Failed to save workflow:', e)
        }
      },

      loadWorkflow: (name) => {
        try {
          const raw = localStorage.getItem(WF_PREFIX + name)
          if (!raw) return false
          const data = JSON.parse(raw)
          if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false
          // Set the skeleton immediately so the canvas re-renders the right
          // nodes + wires, then async-pull blobs from IDB and run
          // propagation. Same dance as onRehydrateStorage, just triggered
          // by manual workflow switching instead of store init.
          set({
            nodes: data.nodes,
            edges: data.edges,
            currentWorkflowName: name,
            lastAutoSaveAt: data.savedAt ?? Date.now(),
          })
          rehydrateNodeBlobs(data.nodes, name).then(fullNodes => {
            const edges = get().edges
            // Migrate older workflows that don't yet have displayName
            // on their nodes — auto-assign unique short names.
            let nodes = backfillDisplayNames(fullNodes as Node[])
            for (const n of nodes) {
              nodes = propagateFromNode(nodes, edges, n.id)
            }
            set({ nodes })
          }).catch(err => console.warn('Blob rehydrate on load failed:', err))
          return true
        } catch (e) {
          console.error('Failed to load workflow:', e)
          return false
        }
      },

      listWorkflows: () => {
        const out: Array<{ name: string; savedAt: number; nodeCount: number }> = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.startsWith(WF_PREFIX)) continue
          try {
            const raw = localStorage.getItem(key)!
            const data = JSON.parse(raw)
            out.push({
              name: key.slice(WF_PREFIX.length),
              savedAt: data.savedAt ?? 0,
              nodeCount: Array.isArray(data.nodes) ? data.nodes.length : 0,
            })
          } catch {
            // skip corrupt entries
          }
        }
        return out.sort((a, b) => b.savedAt - a.savedAt)
      },

      deleteWorkflow: (name) => {
        try { localStorage.removeItem(WF_PREFIX + name) } catch {}
        // Also drop the workflow's IDB blob namespace so storage
        // doesn't leak when a workflow is deleted from the UI.
        deleteWorkflowBlobs(name).catch(err => console.warn('Blob namespace cleanup failed:', err))
      },

      renameWorkflow: (oldName, newName) => {
        const o = oldName.trim()
        const n = newName.trim()
        if (!o || !n || o === n) return false
        try {
          const raw = localStorage.getItem(WF_PREFIX + o)
          if (!raw) return false
          // Don't clobber an existing target slot silently.
          if (localStorage.getItem(WF_PREFIX + n)) return false
          localStorage.setItem(WF_PREFIX + n, raw)
          localStorage.removeItem(WF_PREFIX + o)
          if (get().currentWorkflowName === o) set({ currentWorkflowName: n })
          return true
        } catch (e) {
          console.error('Failed to rename workflow:', e)
          return false
        }
      },

      duplicateWorkflow: (name, newName) => {
        const o = name.trim()
        const n = newName.trim()
        if (!o || !n || o === n) return false
        try {
          const raw = localStorage.getItem(WF_PREFIX + o)
          if (!raw) return false
          if (localStorage.getItem(WF_PREFIX + n)) return false
          // Bump savedAt so the duplicate sorts to the top of the list.
          const parsed = JSON.parse(raw)
          parsed.savedAt = Date.now()
          localStorage.setItem(WF_PREFIX + n, JSON.stringify(parsed))
          return true
        } catch (e) {
          console.error('Failed to duplicate workflow:', e)
          return false
        }
      },

      exportWorkflow: (name) => {
        try { return localStorage.getItem(WF_PREFIX + name) } catch { return null }
      },

      importWorkflow: (name, json) => {
        const n = name.trim()
        if (!n) return false
        try {
          const parsed = JSON.parse(json) as { nodes?: unknown; edges?: unknown; savedAt?: number }
          if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            console.error('Import rejected: missing nodes or edges arrays')
            return false
          }
          // Normalize savedAt so the imported workflow surfaces sensibly
          // in the recent-first list.
          parsed.savedAt = Date.now()
          if (localStorage.getItem(WF_PREFIX + n)) {
            // Caller (UI) decides whether to overwrite — flag by returning
            // false here so the menu can prompt for a new name.
            return false
          }
          localStorage.setItem(WF_PREFIX + n, JSON.stringify(parsed))
          return true
        } catch (e) {
          console.error('Failed to import workflow:', e)
          return false
        }
      },

      pulseNode: (nodeId, durationMs = 1600) => {
        // Add to set if not already; schedule auto-clear after duration.
        const current = get().pulsingNodeIds
        if (!current.includes(nodeId)) {
          set({ pulsingNodeIds: [...current, nodeId] })
        }
        // Each call extends the visible pulse by resetting the timer.
        // Track pending timers on a module-level WeakMap-like object.
        const timers = pulseTimers
        const existing = timers.get(nodeId)
        if (existing) clearTimeout(existing)
        timers.set(nodeId, setTimeout(() => {
          set({ pulsingNodeIds: get().pulsingNodeIds.filter(id => id !== nodeId) })
          timers.delete(nodeId)
        }, durationMs))
      },

      unpulseNode: (nodeId) => {
        const t = pulseTimers.get(nodeId)
        if (t) { clearTimeout(t); pulseTimers.delete(nodeId) }
        set({ pulsingNodeIds: get().pulsingNodeIds.filter(id => id !== nodeId) })
      },

      openLightbox: (kind, url, thumbnailUrl) => set({ lightbox: { kind, url, thumbnailUrl } }),
      closeLightbox: () => set({ lightbox: null }),
      setCurrentWorkflowName: (name) => set({ currentWorkflowName: name }),
      markAutoSaved: () => set({ lastAutoSaveAt: Date.now() }),
      setDemoMode: (on) => set({ demoMode: on }),
    }),
    {
      name: 'loometo-store',
      // localStorage gets the lightweight skeleton: prompts, wires,
      // model + route choices, labels. Heavy media (data: URLs for
      // images/videos/audio) is split into IndexedDB via blobStore.ts —
      // localStorage caps around 5MB and one generated image blows it
      // up. The onRehydrateStorage hook glues the IDB blobs back onto
      // the loaded nodes.
      partialize: (state) => ({
        nodes: state.nodes.map(stripHeavyData),
        edges: state.edges,
        currentWorkflowName: state.currentWorkflowName,
        lastAutoSaveAt: state.lastAutoSaveAt,
        apiKeys: state.apiKeys,
        showMascot: state.showMascot,
        onboardingDismissed: state.onboardingDismissed,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state || typeof window === 'undefined') return
        // Asynchronously fetch blobs from IDB and merge back into state.
        // Then walk every node and run propagation once so downstream
        // nodes pick up the restored URLs through the existing edges —
        // propagation normally fires on updateNodeData / onConnect, but
        // a fresh rehydrate triggers neither.
        // On store init, currentWorkflowName has already rehydrated from
        // localStorage; pass it through so we pull the right namespace.
        // Fall back to "untitled" to match useAutoSave's bucket.
        const wf = state.currentWorkflowName || 'untitled'
        rehydrateNodeBlobs(state.nodes, wf).then(fullNodes => {
          const edges = state.edges
          // Auto-assign displayName to any node that doesn't have one
          // yet (older workflows pre-Phase-1).
          let nodes = backfillDisplayNames(fullNodes as Node[])
          for (const n of nodes) {
            nodes = propagateFromNode(nodes, edges, n.id)
          }
          useWorkflowStore.setState({ nodes })
        }).catch(err => console.warn('Blob rehydrate failed:', err))
      },
    }
  )
)
