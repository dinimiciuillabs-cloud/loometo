'use client'
// Three-way segmented control used by the Text & Prompt nodes to pick a
// provider (OpenAI / Gemini / MuAPI). Pills can be disabled for two
// reasons: no API key (user can fix), or no models in this category for
// that provider (e.g. Google has no upscalers — nothing to switch to).
// Both reasons render faded with a tooltip explaining why.

import { useWorkflowStore } from '@/lib/store/workflowStore'
import { type LLMProvider, providerKeyField } from '@/lib/api/llm'

const LABELS: Record<LLMProvider, string> = {
  openai:     'OpenAI',
  google:     'Gemini',
  // White-labeled — internally still routes to MuAPI, user sees the
  // Loometo brand instead of "we're reselling MuAPI".
  muapi:      'Loometo',
  elevenlabs: 'ElevenLabs',
  meshy:      'Meshy',
}

// Tiny brand glyph for each — keeps the pill compact but unmistakable.
const GLYPHS: Record<LLMProvider, string> = {
  openai:     '◉',     // hollow ring (OpenAI vibes)
  google:     '✶',     // sparkle (Gemini)
  muapi:      '▣',     // square (MuAPI)
  elevenlabs: '◈',     // diamond (ElevenLabs — voice)
  meshy:      '⬢',     // hexagon (Meshy — 3D mesh)
}

export default function ProviderPills({
  value, onChange,
  options = ['openai', 'google', 'muapi', 'elevenlabs'],
  unavailable,
}: {
  value: LLMProvider
  onChange: (v: LLMProvider) => void
  options?: LLMProvider[]
  // Providers in this set have zero models for the current category — they
  // render dimmed with a different tooltip than the no-key case. Pass undefined
  // (or omit) when this distinction doesn't apply (e.g. TTS node).
  unavailable?: Set<LLMProvider>
}) {
  const apiKeys = useWorkflowStore(s => s.apiKeys)
  return (
    <div
      className="flex gap-1 p-1 rounded-full nodrag"
      style={{ background: 'var(--bg-elevated)' }}
    >
      {options.map(p => {
        const hasKey = Boolean(apiKeys[providerKeyField(p)])
        const noModels = unavailable?.has(p) ?? false
        const enabled = hasKey && !noModels
        const isActive = value === p && enabled
        const tooltip =
          noModels ? `No ${LABELS[p]} models available for this node` :
          !hasKey  ? `Add a ${LABELS[p]} API key to use this provider` : ''
        return (
          <button
            key={p}
            type="button"
            onClick={() => enabled && onChange(p)}
            disabled={!enabled}
            title={tooltip}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
              isActive
                ? 'text-[var(--ink)]'
                : 'text-[var(--ink-mute)] hover:text-[var(--ink)]'
            } ${enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
            style={isActive ? {
              background: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-clay-sm, 0 1px 2px rgba(0,0,0,0.08))',
            } : undefined}
          >
            <span className="text-[10px] opacity-70">{GLYPHS[p]}</span>
            <span>{LABELS[p]}</span>
          </button>
        )
      })}
    </div>
  )
}
