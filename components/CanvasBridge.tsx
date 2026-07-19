'use client'
// Client-side bridge: opens an EventSource to /api/canvas/events, applies
// each incoming op to the Zustand store, and (debounced) POSTs the current
// canvas snapshot to /api/canvas/snapshot whenever it changes. This is what
// lets Claude Code drive the canvas in real time.

import { useEffect, useRef } from 'react'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { getRunHandler, listRunnableNodeIds } from '@/lib/flow/runRegistry'
import { topologicalSort } from '@/lib/flow/topo'
import { propagateFromNode } from '@/lib/flow/propagate'

interface IncomingOp {
  op: string
  type?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  source?: string
  target?: string
  sourceHandle?: string
  targetHandle?: string
  id?: string
  name?: string
  patch?: Record<string, unknown>
  ids?: string[]
}

// Resolve a node id, falling back to displayName lookup against the
// live Zustand store. Catches the case where the server snapshot
// resolved a name → stale id and the browser's local store has
// since reassigned that displayName to a new id.
function resolveLocalNodeId(id?: string, name?: string): string | undefined {
  const state = useWorkflowStore.getState()
  if (id && state.nodes.some(n => n.id === id)) return id
  if (name) {
    const target = name.trim().toLowerCase()
    const hit = state.nodes.find(n => {
      const dn = n.data?.displayName
      return typeof dn === 'string' && dn.toLowerCase() === target
    })
    if (hit) return hit.id
  }
  return undefined
}

export default function CanvasBridge() {
  const nodes = useWorkflowStore(s => s.nodes)
  const edges = useWorkflowStore(s => s.edges)
  const addNode = useWorkflowStore(s => s.addNode)
  const setEdges = useWorkflowStore(s => s.setEdges)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)
  const deleteNode = useWorkflowStore(s => s.deleteNode)
  const deleteEdge = useWorkflowStore(s => s.deleteEdge)
  const clearCanvas = useWorkflowStore(s => s.clearCanvas)
  const setSelectedNodeId = useWorkflowStore(s => s.setSelectedNodeId)
  const pulseNode = useWorkflowStore(s => s.pulseNode)

  // SSE connection — open once on mount, retry on error.
  useEffect(() => {
    let closed = false
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const apply = (op: IncomingOp) => {
      switch (op.op) {
        case 'add_node': {
          if (!op.type || !op.id) return
          // Place new nodes near the center of the visible area if no
          // position was provided. Caller can supply explicit x/y.
          const pos = op.position ?? { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 }
          addNode({
            id: op.id,
            type: op.type,
            position: pos,
            data: { label: op.type, ...(op.data ?? {}) },
          })
          // Slightly longer pulse on creation so the user notices the new arrival.
          pulseNode(op.id, 2400)
          break
        }
        case 'connect': {
          if (!op.source || !op.target || !op.id) return
          // Append a single edge to the existing list. Use the accent edge
          // type so the styled wire renders.
          const nextEdges = [
            ...useWorkflowStore.getState().edges,
            {
              id: op.id,
              source: op.source,
              target: op.target,
              sourceHandle: op.sourceHandle,
              targetHandle: op.targetHandle,
              type: 'accent',
            },
          ]
          // Run propagation from the source so the new target picks up
          // the source's current output value through this fresh wire —
          // matches the in-app onConnect behaviour. Without this, a wire
          // added via the bridge stays "empty" until the source re-runs.
          const propagated = propagateFromNode(
            useWorkflowStore.getState().nodes,
            nextEdges,
            op.source,
          )
          useWorkflowStore.setState({ edges: nextEdges, nodes: propagated })
          pulseNode(op.source, 1600)
          pulseNode(op.target, 1600)
          break
        }
        case 'set_param': {
          if (!op.patch) return
          const resolved = resolveLocalNodeId(op.id, op.name)
          if (!resolved) {
            console.warn('[CanvasBridge] set_param dropped — no local node for',
              { id: op.id, name: op.name })
            return
          }
          updateNodeData(resolved, op.patch)
          pulseNode(resolved, 1200)
          break
        }
        case 'delete_node': {
          const resolved = resolveLocalNodeId(op.id, op.name)
          if (!resolved) return
          deleteNode(resolved)
          break
        }
        case 'delete_edge':
          if (!op.id) return
          deleteEdge(op.id)
          break
        case 'clear':
          clearCanvas()
          break
        case 'select':
          setSelectedNodeId(op.id ?? null)
          break
        case 'inspect':
          // Read-only ping — pulse every named node briefly (~900ms) so
          // the user sees "something is looking at these right now".
          if (op.ids && Array.isArray(op.ids)) {
            for (const nid of op.ids) pulseNode(nid, 900)
          }
          break
        case 'run_node': {
          const resolved = resolveLocalNodeId(op.id, op.name)
          if (!resolved) return
          const h = getRunHandler(resolved)
          if (!h) return
          pulseNode(resolved, 60_000)
          h()
            .catch(err => console.error('run_node failed', resolved, err))
            .finally(() => useWorkflowStore.getState().unpulseNode(resolved))
          break
        }
        case 'run_all': {
          // Topo-sort current nodes, then run only those with a handler.
          // Each step pulses the active node so the user can follow the
          // execution down the graph in real time.
          const state = useWorkflowStore.getState()
          const runnable = new Set(listRunnableNodeIds())
          const order = topologicalSort(state.nodes, state.edges)
            .map(n => n.id)
            .filter(id => runnable.has(id))
          ;(async () => {
            for (const id of order) {
              const h = getRunHandler(id)
              if (!h) continue
              pulseNode(id, 60_000)
              try { await h() }
              catch (err) {
                console.error('run_all halted at', id, err)
                useWorkflowStore.getState().unpulseNode(id)
                break
              }
              useWorkflowStore.getState().unpulseNode(id)
            }
          })()
          break
        }
      }
    }

    const connect = () => {
      if (closed) return
      es = new EventSource('/api/canvas/events')
      es.onmessage = (ev) => {
        try { apply(JSON.parse(ev.data) as IncomingOp) }
        catch (err) { console.warn('Bad op payload', err) }
      }
      es.onerror = () => {
        // Browser auto-reconnects to EventSource by default, but Next.js
        // dev HMR can drop the route. Explicit retry handles that.
        es?.close()
        if (closed) return
        retry = setTimeout(connect, 2000)
      }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      es?.close()
    }
  }, [addNode, setEdges, updateNodeData, deleteNode, deleteEdge, clearCanvas, setSelectedNodeId, pulseNode])

  // Snapshot poster — debounced. Whenever nodes/edges change, push a fresh
  // mirror to the server so external callers can read current state via
  // GET /api/canvas/snapshot.
  const lastPostedRef = useRef<string>('')
  useEffect(() => {
    const t = setTimeout(() => {
      const body = JSON.stringify({
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
          selected: n.selected,
        })),
        edges: edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
      })
      if (body === lastPostedRef.current) return
      lastPostedRef.current = body
      fetch('/api/canvas/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => { /* ignore — server may not be running this route */ })
    }, 300)
    return () => clearTimeout(t)
  }, [nodes, edges])

  return null
}
