'use client'
import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { listRoutes, describeRoute, type RouteOption, type RouteId } from '@/lib/api/router'

// Short, user-facing label for the tiny "via …" chip. Keep these terse
// — they're typeset uppercase + 9-10px so anything over ~9 chars gets
// noisy. describeRoute() returns the full label used inside the popover.
const SHORT_LABEL: Record<RouteId, string> = {
  'muapi':         'MuAPI',
  'openai-direct': 'OpenAI',
  'google-direct': 'Google',
  'meshy-direct':  'Meshy',
  'replicate':     'Replicate',
  'falai':         'fal.ai',
}
import { useWorkflowStore } from '@/lib/store/workflowStore'

// Tiny chip + popover that shows which provider route is being used for
// this model and lets the user override. Collapsed by default — the
// auto-pick (cheapest available) handles 95% of cases.
export default function RoutePicker({ modelSlug, value, onChange }: {
  modelSlug: string
  value?: RouteId
  onChange: (route: RouteId | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  const routes = listRoutes(modelSlug)
  // Pick the resolved route (either user-picked or first available).
  const resolved = value
    ? routes.find(r => r.id === value)
    : routes.find(r => keyAvailable(r, apiKeys))

  if (routes.length <= 1) {
    // No alternatives — just show the route silently. No picker.
    return (
      <span className="text-[9.5px] uppercase tracking-wider text-[var(--ink-faint)]">
        via {SHORT_LABEL[(resolved?.id ?? routes[0]?.id) as RouteId] ?? '—'}
      </span>
    )
  }

  return (
    <div className="relative nodrag">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10px] text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors"
      >
        <span className="uppercase tracking-wider">via {resolved?.id ? SHORT_LABEL[resolved.id] : '—'}</span>
        {typeof resolved?.costUsd === 'number' && (
          <span className="text-[var(--ink-faint)]">~${resolved.costUsd.toFixed(2)}</span>
        )}
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 right-0 w-60 rounded-2xl overflow-hidden glass-strong py-1"
          style={{ boxShadow: 'var(--shadow-clay)' }}
        >
          {routes.map(r => {
            const available = keyAvailable(r, apiKeys)
            const isSelected = (value ?? resolved?.id) === r.id
            return (
              <button
                key={r.id}
                type="button"
                disabled={!available}
                onClick={() => { onChange(r.id); setOpen(false) }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[11px] transition-colors ${isSelected ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--bg-elevated)]'} ${available ? '' : 'opacity-40 cursor-not-allowed'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--ink)] font-medium truncate">{describeRoute(r.id)}</div>
                  <div className="text-[9.5px] text-[var(--ink-faint)]">
                    {typeof r.costUsd === 'number' ? `~$${r.costUsd.toFixed(2)}/call` : (r.costUsd === null ? 'metered' : '—')}
                    {!available && ' · key missing'}
                  </div>
                </div>
                {isSelected && <Check size={11} className="text-[var(--accent)] flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

import type { APIKeys } from '@/lib/store/workflowStore'
function keyAvailable(r: RouteOption, apiKeys: APIKeys): boolean {
  const map: Record<RouteId, keyof APIKeys> = {
    'muapi': 'muapi',
    'openai-direct': 'openai',
    'google-direct': 'google',
    'meshy-direct': 'meshy',
    'replicate': 'replicate',
    'falai': 'falai',
  }
  return Boolean(apiKeys[map[r.id]])
}
