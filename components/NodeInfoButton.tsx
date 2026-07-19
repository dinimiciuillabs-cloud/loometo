'use client'
import { useState } from 'react'
import { Info, X } from 'lucide-react'

interface NodeInfoButtonProps {
  title: string
  simpleExplanation: string
  inputs?: string[]
  outputs?: string[]
}

export default function NodeInfoButton({ title, simpleExplanation, inputs = [], outputs = [] }: NodeInfoButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        className="w-6 h-6 rounded-full hover:bg-[var(--bg-elevated)] flex items-center justify-center transition-colors nodrag"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        title="What does this do?"
      >
        <Info size={11} className="text-[var(--ink-mute)]" />
      </button>

      {open && (
        <div
          className="absolute z-50 bottom-full mb-2 right-0 w-64 animate-fade-in nodrag"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="rounded-2xl overflow-hidden glass-strong"
            style={{ boxShadow: 'var(--shadow-clay)' }}
          >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--line-soft)]">
              <span className="text-[var(--ink)] text-[12px] font-medium">{title}</span>
              <button
                className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-elevated)] transition-colors"
                onClick={() => setOpen(false)}
              >
                <X size={12} />
              </button>
            </div>

            <div className="px-3 py-3">
              <p className="text-[var(--ink-soft)] text-[11.5px] leading-relaxed">{simpleExplanation}</p>

              {(inputs.length > 0 || outputs.length > 0) && (
                <div className="mt-3 flex gap-4">
                  {inputs.length > 0 && (
                    <div>
                      <p className="text-[var(--ink-faint)] text-[9.5px] uppercase tracking-[0.1em] mb-1.5">Takes in</p>
                      <div className="flex flex-wrap gap-1">
                        {inputs.map(i => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--ink-soft)]">{i}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {outputs.length > 0 && (
                    <div>
                      <p className="text-[var(--ink-faint)] text-[9.5px] uppercase tracking-[0.1em] mb-1.5">Outputs</p>
                      <div className="flex flex-wrap gap-1">
                        {outputs.map(o => (
                          <span key={o} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--ink-soft)]">{o}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
