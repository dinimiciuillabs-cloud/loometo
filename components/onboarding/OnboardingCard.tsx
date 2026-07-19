'use client'
import { X, Key, MousePointerSquareDashed, Play } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'

const STEPS = [
  {
    icon: Key,
    title: 'Set up your keys',
    body: 'Hit Setup Keys top right and paste in your API keys. One-time.',
  },
  {
    icon: MousePointerSquareDashed,
    title: 'Build a workflow',
    body: 'Drag nodes from the left, drop on the canvas. Drag from a dot on one node to a dot on another to wire them.',
  },
  {
    icon: Play,
    title: 'Run it',
    body: 'Click Run on any node. The output flows into the next node automatically. End on an Output node to download.',
  },
]

export default function OnboardingCard() {
  const dismissed = useWorkflowStore(s => s.onboardingDismissed)
  const dismiss = useWorkflowStore(s => s.dismissOnboarding)
  if (dismissed) return null

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-30 animate-fade-in"
      style={{ pointerEvents: 'auto', width: 'min(680px, calc(100% - 32px))' }}
    >
      <div
        className="rounded-3xl px-6 py-5 glass-strong"
        style={{ boxShadow: 'var(--shadow-clay)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[var(--ink)] text-base leading-none">How to use Loometo</span>
            <span className="text-[var(--ink-mute)] text-[10.5px] uppercase tracking-[0.14em]">three steps</span>
          </div>
          <button
            onClick={dismiss}
            className="w-8 h-8 rounded-full hover:bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <div key={i} className="flex gap-3 items-start">
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center clay-surface-soft"
                  style={{ background: 'var(--bg-surface)', color: 'var(--ink)' }}
                >
                  <Icon size={15} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[var(--ink-faint)] text-[10px] font-mono">0{i + 1}</span>
                    <span className="text-[var(--ink)] text-[12px] font-medium">{step.title}</span>
                  </div>
                  <p className="text-[var(--ink-soft)] text-[11px] leading-snug">{step.body}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
