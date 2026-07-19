'use client'
import { useState } from 'react'
import { Settings, Trash2, HelpCircle, Play, Loader2, FolderOpen, Save, Check } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import LoometoLogo from './LoometoLogo'
import { topologicalSort } from '@/lib/flow/topo'
import { getRunHandler } from '@/lib/flow/runRegistry'
import WorkflowMenu from './WorkflowMenu'
import WorkflowNamePill from './WorkflowNamePill'
import { useAutoSave } from '@/lib/flow/useAutoSave'

export default function TopNav() {
  const {
    setShowAPIPanel, clearCanvas, apiKeys,
    resetOnboarding,
    nodes, edges,
    saveWorkflow, currentWorkflowName,
  } = useWorkflowStore()
  const hasKeys = Object.values(apiKeys).some(v => v.length > 0)
  const hasNodes = nodes.length > 0
  const [running, setRunning] = useState(false)
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  useAutoSave()

  // Quick-save: hit the button → if there's an active workflow, save over
  // it silently and flash a check; otherwise prompt for a name (or open
  // the menu). Cmd/Ctrl+S also fires this path (wired in app/page.tsx).
  const quickSave = () => {
    if (!hasNodes) return
    let target = currentWorkflowName
    if (!target) {
      const name = prompt('Name this workflow:')?.trim()
      if (!name) return
      target = name
    }
    saveWorkflow(target)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }

  const runAll = async () => {
    if (running) return
    setRunning(true)
    try {
      const ordered = topologicalSort(nodes, edges)
      for (const n of ordered) {
        // Each iteration must fetch the LATEST handler from the registry.
        // Handlers capture node data via closure; when an upstream node
        // finishes, the store propagates new data into downstream nodes,
        // but React hasn't necessarily re-rendered + re-registered the
        // downstream handler yet. We wait two animation frames before
        // each call so React can commit the render and BaseNode's effect
        // can re-register the closure with the fresh data.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        const handler = getRunHandler(n.id)
        if (!handler) continue
        try {
          await handler()
        } catch (err) {
          console.error(`Node ${n.id} (${n.type}) failed during Run All:`, err)
        }
      }
    } finally {
      setRunning(false)
    }
  }

  const iconBtn = "w-9 h-9 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-elevated)] transition-colors"
  const pillBtn = "flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11.5px] font-medium text-[var(--ink-soft)] hover:bg-[var(--bg-elevated)] transition-colors"

  return (
    <div className="h-16 glass border-b border-[var(--line)] flex items-center justify-between px-5 z-40">
      {/* Logo + maker credit */}
      <div className="flex items-center gap-2.5">
        <LoometoLogo />
        <a
          href="https://dinimiciuillabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:block text-[9.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)] hover:text-[var(--ink-mute)] transition-colors"
          title="Made by Dinimiciuil Labs"
        >
          by Dinimiciuil&nbsp;Labs
        </a>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <WorkflowNamePill />

        <div className="w-px h-5 bg-[var(--line)] mx-1.5" />

        {!hasKeys && (
          <button
            onClick={() => setShowAPIPanel(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11.5px] font-medium text-[var(--accent)] bg-[var(--accent-tint)] border border-[var(--accent-soft)]/30 hover:bg-[var(--accent-tint)]/80 transition-colors"
          >
            Add API keys to start
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => setWorkflowMenuOpen(o => !o)}
            className={pillBtn}
            title="Workflows"
          >
            <FolderOpen size={13} />
            Workflows
          </button>
          {workflowMenuOpen && (
            <WorkflowMenu onClose={() => setWorkflowMenuOpen(false)} />
          )}
        </div>

        {hasNodes && (
          <button
            onClick={quickSave}
            className={pillBtn}
            title={currentWorkflowName ? `Save over "${currentWorkflowName}"` : 'Save current workflow'}
            style={justSaved ? { color: 'var(--cat-image)' } : undefined}
          >
            {justSaved ? <Check size={13} /> : <Save size={13} />}
            {justSaved ? 'Saved' : 'Save'}
          </button>
        )}

        {hasNodes && (
          <button
            onClick={runAll}
            disabled={running}
            className="clay-press flex items-center gap-1.5 px-4 py-2 rounded-full text-[11.5px] font-medium"
            style={{ background: 'var(--accent)', color: 'var(--bg-surface)', opacity: running ? 0.7 : 1 }}
            title="Run every node in dependency order"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {running ? 'Running…' : 'Run All'}
          </button>
        )}

        <div className="w-px h-5 bg-[var(--line)] mx-1.5" />

        <button onClick={resetOnboarding} className={iconBtn} title="Show how-to guide">
          <HelpCircle size={15} />
        </button>

        {hasNodes && (
          <button
            onClick={() => { if (confirm('Clear the whole canvas? This cannot be undone.')) clearCanvas() }}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--cat-video)] hover:bg-[var(--bg-elevated)] transition-colors"
            title="Clear canvas"
          >
            <Trash2 size={15} />
          </button>
        )}

        <div className="w-px h-5 bg-[var(--line)] mx-1.5" />

        <button
          onClick={() => setShowAPIPanel(true)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[11.5px] font-medium ${hasKeys
            ? 'text-[var(--ink-soft)] hover:bg-[var(--bg-elevated)] transition-colors'
            : 'clay-press bg-[var(--accent)] text-[var(--bg-surface)]'}`}
        >
          <Settings size={13} />
          {hasKeys ? 'Settings' : 'Setup Keys'}
        </button>
      </div>
    </div>
  )
}
