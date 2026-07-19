'use client'
// Figma-style Layers panel. Collapsible right-edge sidebar that lists
// every node on the canvas by displayName + type, lets the user
// click-to-focus (pans + zooms to the node + pulses it), search by
// name, toggle grouping (by category vs by creation order), and act
// on a node from a right-click menu (rename / delete / duplicate).
//
// This is the "indexing" half of the user's Phase-2 request — pairs
// with the displayName chip on the node card (Phase 1).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ChevronRight, ChevronLeft, Search, X, MoreVertical, Trash2, Edit3, Copy } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { NODE_COLORS, NODE_CATALOG, type NodeCategory } from '@/lib/types/nodes'
import { typeSlug } from '@/lib/flow/nodeNaming'

type SortMode = 'category' | 'creation'

function categoryFor(nodeType: string): NodeCategory {
  const info = NODE_CATALOG.find(n => n.type === nodeType)
  return (info?.category ?? 'helper') as NodeCategory
}

function labelFor(nodeType: string): string {
  const info = NODE_CATALOG.find(n => n.type === nodeType)
  return info?.label ?? nodeType
}

export default function LayersPanel() {
  const rf = useReactFlow()
  const nodes = useWorkflowStore(s => s.nodes)
  const selectedNodeId = useWorkflowStore(s => s.selectedNodeId)
  const setSelectedNodeId = useWorkflowStore(s => s.setSelectedNodeId)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)
  const deleteNode = useWorkflowStore(s => s.deleteNode)
  const addNode = useWorkflowStore(s => s.addNode)
  const pulseNode = useWorkflowStore(s => s.pulseNode)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('category')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Close any open per-row menu on background click
  useEffect(() => {
    if (!menuFor) return
    const onClick = () => setMenuFor(null)
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [menuFor])

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter(n => {
      const dn = (n.data?.displayName as string | undefined)?.toLowerCase() ?? ''
      const lbl = labelFor(n.type ?? '').toLowerCase()
      const title = (n.data?.title as string | undefined)?.toLowerCase() ?? ''
      return dn.includes(q) || lbl.includes(q) || title.includes(q)
    })
  }, [nodes, query])

  const groups = useMemo(() => {
    if (sortMode === 'creation') {
      return [{ key: 'all', label: 'All nodes', items: filtered }]
    }
    // Group by category, sorted by canonical category order
    const order: NodeCategory[] = ['text', 'image', 'video', 'edit', 'mask', 'helper', 'output']
    const byCat = new Map<NodeCategory, typeof filtered>()
    for (const n of filtered) {
      const cat = categoryFor(n.type ?? '')
      const arr = byCat.get(cat) ?? []
      arr.push(n)
      byCat.set(cat, arr)
    }
    return order
      .filter(cat => (byCat.get(cat)?.length ?? 0) > 0)
      .map(cat => ({ key: cat, label: cat.toUpperCase(), items: byCat.get(cat)! }))
  }, [filtered, sortMode])

  const focusNode = (nodeId: string) => {
    const n = rf.getNode(nodeId)
    if (!n) return
    setSelectedNodeId(nodeId)
    // React Flow's setCenter zooms + pans to the node's center
    const w = n.measured?.width ?? 280
    const h = n.measured?.height ?? 200
    rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 1.0), duration: 350 })
    pulseNode(nodeId, 1800)
  }

  const handleRenameSubmit = () => {
    if (!renamingId) return
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    // Collision check — block if name is taken by another node
    const colliding = nodes.find(n => n.id !== renamingId && (n.data?.displayName as string | undefined)?.toLowerCase() === trimmed.toLowerCase())
    if (colliding) {
      alert(`The name "${trimmed}" is already used by another node. Pick a different one.`)
      return
    }
    updateNodeData(renamingId, { displayName: trimmed })
    setRenamingId(null)
  }

  const handleDuplicate = (nodeId: string) => {
    const n = rf.getNode(nodeId)
    if (!n) return
    addNode({
      id: `node_${Math.floor(Math.random() * 9000 + 1000)}`,
      type: n.type,
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      data: { ...(n.data ?? {}), displayName: undefined, outputUrl: undefined, lastError: undefined },
    } as never)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-1/2 right-0 -translate-y-1/2 z-30 flex items-center gap-1 px-2 py-3 rounded-l-lg nodrag"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--line)',
          borderRight: 'none',
          color: 'var(--ink-soft)',
          boxShadow: 'var(--shadow-clay)',
        }}
        title="Open Layers panel"
      >
        <ChevronLeft size={14} />
        <span className="text-[10px] uppercase tracking-wider" style={{ writingMode: 'vertical-rl' }}>
          Layers
        </span>
      </button>
    )
  }

  return (
    <aside
      className="absolute top-0 right-0 z-30 h-full flex flex-col"
      style={{
        width: 280,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--line)',
        boxShadow: 'var(--shadow-clay)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b" style={{ borderColor: 'var(--line-soft)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-mute)' }}>
            Layers · {nodes.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="p-1 rounded hover:bg-[var(--bg-elevated)] nodrag"
          style={{ color: 'var(--ink-faint)' }}
          title="Close panel"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b nodrag" style={{ borderColor: 'var(--line-soft)' }}>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)' }}>
          <Search size={11} style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="flex-1 bg-transparent outline-none text-[11px] placeholder-[var(--ink-faint)]"
            style={{ color: 'var(--ink)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ color: 'var(--ink-faint)' }}>
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Sort toggle */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b nodrag" style={{ borderColor: 'var(--line-soft)' }}>
        <button
          type="button"
          onClick={() => setSortMode('category')}
          className="px-2 py-1 rounded text-[9.5px] uppercase tracking-wider"
          style={{
            background: sortMode === 'category' ? 'var(--bg-elevated)' : 'transparent',
            color: sortMode === 'category' ? 'var(--ink)' : 'var(--ink-faint)',
          }}
        >
          By category
        </button>
        <button
          type="button"
          onClick={() => setSortMode('creation')}
          className="px-2 py-1 rounded text-[9.5px] uppercase tracking-wider"
          style={{
            background: sortMode === 'creation' ? 'var(--bg-elevated)' : 'transparent',
            color: sortMode === 'creation' ? 'var(--ink)' : 'var(--ink-faint)',
          }}
        >
          By creation
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto nodrag" style={{ scrollbarWidth: 'thin' }}>
        {nodes.length === 0 ? (
          <div className="px-3 py-6 text-[10px] text-center" style={{ color: 'var(--ink-faint)' }}>
            Canvas is empty.<br />Drop a node from the left sidebar.
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-6 text-[10px] text-center" style={{ color: 'var(--ink-faint)' }}>
            No matches for &ldquo;{query}&rdquo;
          </div>
        ) : (
          groups.map(group => (
            <div key={group.key}>
              {sortMode === 'category' && (
                <div
                  className="px-3 py-1 text-[9px] uppercase tracking-[0.1em] sticky top-0 z-10"
                  style={{ color: 'var(--ink-faint)', background: 'var(--bg-surface)' }}
                >
                  {group.label}
                </div>
              )}
              {group.items.map(n => {
                const dn = (n.data?.displayName as string | undefined) ?? typeSlug(n.type ?? '')
                const cat = categoryFor(n.type ?? '')
                const color = NODE_COLORS[cat]
                const isSelected = selectedNodeId === n.id
                const isRenaming = renamingId === n.id
                return (
                  <div
                    key={n.id}
                    onClick={() => !isRenaming && focusNode(n.id)}
                    onDoubleClick={() => {
                      setRenamingId(n.id)
                      setRenameValue(dn)
                    }}
                    className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-elevated)]"
                    style={{
                      background: isSelected ? 'var(--bg-elevated)' : undefined,
                      borderLeft: isSelected ? `2px solid ${color}` : '2px solid transparent',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameSubmit()
                            else if (e.key === 'Escape') setRenamingId(null)
                          }}
                          onBlur={handleRenameSubmit}
                          onClick={e => e.stopPropagation()}
                          className="text-[10.5px] bg-transparent outline-none border-b nodrag"
                          style={{
                            color: 'var(--ink)',
                            fontFamily: 'var(--font-mono), JetBrains Mono, monospace',
                            borderColor: color,
                          }}
                        />
                      ) : (
                        <span
                          className="text-[10.5px] truncate"
                          style={{
                            color: 'var(--ink-soft)',
                            fontFamily: 'var(--font-mono), JetBrains Mono, monospace',
                          }}
                        >
                          {dn}
                        </span>
                      )}
                      <span className="text-[9px] uppercase tracking-wider truncate" style={{ color: 'var(--ink-faint)' }}>
                        {labelFor(n.type ?? '')}
                      </span>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuFor(menuFor === n.id ? null : n.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-surface)]"
                        style={{ color: 'var(--ink-faint)' }}
                      >
                        <MoreVertical size={11} />
                      </button>
                      {menuFor === n.id && (
                        <div
                          className="absolute right-0 top-full mt-1 rounded shadow-xl z-20"
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--line)',
                            minWidth: 130,
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(n.id)
                              setRenameValue(dn)
                              setMenuFor(null)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-[var(--bg-elevated)]"
                            style={{ color: 'var(--ink-soft)' }}
                          >
                            <Edit3 size={11} /> Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => { handleDuplicate(n.id); setMenuFor(null) }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-[var(--bg-elevated)]"
                            style={{ color: 'var(--ink-soft)' }}
                          >
                            <Copy size={11} /> Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => { deleteNode(n.id); setMenuFor(null) }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-[var(--bg-elevated)]"
                            style={{ color: 'var(--cat-video)' }}
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
