'use client'
// PresetMenu — small dropdown attached to generator nodes. Lets the
// user save the node's current configuration (prompt + model + params)
// as a named preset, reload any saved preset back onto the node, or
// manage existing ones. Per-node-type — a Compositor preset only
// loads into a Compositor node, etc.

import { useEffect, useState } from 'react'
import { Bookmark, Plus, Trash2, X } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import {
  savePreset, getPreset, listPresets, deletePreset,
  type NodePreset,
} from '@/lib/store/presetStore'

interface PresetMenuProps {
  nodeId: string
  nodeType: string
  data: Record<string, unknown>
}

export default function PresetMenu({ nodeId, nodeType, data }: PresetMenuProps) {
  const update = useWorkflowStore(s => s.updateNodeData)
  const [open, setOpen] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<Array<Pick<NodePreset, 'id' | 'name' | 'savedAt'>>>([])

  // Refresh the preset list whenever the menu opens.
  useEffect(() => {
    if (open) setPresets(listPresets(nodeType))
  }, [open, nodeType])

  const handleSave = () => {
    if (!presetName.trim()) return
    savePreset(nodeType, presetName.trim(), data)
    setPresetName('')
    setShowSaveDialog(false)
    setPresets(listPresets(nodeType))
  }

  const handleLoad = (id: string) => {
    const preset = getPreset(nodeType, id)
    if (!preset) return
    // Merge preset.data into the current node.data, preserving any
    // wired inputs (heavy URLs, refs) that aren't on the preset.
    update(nodeId, preset.data)
    setOpen(false)
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deletePreset(nodeType, id)
    setPresets(listPresets(nodeType))
  }

  return (
    <div className="relative nodrag">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider"
        style={{
          background: 'var(--bg-elevated)',
          color: 'var(--ink-mute)',
          border: '1px solid var(--line)',
        }}
        title="Save or load a preset for this node type"
      >
        <Bookmark size={10} />
        Preset
      </button>

      {open && !showSaveDialog && (
        <div
          className="absolute top-full right-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--line)',
            minWidth: '200px',
            maxHeight: '320px',
          }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: '280px' }}>
            <button
              type="button"
              onClick={() => {
                setShowSaveDialog(true)
                setPresetName('')
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[10px] hover:bg-[var(--bg-elevated)]"
              style={{ color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)' }}
            >
              <Plus size={11} />
              Save current as preset
            </button>

            {presets.length === 0 ? (
              <div className="px-3 py-3 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                No saved presets for this node type yet.
              </div>
            ) : (
              presets.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleLoad(p.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] hover:bg-[var(--bg-elevated)] group"
                  style={{ color: 'var(--ink-soft)' }}
                >
                  <span className="text-left truncate flex-1">{p.name}</span>
                  <span
                    onClick={(e) => handleDelete(p.id, e)}
                    className="opacity-0 group-hover:opacity-100 ml-2 p-0.5 rounded hover:bg-[var(--bg-surface)]"
                    style={{ color: 'var(--ink-faint)' }}
                    title="Delete preset"
                  >
                    <Trash2 size={10} />
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {open && showSaveDialog && (
        <div
          className="absolute top-full right-0 mt-1 z-50 rounded-lg shadow-xl p-3"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--line)',
            minWidth: '240px',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-mute)' }}>
              Save preset
            </span>
            <button
              type="button"
              onClick={() => setShowSaveDialog(false)}
              style={{ color: 'var(--ink-faint)' }}
            >
              <X size={11} />
            </button>
          </div>
          <input
            type="text"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            placeholder="e.g. AG2 bakery sheet v3"
            autoFocus
            className="w-full px-2 py-1.5 rounded text-[11px] focus:outline-none"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
            }}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!presetName.trim()}
            className="w-full mt-2 px-3 py-1.5 rounded text-[10px] uppercase tracking-wider disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
