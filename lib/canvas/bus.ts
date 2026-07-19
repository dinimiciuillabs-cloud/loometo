// In-process pub/sub for the Claude Code ↔ AiFlow bridge.
// HTTP routes emit ops onto this bus; the SSE route subscribes and streams
// them to the browser. A snapshot cache lets external callers query the
// current canvas state without going through the browser.
//
// Stored on globalThis so HMR doesn't wipe subscribers when code changes
// during dev — the same EventEmitter persists across module reloads.

import { EventEmitter } from 'events'

export type CanvasOp =
  | { op: 'add_node'; type: string; position?: { x: number; y: number }; data?: Record<string, unknown>; id: string }
  | { op: 'connect'; source: string; target: string; sourceHandle?: string; targetHandle?: string; id: string }
  | { op: 'set_param'; id: string; patch: Record<string, unknown>; name?: string }
  | { op: 'delete_node'; id: string; name?: string }
  | { op: 'delete_edge'; id: string }
  | { op: 'clear' }
  | { op: 'run_node'; id: string; name?: string }
  | { op: 'run_all' }
  | { op: 'select'; id: string | null }
  // Read-only visual ping. Fired when an external caller reads the canvas
  // state — the browser pulses these node ids briefly so the user can see
  // "Claude / a script is looking at these right now".
  | { op: 'inspect'; ids: string[] }

export interface CanvasSnapshot {
  nodes: Array<{ id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown>; selected?: boolean }>
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>
  updatedAt: number
}

type Globals = typeof globalThis & {
  __loometoBus?: EventEmitter
  __loometoSnap?: CanvasSnapshot
  __loometoIdSeq?: number
}
const G = globalThis as Globals

if (!G.__loometoBus) {
  G.__loometoBus = new EventEmitter()
  // Bus can have many subscribers (one per open tab + one per SSE client) —
  // raise the cap so Node doesn't log MaxListenersExceeded warnings.
  G.__loometoBus.setMaxListeners(64)
}
if (!G.__loometoIdSeq) G.__loometoIdSeq = 1000

export const bus = G.__loometoBus

export function emitOp(op: CanvasOp): void {
  bus.emit('op', op)
}
export function onOp(handler: (op: CanvasOp) => void): () => void {
  bus.on('op', handler)
  return () => bus.off('op', handler)
}

export function nextNodeId(prefix = 'node'): string {
  G.__loometoIdSeq = (G.__loometoIdSeq ?? 1000) + 1
  return `${prefix}_${G.__loometoIdSeq}`
}
export function nextEdgeId(): string {
  G.__loometoIdSeq = (G.__loometoIdSeq ?? 1000) + 1
  return `e_${G.__loometoIdSeq}`
}

export function setSnapshot(snap: CanvasSnapshot): void {
  G.__loometoSnap = snap
}
export function getSnapshot(): CanvasSnapshot {
  return G.__loometoSnap ?? { nodes: [], edges: [], updatedAt: 0 }
}
