'use client'
import { useEffect, useRef } from 'react'
import { useWorkflowStore, stripHeavyData } from '@/lib/store/workflowStore'
import { persistNodeBlobs } from '@/lib/store/blobStore'

// Debounced auto-save. Watches the live nodes+edges and, every ~800ms
// after the last change, writes them to localStorage under the active
// workflow name (or "untitled" if none). This is in ADDITION to the
// store-level partialize, which already persists the working canvas
// continuously — useAutoSave gives each named workflow its own slot so
// switching between named workflows preserves the per-name state.

const AUTOSAVE_DEBOUNCE_MS = 800
const WF_PREFIX = 'loometo:workflow:'

export function useAutoSave() {
  const nodes = useWorkflowStore(s => s.nodes)
  const edges = useWorkflowStore(s => s.edges)
  const name = useWorkflowStore(s => s.currentWorkflowName)
  const markAutoSaved = useWorkflowStore(s => s.markAutoSaved)

  const firstRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Don't fire on first mount — we just rehydrated, nothing changed yet.
    if (firstRef.current) { firstRef.current = false; return }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const slot = (name && name.trim()) ? name.trim() : 'untitled'
      try {
        const payload = {
          nodes: nodes.map(stripHeavyData),
          edges,
          savedAt: Date.now(),
          version: 1,
        }
        localStorage.setItem(WF_PREFIX + slot, JSON.stringify(payload))
        markAutoSaved()
      } catch (e) {
        console.warn('Auto-save failed:', e)
      }
      // Heavy media → IndexedDB. Fires in parallel, doesn't block the
      // localStorage save. Errors are surfaced via console only since
      // there's nothing the user can do about a full disk.
      persistNodeBlobs(nodes, slot).catch(err => console.warn('Blob persist failed:', err))
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [nodes, edges, name, markAutoSaved])
}
