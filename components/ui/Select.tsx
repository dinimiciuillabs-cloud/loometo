'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search, Star, TriangleAlert } from 'lucide-react'

export interface SelectOption {
  id: string
  name: string
  description?: string
  cost?: string  // '$' | '$$' | '$$$' — rendered as a colored badge
  recommended?: boolean  // star chip + sorts to the top of the list
  caution?: string       // amber warning chip; the string is the reason
}

const COST_LABEL: Record<string, string> = {
  '$':   'cheap',
  '$$':  'medium',
  '$$$': 'premium',
}

const COST_COLOR: Record<string, string> = {
  '$':   'var(--cat-image)',  // sage = cheap
  '$$':  'var(--cat-helper)', // taupe = medium
  '$$$': 'var(--cat-video)',  // wine = premium
}

function RecommendedChip() {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8.5px] font-semibold uppercase tracking-[0.06em] flex-shrink-0"
      style={{
        background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
        color: 'var(--accent)',
      }}
    >
      <Star size={8} fill="currentColor" strokeWidth={0} />
      Pick
    </span>
  )
}

function CautionChip({ note }: { note: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8.5px] font-semibold uppercase tracking-[0.06em] flex-shrink-0"
      style={{
        background: 'color-mix(in srgb, var(--cat-helper) 16%, transparent)',
        color: 'var(--cat-helper)',
      }}
      title={note}
    >
      <TriangleAlert size={8} strokeWidth={2.5} />
      Caution
    </span>
  )
}

function CostBadge({ cost, withLabel = false }: { cost?: string; withLabel?: boolean }) {
  if (!cost) return null
  const color = COST_COLOR[cost] ?? 'var(--ink-mute)'
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-semibold flex-shrink-0"
      style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        letterSpacing: '0.04em',
      }}
    >
      <span>{cost}</span>
      {withLabel && <span style={{ fontFamily: 'inherit', opacity: 0.85 }}>{COST_LABEL[cost] ?? ''}</span>}
    </span>
  )
}

// Custom dropdown replacement for native <select>. Uses clay + glass styling
// to match the rest of the app. Click outside or Escape to close.
export default function Select({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.find(o => o.id === value)

  // Hover-expand: keep the pointer on a row for ~500ms and the description
  // grows to its full length. Quick scans don't trigger it; deliberate
  // hovers reveal the full model blurb.
  const onRowEnter = (id: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setHoveredId(id), 500)
  }
  const onRowLeave = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    setHoveredId(null)
  }

  // Show search only when the list is long enough to benefit from it.
  const showSearch = options.length > 5

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.description?.toLowerCase().includes(q) ?? false)
    )
  }, [options, query])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    // Focus the search field shortly after open so the panel animation
    // doesn't fight with the focus jump.
    const t = setTimeout(() => searchRef.current?.focus(), 30)
    // React Flow stops mousedown propagation on its pane (pan/zoom handlers),
    // so a bubble-phase document listener never fires when the user clicks
    // outside the dropdown into the canvas. Registering on capture: true
    // (and on pointerdown so touch works too) lets us fire BEFORE RF swallows.
    const onPointer = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative nodrag">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-full px-3.5 py-1.5 text-[11.5px] text-[var(--ink)] focus:outline-none clay-surface-soft border-0 cursor-pointer transition-colors hover:brightness-[0.98]"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <span className="truncate text-left flex-1">
          {selected ? selected.name : 'Select…'}
        </span>
        {selected && <CostBadge cost={selected.cost} />}
        <ChevronDown
          size={12}
          className={`text-[var(--ink-mute)] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1.5 left-0 right-0 rounded-2xl overflow-hidden glass-strong animate-fade-in"
          style={{ boxShadow: 'var(--shadow-clay)' }}
        >
          {showSearch && (
            <div className="px-2.5 pt-2 pb-1.5 border-b border-[var(--line-soft)]">
              <div
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <Search size={11} className="text-[var(--ink-faint)] flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="flex-1 bg-transparent border-0 outline-none text-[11.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
                />
              </div>
            </div>
          )}
          <div className="overflow-y-auto scrollbar-on-hover py-1.5" style={{ maxHeight: 260 }}>
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-[var(--ink-faint)] text-center">
                No matches
              </div>
            )}
            {filtered.map(opt => {
              const isSelected = opt.id === value
              const isHovered = hoveredId === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => { onChange(opt.id); setOpen(false) }}
                  onMouseEnter={() => onRowEnter(opt.id)}
                  onMouseLeave={onRowLeave}
                  className={`w-full flex items-start gap-2 px-3 py-1.5 text-left transition-colors ${isSelected ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--bg-elevated)]'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[var(--ink)] text-[11.5px] font-medium truncate">{opt.name}</span>
                      {opt.recommended && <RecommendedChip />}
                      {opt.caution && <CautionChip note={opt.caution} />}
                      <CostBadge cost={opt.cost} withLabel />
                    </div>
                    {opt.caution && (
                      <div className="text-[9.5px] mt-0.5" style={{ color: 'var(--cat-helper)' }}>
                        {opt.caution}
                      </div>
                    )}
                    {opt.description && (
                      <div className={`text-[10.5px] text-[var(--ink-mute)] mt-0.5 ${isHovered ? 'whitespace-normal' : 'truncate'}`}>
                        {opt.description}
                      </div>
                    )}
                  </div>
                  {isSelected && <Check size={12} className="text-[var(--accent)] flex-shrink-0 mt-0.5" />}
                </button>
              )
            })}
          </div>
          {/* Cost legend footer */}
          <div className="px-3 py-2 border-t border-[var(--line-soft)] flex items-center justify-between text-[9.5px] text-[var(--ink-mute)]">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1"><span style={{ color: 'var(--cat-image)' }}>$</span>cheap</span>
              <span className="flex items-center gap-1"><span style={{ color: 'var(--cat-helper)' }}>$$</span>medium</span>
              <span className="flex items-center gap-1"><span style={{ color: 'var(--cat-video)' }}>$$$</span>premium</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
