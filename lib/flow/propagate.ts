import type { Node, Edge } from '@xyflow/react'
import { NODE_IO } from './nodeIO'

// Given the current graph and the id of a node whose data just changed,
// return a new `nodes` array with every downstream target's input fields
// filled in from this node's output fields.
//
// Propagation is one-hop and synchronous: if target nodes have downstream
// edges of their own, their handlers (or subsequent updateNodeData calls)
// will fire propagation again, so the value walks the whole chain.

export function propagateFromNode(
  nodes: Node[],
  edges: Edge[],
  sourceNodeId: string,
): Node[] {
  const source = nodes.find(n => n.id === sourceNodeId)
  if (!source || !source.type) return nodes

  const sourceIO = NODE_IO[source.type]
  if (!sourceIO?.outputs) return nodes

  const outgoing = edges.filter(e => e.source === sourceNodeId)
  if (outgoing.length === 0) return nodes

  const patches = new Map<string, Record<string, unknown>>()

  for (const edge of outgoing) {
    if (!edge.sourceHandle || !edge.targetHandle) continue

    const sourceField = sourceIO.outputs[edge.sourceHandle]
    if (!sourceField) continue

    const value = (source.data as Record<string, unknown>)[sourceField]
    if (value === undefined || value === null || value === '') continue

    const target = nodes.find(n => n.id === edge.target)
    if (!target || !target.type) continue

    const targetIO = NODE_IO[target.type]
    const targetField = targetIO?.inputs?.[edge.targetHandle]
    if (!targetField) continue

    const existing = patches.get(target.id) ?? {}
    existing[targetField] = value
    patches.set(target.id, existing)
  }

  if (patches.size === 0) return nodes

  return nodes.map(n => {
    const patch = patches.get(n.id)
    if (!patch) return n
    return { ...n, data: { ...n.data, ...patch } }
  })
}
