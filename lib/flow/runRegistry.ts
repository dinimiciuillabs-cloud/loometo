// Shared registry of per-node run handlers. Each node that has a Run button
// registers its handler here keyed by node id on mount, and unregisters on
// unmount. The Run-All button walks the topologically-sorted graph and
// awaits each registered handler in order.

type Handler = () => Promise<void>

const registry = new Map<string, Handler>()

export function registerRunHandler(nodeId: string, fn: Handler) {
  registry.set(nodeId, fn)
}

export function unregisterRunHandler(nodeId: string) {
  registry.delete(nodeId)
}

export function getRunHandler(nodeId: string): Handler | undefined {
  return registry.get(nodeId)
}

export function listRunnableNodeIds(): string[] {
  return Array.from(registry.keys())
}
