import type { Node, Edge } from '@xyflow/react'

// Kahn's algorithm — returns nodes in dependency order (source before target).
// Nodes that participate in a cycle are placed at the end in arbitrary order
// so the caller can still try to run them rather than dropping them silently.
export function topologicalSort(nodes: Node[], edges: Edge[]): Node[] {
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const n of nodes) {
    indegree.set(n.id, 0)
    adjacency.set(n.id, [])
  }
  for (const e of edges) {
    if (!indegree.has(e.target) || !indegree.has(e.source)) continue
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
    adjacency.get(e.source)!.push(e.target)
  }

  const queue: string[] = []
  indegree.forEach((deg, id) => { if (deg === 0) queue.push(id) })

  const ordered: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1
      indegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }

  // Append any cycle leftovers so they still get a shot
  if (ordered.length < nodes.length) {
    for (const n of nodes) if (!ordered.includes(n.id)) ordered.push(n.id)
  }

  const byId = new Map(nodes.map(n => [n.id, n]))
  return ordered.map(id => byId.get(id)!).filter(Boolean)
}
