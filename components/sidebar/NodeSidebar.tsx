'use client'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { Search, ChevronDown, ChevronRight, Sparkle, Clock, LayoutGrid, List, Plus, X } from 'lucide-react'
import { NODE_CATALOG, NodeCategory, NodeInfo } from '@/lib/types/nodes'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { useReactFlow } from '@xyflow/react'
import AnimatedMascot from '@/components/AnimatedMascot'
import BlueTipCard from './BlueTipCard'
import { NODE_ICONS } from './nodeIcons'
import { useRecentNodes } from './useRecentNodes'

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  text: 'Text & Prompts',
  image: 'Image',
  video: 'Video',
  edit: 'Editing',
  mask: 'Mask & Matte',
  helper: 'Helpers',
  output: 'Output',
}

// Vivid NEON palette — same hexes the wires use in AccentEdge. Pulling
// from the muted --cat-* CSS vars made every sidebar icon look the same
// shade of dull purple/grey in dark mode; the neon set gives real
// category separation and matches the wire colors users see on canvas.
const CATEGORY_VAR: Record<NodeCategory, string> = {
  text:   '#B94EFF',  // electric purple
  image:  '#00FF88',  // neon green
  video:  '#FF2D87',  // hot pink
  edit:   '#00E5FF',  // electric cyan
  mask:   '#39FF14',  // electric lime
  helper: '#FFB400',  // electric amber
  output: '#FFEA00',  // acid yellow
}

const CATEGORY_ORDER: NodeCategory[] = ['text', 'image', 'video', 'edit', 'mask', 'helper', 'output']

// Short-hand search synonyms. Maps any of the keys → words that get
// appended to the haystack so "bg" finds "Background", "tts" finds
// "Text → Speech", etc. Keep additions lowercase.
const SYNONYMS: Record<string, string> = {
  'bg':       'background',
  'rmbg':     'background remove',
  'remove':   'background object eraser',
  'lighting': 'relight light',
  '3d':       'mesh box',
  'tts':      'text speech voice',
  'stt':      'transcribe audio speech',
  'i2v':      'image video animate',
  't2v':      'text video',
  't2i':      'text image generate',
  'i2i':      'image image edit',
  'sora':     'video generate',
  'veo':      'video generate google',
  'kling':    'video generate',
  'flux':     'image generate',
  'nano':     'banana edit image',
  'banana':   'edit image gemini',
  'cutout':   'background remove transparent',
  'matte':    'mask alpha',
  'fx':       'effect edit',
  'gen':      'generate text image video',
  'mask':     'matte alpha select inpaint',
  'comp':     'compositor layer blend',
  'layer':    'compositor blend',
  'crop':     'resize aspect ratio',
  'upload':   'image video audio file',
  'figma':    'import frame design',
}

// Build a haystack per node — lowercased label + simpleExplanation +
// any synonym hits. Memoized at module level so it's computed once.
function buildHaystack(n: NodeInfo): string {
  const base = `${n.label} ${n.simpleExplanation}`.toLowerCase()
  const extra: string[] = []
  for (const [k, v] of Object.entries(SYNONYMS)) {
    if (base.includes(v.split(' ')[0])) extra.push(k)
  }
  return `${base} ${extra.join(' ')}`
}

// Fuzzy match: query chars must appear in order in the haystack (with
// other chars allowed between). Falls back to substring when query is
// short to keep early-typing predictable.
function fuzzyMatch(query: string, haystack: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  if (q.length <= 2) return haystack.includes(q)
  // Expand synonyms: if q matches a synonym key, also search its value.
  const expanded = SYNONYMS[q] ? `${q} ${SYNONYMS[q]}` : q
  for (const term of expanded.split(/\s+/)) {
    if (haystack.includes(term)) return true
  }
  // Char-in-order fuzzy
  let qi = 0
  for (let i = 0; i < haystack.length && qi < q.length; i++) {
    if (haystack[i] === q[qi]) qi++
  }
  return qi === q.length
}

export default function NodeSidebar() {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<NodeCategory>>(new Set())
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof window === 'undefined') return 'list'
    const saved = localStorage.getItem('loometo:sidebarView')
    return saved === 'grid' ? 'grid' : 'list'
  })
  useEffect(() => {
    try { localStorage.setItem('loometo:sidebarView', viewMode) } catch {}
  }, [viewMode])

  const addNode = useWorkflowStore(s => s.addNode)
  const { screenToFlowPosition } = useReactFlow()
  const { recent, record, clear: clearRecent } = useRecentNodes()

  const toggleCategory = (cat: NodeCategory) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const handleAddNode = useCallback((info: NodeInfo) => {
    const existing = useWorkflowStore.getState().nodes
    const maxN = existing.reduce((m, n) => {
      const match = /^node_(\d+)$/.exec(n.id)
      return match ? Math.max(m, Number(match[1])) : m
    }, 0)
    const id = `node_${maxN + 1}`
    const position = screenToFlowPosition({ x: 320 + Math.random() * 200, y: 200 + Math.random() * 200 })
    addNode({ id, type: info.type, position, data: { label: info.label } })
    record(info.type)
  }, [addNode, screenToFlowPosition, record])

  // Custom drag image — clones the card DOM so the user drags a real
  // node-shaped chip instead of the browser's default text ghost. The
  // clone lives off-screen until dragend cleans it up.
  const handleDragStart = useCallback((e: React.DragEvent, info: NodeInfo) => {
    e.dataTransfer.setData('application/nodeType', JSON.stringify(info))
    e.dataTransfer.effectAllowed = 'move'
    record(info.type)
    const src = e.currentTarget as HTMLElement
    const clone = src.cloneNode(true) as HTMLElement
    clone.style.position = 'fixed'
    clone.style.top = '-9999px'
    clone.style.left = '-9999px'
    clone.style.width = `${src.offsetWidth}px`
    clone.style.pointerEvents = 'none'
    clone.style.opacity = '0.95'
    clone.style.transform = 'scale(1.05) rotate(-1.5deg)'
    clone.style.boxShadow = '0 12px 32px rgba(0,0,0,0.45), 0 0 0 1px var(--accent)'
    clone.style.background = 'var(--bg-surface)'
    document.body.appendChild(clone)
    e.dataTransfer.setDragImage(clone, src.offsetWidth / 2, 24)
    setTimeout(() => clone.remove(), 0)
  }, [record])

  // Filtered list — fuzzy + synonym match. Built haystacks are cached
  // per node so retyping is cheap.
  const haystacks = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of NODE_CATALOG) m.set(n.type, buildHaystack(n))
    return m
  }, [])
  const filtered = useMemo(() => {
    if (!search.trim()) return null
    return NODE_CATALOG.filter(n => fuzzyMatch(search, haystacks.get(n.type) || ''))
  }, [search, haystacks])

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.reduce((acc, cat) => {
      acc[cat] = NODE_CATALOG.filter(n => n.category === cat)
      return acc
    }, {} as Record<NodeCategory, NodeInfo[]>)
  }, [])

  const recentNodes = useMemo(() => {
    return recent
      .map(t => NODE_CATALOG.find(n => n.type === t))
      .filter((n): n is NodeInfo => !!n)
  }, [recent])

  const showMascot = useWorkflowStore(s => s.showMascot)

  return (
    <div className="w-64 glass border-r border-[var(--line)] flex flex-col h-full overflow-hidden">
      {/* Header — mascot + search + view toggle. */}
      <div className="px-4 pt-14 pb-3">
        <div className="relative h-0">
          {showMascot && <AnimatedMascot />}
        </div>
        <div className="relative">
          {showMascot && <BlueTipCard />}
          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] z-10" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search nodes…"
            className="w-full rounded-full pl-10 pr-4 py-2.5 text-[12.5px] text-[var(--ink)] focus:outline-none placeholder-[var(--ink-faint)] clay-surface-soft border-0"
            style={{ background: 'var(--bg-surface)' }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            {filtered ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${NODE_CATALOG.length} nodes`}
          </span>
          <div className="flex items-center gap-0.5 p-0.5 rounded-full" style={{ background: 'var(--bg-elevated)' }}>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="List view"
              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
              style={viewMode === 'list' ? { background: 'var(--bg-surface)', color: 'var(--ink)' } : { color: 'var(--ink-mute)' }}
            ><List size={11} /></button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
              style={viewMode === 'grid' ? { background: 'var(--bg-surface)', color: 'var(--ink)' } : { color: 'var(--ink-mute)' }}
            ><LayoutGrid size={11} /></button>
          </div>
        </div>
      </div>

      {/* Body — recent (if any + no search), then categories OR filtered list. */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {filtered ? (
          <div className="px-3">
            {filtered.length === 0 && (
              <p className="text-[var(--ink-faint)] text-[12px] text-center py-8">No nodes match {`"${search}"`}</p>
            )}
            <CardList nodes={filtered} mode={viewMode} onAdd={handleAddNode} onDragStart={handleDragStart} />
          </div>
        ) : (
          <>
            {recentNodes.length > 0 && (
              <div className="mb-1">
                <div
                  className="flex items-center justify-between mx-2 my-0.5 px-3 py-2 rounded-full hover:bg-[var(--bg-elevated)] transition-colors group"
                  style={{ width: 'calc(100% - 16px)' }}
                >
                  <button
                    className="flex items-center gap-2 flex-1"
                    onClick={() => setRecentCollapsed(c => !c)}
                  >
                    <Clock size={11} strokeWidth={2.2} style={{ color: 'var(--accent)' }} />
                    <span
                      className="text-[var(--ink-soft)] text-[10px] font-semibold"
                      style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}
                    >
                      Recent
                    </span>
                    <span className="text-[9px] text-[var(--ink-faint)]">{recentNodes.length}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={clearRecent}
                      title="Clear recent"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--ink-faint)] hover:text-[var(--cat-video)]"
                    >
                      <X size={11} />
                    </button>
                    <button onClick={() => setRecentCollapsed(c => !c)}>
                      {recentCollapsed
                        ? <ChevronRight size={12} className="text-[var(--ink-faint)]" />
                        : <ChevronDown size={12} className="text-[var(--ink-faint)]" />
                      }
                    </button>
                  </div>
                </div>
                {!recentCollapsed && (
                  <div className="px-3 pb-2">
                    <CardList nodes={recentNodes} mode={viewMode} onAdd={handleAddNode} onDragStart={handleDragStart} />
                  </div>
                )}
              </div>
            )}
            {CATEGORY_ORDER.map(cat => (
              <div key={cat} className="mb-1">
                <button
                  className="w-full flex items-center justify-between mx-2 my-0.5 px-3 py-2 rounded-full hover:bg-[var(--bg-elevated)] transition-colors group"
                  style={{ width: 'calc(100% - 16px)' }}
                  onClick={() => toggleCategory(cat)}
                >
                  <div className="flex items-center gap-2">
                    <Sparkle
                      size={11}
                      strokeWidth={2.2}
                      style={{ color: CATEGORY_VAR[cat], fill: CATEGORY_VAR[cat] }}
                    />
                    <span
                      className="text-[var(--ink-soft)] text-[10px] font-semibold"
                      style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}
                    >
                      {CATEGORY_LABELS[cat]}
                    </span>
                    <span className="text-[9px] text-[var(--ink-faint)]">{grouped[cat].length}</span>
                  </div>
                  {collapsed.has(cat)
                    ? <ChevronRight size={12} className="text-[var(--ink-faint)]" />
                    : <ChevronDown size={12} className="text-[var(--ink-faint)]" />
                  }
                </button>
                {!collapsed.has(cat) && (
                  <div className="px-3 pb-2">
                    <CardList nodes={grouped[cat]} mode={viewMode} onAdd={handleAddNode} onDragStart={handleDragStart} />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[var(--line-soft)]">
        <p className="text-[var(--ink-faint)] text-[10.5px] leading-relaxed">
          Click to add or drag onto the canvas. Wire nodes by dragging from one colored dot to another.
        </p>
      </div>
    </div>
  )
}

function CardList({ nodes, mode, onAdd, onDragStart }: {
  nodes: NodeInfo[]
  mode: 'list' | 'grid'
  onAdd: (info: NodeInfo) => void
  onDragStart: (e: React.DragEvent, info: NodeInfo) => void
}) {
  if (mode === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {nodes.map(info => <NodeTile key={info.type} info={info} onAdd={onAdd} onDragStart={onDragStart} />)}
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      {nodes.map(info => <NodeRow key={info.type} info={info} onAdd={onAdd} onDragStart={onDragStart} />)}
    </div>
  )
}

function NodeRow({ info, onAdd, onDragStart }: {
  info: NodeInfo
  onAdd: (info: NodeInfo) => void
  onDragStart: (e: React.DragEvent, info: NodeInfo) => void
}) {
  const color = CATEGORY_VAR[info.category]
  const Icon = NODE_ICONS[info.type]
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, info)}
      onClick={() => onAdd(info)}
      title={info.simpleExplanation}
      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-2xl cursor-pointer group transition-all
                 hover:translate-x-0.5 active:scale-[0.98]"
      style={{
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-elevated)'
        e.currentTarget.style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${color} 25%, transparent), 0 4px 14px color-mix(in srgb, ${color} 18%, transparent)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors node-icon-tile"
        style={{
          background: 'transparent',
          color: 'var(--ink-mute)',
          ['--hover-color' as string]: color,
        }}
      >
        {Icon ? <Icon size={13} strokeWidth={2} /> : (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-mute)]" />
        )}
      </div>
      <p className="flex-1 text-[var(--ink-soft)] text-[12px] group-hover:text-[var(--ink)] transition-colors truncate">{info.label}</p>
      <Plus size={11} className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--ink-mute)]" />
    </div>
  )
}

function NodeTile({ info, onAdd, onDragStart }: {
  info: NodeInfo
  onAdd: (info: NodeInfo) => void
  onDragStart: (e: React.DragEvent, info: NodeInfo) => void
}) {
  const color = CATEGORY_VAR[info.category]
  const Icon = NODE_ICONS[info.type]
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, info)}
      onClick={() => onAdd(info)}
      title={info.simpleExplanation}
      className="flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl cursor-pointer group transition-all
                 hover:-translate-y-0.5 active:scale-[0.96]"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-elevated)'
        e.currentTarget.style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent), 0 6px 18px color-mix(in srgb, ${color} 22%, transparent)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors node-icon-tile"
        style={{
          background: 'transparent',
          color: 'var(--ink-mute)',
          ['--hover-color' as string]: color,
        }}
      >
        {Icon ? <Icon size={17} strokeWidth={2} /> : (
          <span className="w-2 h-2 rounded-full bg-[var(--ink-mute)]" />
        )}
      </div>
      <p className="text-center text-[var(--ink-soft)] text-[10.5px] leading-tight group-hover:text-[var(--ink)] transition-colors line-clamp-2 min-h-[26px]">
        {info.label}
      </p>
    </div>
  )
}
