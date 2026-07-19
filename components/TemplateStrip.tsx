'use client'
import { PIPELINE_TEMPLATES, type PipelineTemplate } from '@/lib/flow/templates'

// Horizontal, wrapping row of template chips. Used both in the empty-state
// hero and in the pinned top-center bar (so a second template can be added
// to a project that already has nodes). `compact` shrinks it for the pin.
export default function TemplateStrip({ onPick, compact = false, scroll = false }: {
  onPick: (tpl: PipelineTemplate) => void
  compact?: boolean
  // scroll = single horizontal row that scrolls (toolbar/pinned-bar style).
  // default = wrapping rows (hero style, no scrollbar).
  scroll?: boolean
}) {
  return (
    <div
      className={scroll
        ? 'flex flex-nowrap gap-1.5 overflow-x-auto scrollbar-thin pb-0.5'
        : 'flex flex-wrap justify-center gap-1.5'}
      style={{ pointerEvents: 'auto' }}
    >
      {PIPELINE_TEMPLATES.map(tpl => {
        const Icon = tpl.icon
        return (
          <button
            key={tpl.id}
            onClick={() => onPick(tpl)}
            title={`${tpl.name} — ${tpl.tagline}`}
            className="relative inline-flex items-center gap-1.5 rounded-full cursor-pointer transition-transform hover:-translate-y-0.5 active:scale-[0.97] flex-shrink-0 whitespace-nowrap"
            style={{
              padding: compact ? '5px 11px' : '7px 13px',
              background: 'color-mix(in srgb, var(--bg-surface) 78%, transparent)',
              border: '1px solid var(--line-soft)',
              boxShadow: 'var(--shadow-clay-sm, 0 2px 8px rgba(0,0,0,0.15))',
            }}
          >
            <Icon size={compact ? 12 : 14} style={{ color: 'var(--accent)' }} />
            <span className="font-medium" style={{ color: 'var(--ink-soft)', fontSize: compact ? 10.5 : 11.5 }}>
              {tpl.name}
            </span>
            {tpl.complex && (
              <span className="text-[7.5px] font-bold uppercase tracking-[0.1em] px-1 py-0.5 rounded-full"
                style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}>
                Pro
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
