'use client'
import { useMemo } from 'react'
import { WandSparkles } from 'lucide-react'

// Prompt linter — flags known AI-tell phrases in positive prompts and
// offers a one-tap fix. The dictionary is the anti-AI-tell checklist
// from the Director Formula: these phrases either do nothing (pure
// AI-shibboleth noise) or actively trigger the plastic-AI look.
//
// Deterministic, zero API cost. Only add entries with a known, stable
// effect — this is a trust surface, not a style opinion.

interface Tell {
  match: RegExp
  label: string
  // Replacement text, or null to remove the phrase entirely.
  fix: string | null
  why: string
}

const TELLS: Tell[] = [
  { match: /\b8\s?k\b/gi, label: '8k', fix: null, why: 'Known AI marker — models render it as noise' },
  { match: /\bmasterpiece\b/gi, label: 'masterpiece', fix: null, why: 'Does nothing on modern models' },
  { match: /\bbest quality\b/gi, label: 'best quality', fix: null, why: 'Does nothing on modern models' },
  { match: /\bhighly detailed\b/gi, label: 'highly detailed', fix: null, why: 'Vague — name WHAT should be detailed instead' },
  { match: /\bhyper[- ]?detailed\b/gi, label: 'hyper-detailed', fix: null, why: 'Triggers fake overlay detail' },
  { match: /\bultra[- ]?realistic\b/gi, label: 'ultra-realistic', fix: 'photographic, natural detail', why: 'Triggers the default AI face — be concrete' },
  { match: /\bflawless skin\b/gi, label: 'flawless skin', fix: 'natural skin with visible pores', why: 'Triggers plastic AI smoothing' },
  { match: /\bporcelain skin\b/gi, label: 'porcelain skin', fix: 'natural skin with visible pores', why: 'Triggers plastic AI smoothing' },
  { match: /\bperfect skin\b/gi, label: 'perfect skin', fix: 'natural skin', why: 'Triggers plastic AI smoothing' },
  { match: /\bultra[- ]?smooth\b/gi, label: 'ultra-smooth', fix: null, why: 'Triggers plastic AI smoothing' },
]

// Remove/replace a tell and tidy the punctuation debris it leaves behind
// (", ," / doubled spaces / leading-trailing separators).
function applyFix(value: string, tell: Tell): string {
  let out = value.replace(tell.match, tell.fix ?? '')
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/^[\s,]+/, '')
    .replace(/[\s,]+$/, '')
  return out
}

export default function PromptLint({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  const hits = useMemo(
    () => TELLS.filter(t => {
      t.match.lastIndex = 0
      return t.match.test(value)
    }),
    [value],
  )
  if (hits.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 nodrag">
      <span className="text-[8.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
        AI tells
      </span>
      {hits.map(tell => (
        <button
          key={tell.label}
          type="button"
          onClick={() => onChange(applyFix(value, tell))}
          title={`${tell.why}. Tap to ${tell.fix ? `replace with "${tell.fix}"` : 'remove'}.`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium transition-colors hover:brightness-110"
          style={{
            background: 'color-mix(in srgb, var(--cat-helper) 14%, transparent)',
            color: 'var(--cat-helper)',
          }}
        >
          <WandSparkles size={8} strokeWidth={2.5} />
          {tell.label}
        </button>
      ))}
    </div>
  )
}
