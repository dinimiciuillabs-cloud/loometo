'use client'
import { useBlueMessage } from '@/components/AnimatedMascot'

// Glass-clay card containing Blue's current message.
export default function BlueTipCard() {
  const msg = useBlueMessage()
  if (!msg) return null

  return (
    // ABSOLUTELY positioned above the search pill — bottom: 100% anchors
    // the bubble to the top edge of its relative parent (the search pill
    // container), and mb-2 leaves a small gap. Critical: no layout
    // contribution, so the search pill stays put when Blue speaks/falls
    // silent. pointer-events-none on the wrapper lets clicks through to
    // the search; the inner card re-enables pointer events for hover.
    <div
      className="absolute left-0 right-0 animate-fade-in pointer-events-none"
      style={{ bottom: '100%', marginBottom: 8 }}
    >
      <div
        className="rounded-2xl px-3.5 py-2.5 clay-surface-soft glass-strong relative pointer-events-auto"
        style={{ border: '1px solid var(--glass-border)' }}
      >
        {/* Tail pointing DOWN at the search pill (since the bubble now
            sits above the search, not below the mascot). */}
        <div
          style={{
            position: 'absolute',
            bottom: -7,
            left: 18,
            width: 0, height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '7px solid var(--glass-border)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -5,
            left: 19,
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '6px solid var(--bg-surface)',
            opacity: 0.85,
          }}
        />
        <p className="text-[var(--ink)] text-[11.5px] leading-snug">{msg}</p>
      </div>
    </div>
  )
}
