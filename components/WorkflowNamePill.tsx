'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Pencil } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'

// Editable workflow name + save status. Click to rename — Enter or blur
// commits. The "Saved · 2s ago" caption refreshes once a second from the
// store's lastAutoSaveAt.

export default function WorkflowNamePill() {
  const name = useWorkflowStore(s => s.currentWorkflowName)
  const setName = useWorkflowStore(s => s.setCurrentWorkflowName)
  const lastAutoSaveAt = useWorkflowStore(s => s.lastAutoSaveAt)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name ?? '')
  const [, force] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refresh "saved Xs ago" once per second so the label stays current
  // without the rest of the tree re-rendering.
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { setDraft(name ?? '') }, [name])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    setName(trimmed.length > 0 ? trimmed : null)
    setEditing(false)
  }

  const display = name ?? 'Untitled workflow'
  const status = lastAutoSaveAt > 0 ? `Saved · ${ago(lastAutoSaveAt)}` : 'Auto-save on'

  return (
    <div
      className="group flex items-center gap-2 pl-2 pr-3.5 py-1.5 rounded-full transition-colors"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--line-soft)',
      }}
    >
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: name
            ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
            : 'var(--bg-elevated)',
          color: name ? 'var(--accent)' : 'var(--ink-mute)',
        }}
      >
        <FileText size={11} />
      </div>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(name ?? ''); setEditing(false) }
          }}
          placeholder="Workflow name"
          className="bg-transparent border-0 outline-none text-[12px] font-medium text-[var(--ink)] placeholder-[var(--ink-faint)] w-[160px]"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink)] hover:text-[var(--accent)] transition-colors"
          title="Click to rename"
        >
          <span className={name ? '' : 'italic opacity-70'}>{display}</span>
          <Pencil size={9} className="opacity-0 group-hover:opacity-60 transition-opacity" />
        </button>
      )}
      <span className="flex items-center gap-1 text-[9.5px] text-[var(--ink-faint)] pl-2 border-l border-[var(--line-soft)] uppercase tracking-[0.1em]">
        <Check size={9} style={{ color: lastAutoSaveAt > 0 ? 'var(--cat-image)' : 'var(--ink-mute)' }} />
        {status}
      </span>
    </div>
  )
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}
