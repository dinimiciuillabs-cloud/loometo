'use client'
import { useEffect, useRef, useState } from 'react'
import { Save, FolderOpen, Trash2, FileText, X, Download, Upload, Copy, Pencil } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'

export default function WorkflowMenu({ onClose }: { onClose: () => void }) {
  const {
    saveWorkflow, loadWorkflow, listWorkflows, deleteWorkflow,
    clearCanvas, renameWorkflow, duplicateWorkflow,
    exportWorkflow, importWorkflow,
    currentWorkflowName,
  } = useWorkflowStore()
  const [name, setName] = useState('')
  const [items, setItems] = useState(listWorkflows())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  const refresh = () => setItems(listWorkflows())

  const handleSave = () => {
    // Empty name field + an active workflow = save over the current one
    // (the input renders the active name as placeholder so this matches
    // what the user sees).
    const trimmed = name.trim() || currentWorkflowName || ''
    if (!trimmed) return
    saveWorkflow(trimmed)
    setName('')
    refresh()
  }

  const handleLoad = (n: string) => {
    const ok = loadWorkflow(n)
    if (ok) onClose()
  }

  const handleNew = () => {
    // Snapshot the current canvas into its slot (named workflow or the
    // 'untitled' bucket) BEFORE clearing, so "new workflow" is never
    // destructive and needs no scary confirm dialog.
    const state = useWorkflowStore.getState()
    if (state.nodes.length > 0) {
      saveWorkflow(currentWorkflowName || 'untitled')
    }
    clearCanvas()
    refresh()
    onClose()
  }

  const handleExport = (workflowName: string) => {
    const json = exportWorkflow(workflowName)
    if (!json) return
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${workflowName.replace(/[^a-z0-9-_]+/gi, '-')}.loometo.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleImportClick = () => fileInputRef.current?.click()
  const handleImportFile = async (file: File) => {
    const text = await file.text()
    // Default name from filename — strip extension + .loometo suffix.
    const base = file.name.replace(/\.json$/i, '').replace(/\.loometo$/i, '')
    let chosen = base.trim() || 'Imported workflow'
    // Avoid collisions by appending (2), (3), etc.
    const existing = new Set(listWorkflows().map(w => w.name))
    if (existing.has(chosen)) {
      let n = 2
      while (existing.has(`${chosen} (${n})`)) n++
      chosen = `${chosen} (${n})`
    }
    const ok = importWorkflow(chosen, text)
    if (ok) refresh()
    else alert('Could not import — file does not look like a Loometo workflow.')
  }

  const handleRename = (oldName: string) => {
    const t = renameDraft.trim()
    if (!t || t === oldName) { setRenaming(null); return }
    const ok = renameWorkflow(oldName, t)
    if (!ok) { alert(`Could not rename — name "${t}" is already in use.`); return }
    setRenaming(null); setRenameDraft(''); refresh()
  }

  const handleDuplicate = (workflowName: string) => {
    const existing = new Set(listWorkflows().map(w => w.name))
    let chosen = `${workflowName} copy`
    if (existing.has(chosen)) {
      let n = 2
      while (existing.has(`${workflowName} copy ${n}`)) n++
      chosen = `${workflowName} copy ${n}`
    }
    duplicateWorkflow(workflowName, chosen)
    refresh()
  }

  return (
    <div
      ref={menuRef}
      className="absolute top-full right-0 mt-2 z-50 animate-fade-in glass-strong"
      style={{
        width: 300,
        borderRadius: 22,
        boxShadow: 'var(--shadow-clay)',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-elevated)] transition-colors z-10"
        title="Close"
      >
        <X size={13} />
      </button>

      {/* Save row */}
      <div className="p-3.5 border-b border-[var(--line-soft)] space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-[var(--ink-mute)] uppercase tracking-[0.14em] font-medium">Save current</p>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.12em] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-elevated)] transition-colors"
            title="Import a .loometo.json file"
          ><Upload size={10} />Import</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleImportFile(f)
            e.target.value = ''
          }}
        />
        <div className="flex gap-1.5">
          <input
            value={name || currentWorkflowName || ''}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            placeholder={currentWorkflowName || 'Workflow name'}
            className="flex-1 rounded-full px-3.5 py-1.5 text-[12px] text-[var(--ink)] focus:outline-none placeholder-[var(--ink-faint)] clay-surface-soft border-0"
            style={{ background: 'var(--bg-surface)' }}
          />
          <button
            onClick={handleSave}
            disabled={!(name.trim() || currentWorkflowName)}
            className="clay-press flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}
          >
            <Save size={12} />
            Save
          </button>
        </div>
      </div>

      {/* Saved list */}
      <div className="p-3 max-h-72 overflow-y-auto scrollbar-thin">
        <p className="text-[10px] text-[var(--ink-mute)] uppercase tracking-[0.14em] font-medium mb-2">Your workflows</p>
        {items.length === 0 ? (
          <div className="text-center py-6 text-[11.5px] text-[var(--ink-faint)]">
            No saved workflows yet.<br />Save one above to reuse later.
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map(item => {
              const isActive = currentWorkflowName === item.name
              const isRenaming = renaming === item.name
              return (
                <div
                  key={item.name}
                  className="group flex items-center gap-2 px-3 py-2 rounded-2xl hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors"
                  style={isActive ? { background: 'color-mix(in srgb, var(--accent) 10%, transparent)' } : undefined}
                  onClick={() => !isRenaming && handleLoad(item.name)}
                >
                  <FileText size={12} className="flex-shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--ink-mute)' }} />
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={e => setRenameDraft(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') handleRename(item.name)
                          if (e.key === 'Escape') { setRenaming(null); setRenameDraft('') }
                        }}
                        onBlur={() => handleRename(item.name)}
                        className="w-full text-[12px] text-[var(--ink)] bg-transparent focus:outline-none border-b nodrag"
                        style={{ borderColor: 'var(--accent)' }}
                      />
                    ) : (
                      <div className="text-[12px] text-[var(--ink)] truncate flex items-center gap-1.5">
                        {item.name}
                        {isActive && <span className="text-[8.5px] uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>active</span>}
                      </div>
                    )}
                    <div className="text-[10px] text-[var(--ink-faint)]">
                      {item.nodeCount} node{item.nodeCount === 1 ? '' : 's'} · {timeAgo(item.savedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenaming(item.name); setRenameDraft(item.name) }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-surface)] transition-all"
                      title="Rename"
                    ><Pencil size={10} /></button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(item.name) }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-surface)] transition-all"
                      title="Duplicate"
                    ><Copy size={10} /></button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExport(item.name) }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-surface)] transition-all"
                      title="Download .loometo.json"
                    ><Download size={10} /></button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Delete workflow "${item.name}"?`)) {
                          deleteWorkflow(item.name)
                          refresh()
                        }
                      }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--cat-video)] hover:bg-[var(--cat-video)]/10 transition-all"
                      title="Delete"
                    ><Trash2 size={10} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* New workflow */}
      <div className="p-3 border-t border-[var(--line-soft)]">
        <button
          onClick={handleNew}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-[11.5px] font-medium text-[var(--ink-soft)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <FolderOpen size={12} />
          New empty workflow
        </button>
      </div>
    </div>
  )
}

function timeAgo(ts: number): string {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}
