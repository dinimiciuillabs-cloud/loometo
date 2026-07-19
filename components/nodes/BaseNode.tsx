'use client'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, useUpdateNodeInternals } from '@xyflow/react'
import { Play, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react'
import NodeInfoButton from '../NodeInfoButton'
import PresetMenu from './PresetMenu'
import { NodeCategory } from '@/lib/types/nodes'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { registerRunHandler, unregisterRunHandler } from '@/lib/flow/runRegistry'
import { propagateFromNode } from '@/lib/flow/propagate'

// Generator nodes that benefit from Save/Load Preset. Configuration on
// these nodes (prompt, model, params, route) is non-trivial to
// recreate, so users get the most leverage by saving winning configs
// for reuse. Static nodes (Crop, Blur, Output) don't need it.
const PRESETTABLE_TYPES = new Set([
  'textToImageNode',
  'imageToImageNode',
  'compositorNode',
  'referenceSheetNode',
  'characterBoardNode',
  'locationBoardNode',
  'productBoardNode',
  'bRollBoardNode',
  'storyboardNode',
  'mascotBoardNode',
  'creatureBoardNode',
  'textToVideoNode',
  'imageToVideoNode',
  'videoToVideoNode',
  'upscaleNode',
  'relightNode',
  'inpaintNode',
  'outpaintNode',
  'faceSwapNode',
  'outfitChangeNode',
  'lipSyncNode',
  'speechToVideoNode',
  'ttsNode',
  'llmNode',
  'imageToJsonNode',
  'promptEnhancerNode',
  'directorPromptNode',
])

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface BaseNodeProps {
  id?: string
  title: string
  category: NodeCategory
  simpleExplanation: string
  inputs?: Array<{ id: string; label: string; type?: string }>
  outputs?: Array<{ id: string; label: string; type?: string }>
  hasRunButton?: boolean
  onRun?: () => Promise<void>
  status?: RunStatus
  children?: ReactNode
  selected?: boolean
  collapsible?: boolean
}

const CATEGORY_VAR: Record<string, string> = {
  text: 'var(--cat-text)',
  image: 'var(--cat-image)',
  video: 'var(--cat-video)',
  edit: 'var(--cat-edit)',
  mask: 'var(--cat-mask)',
  helper: 'var(--cat-helper)',
  output: 'var(--cat-output)',
}

const HANDLE_VAR: Record<string, string> = {
  text: 'var(--cat-text)',
  image: 'var(--cat-image)',
  video: 'var(--cat-video)',
  mask: 'var(--cat-mask)',
  audio: 'var(--cat-edit)',
  mesh: 'var(--cat-text)',
  any: 'var(--cat-helper)',
}

// Neon cyberpunk palette — used ONLY for selection halo + resize handles.
// Resting node colors stay editorial-muted; selected nodes light up.
const CATEGORY_HEX: Record<string, string> = {
  text:   '#B94EFF',  // electric purple
  image:  '#00E5FF',  // cyan
  video:  '#FF2D87',  // hot pink
  edit:   '#2E92FF',  // electric blue
  mask:   '#39FF14',  // electric lime
  helper: '#FFB400',  // electric amber
  output: '#FFEA00',  // acid yellow
}

// DisplayNameChip — the human-readable "talkback" id rendered below
// the node title. Single-click copies the name to clipboard so the
// user can paste it into chat. Double-click opens an inline rename
// input with collision detection against other nodes' displayNames.
function DisplayNameChip({ nodeId }: { nodeId: string }) {
  const rfNode = useReactFlow().getNode(nodeId)
  const displayName = (rfNode?.data?.displayName as string) || ''
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)
  const allNodes = useWorkflowStore(s => s.nodes)
  const demoMode = useWorkflowStore(s => s.demoMode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(displayName)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setDraft(displayName) }, [displayName])

  if (!displayName && !editing) return null

  const submit = () => {
    const t = draft.trim()
    if (!t) { setEditing(false); return }
    const taken = allNodes.some(n => n.id !== nodeId && (n.data?.displayName as string | undefined)?.toLowerCase() === t.toLowerCase())
    if (taken) { alert(`The name "${t}" is already used by another node.`); return }
    updateNodeData(nodeId, { displayName: t })
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') { setDraft(displayName); setEditing(false) }
        }}
        onBlur={submit}
        onClick={e => e.stopPropagation()}
        className="text-[9.5px] uppercase tracking-[0.08em] bg-transparent outline-none border-b nodrag"
        style={{
          color: 'var(--ink-soft)',
          fontFamily: 'var(--font-mono), JetBrains Mono, monospace',
          borderColor: 'var(--accent)',
          width: '100%',
        }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        try { navigator.clipboard?.writeText(displayName) } catch {}
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // Disable inline rename in demo mode — read-only embed.
        if (demoMode) return
        setEditing(true)
      }}
      className="text-[9.5px] uppercase tracking-[0.08em] truncate text-left nodrag hover:opacity-100 transition-opacity"
      style={{
        color: 'var(--ink-faint)',
        fontFamily: 'var(--font-mono), JetBrains Mono, monospace',
        opacity: 0.7,
      }}
      title={`${displayName} · click to copy, double-click to rename`}
    >
      {displayName}
    </button>
  )
}

export default function BaseNode({
  id, title, category, simpleExplanation,
  inputs = [], outputs = [],
  hasRunButton = false, onRun, status = 'idle',
  children, selected, collapsible = false,
}: BaseNodeProps) {
  const color = CATEGORY_VAR[category]
  const colorHex = CATEGORY_HEX[category]
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [localStatus, setLocalStatus] = useState<RunStatus>(status)
  const deleteNode = useWorkflowStore(s => s.deleteNode)
  // Demo mode flips Run button + presets + delete affordance off so a
  // showcase embed renders as a static-feeling read-only canvas.
  const demoMode = useWorkflowStore(s => s.demoMode)
  // Subscribe to the pulse list; whenever this node's id is in it we paint
  // the rainbow shimmer halo. Either an external actor (Claude Code via
  // the bridge) or our own run handler can flip this on.
  const isBridgePulsing = useWorkflowStore(s => id ? s.pulsingNodeIds.includes(id) : false)
  const isWorking = isBridgePulsing || localStatus === 'running'
  const rf = useReactFlow()

  // Surface the last error onto the card so failed runs aren't invisible.
  // handleRun writes to `lastError` on the node's data; we read it here.
  const lastError = useWorkflowStore(s => {
    if (!id) return ''
    const node = s.nodes.find(n => n.id === id)
    return (node?.data?.lastError as string) || ''
  })

  // Tells React Flow to re-measure handle DOM rects. Critical fix for
  // "wire doesn't start at the visible bullet" — React Flow caches each
  // handle's position at mount and won't update on its own when the inner
  // layout shifts (collapse, content size changes, etc).
  const updateNodeInternals = useUpdateNodeInternals()

  const wrapperRef = useRef<HTMLDivElement>(null)

  // Pop-in animation. CRITICAL: re-measure handle positions AFTER the scale
  // animation finishes, because React Flow's getBoundingClientRect() returns
  // SCALED dimensions during the transform. If we don't re-measure, every
  // node's handle positions get cached at scale(0.6) and wires terminate at
  // wrong coordinates.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    el.classList.add('node-pop-in')
    const t = setTimeout(() => {
      el.classList.remove('node-pop-in')
      if (id) updateNodeInternals(id)
    }, 400)
    return () => clearTimeout(t)
  }, [id, updateNodeInternals])

  // ResizeObserver — catches every layout shift: textarea growing, image/video
  // previews appearing, select dropdowns rendering, result text showing up,
  // etc. Each shift moves the handle's DOM rect, so we tell React Flow to
  // re-measure on every observed resize.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || !id) return
    const observer = new ResizeObserver(() => updateNodeInternals(id))
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, updateNodeInternals])

  // Also refresh on explicit structural changes — collapse toggle, input/output
  // count changes. ResizeObserver catches these too, but this is belt-and-suspenders.
  useEffect(() => {
    if (!id) return
    updateNodeInternals(id)
    const raf = requestAnimationFrame(() => updateNodeInternals(id))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, collapsed, inputs.length, outputs.length])

  const resolveId = (): string | undefined => {
    if (id) return id
    const sel = rf.getNodes().find(n => n.selected)
    return sel?.id
  }

  // Keep a ref to the LATEST onRun closure. The registered handler always
  // calls through this ref, so Run All invocations pick up the freshest
  // closure (which captures the freshest `data` prop after propagation),
  // not whatever closure was active at registration time.
  const onRunRef = useRef(onRun)
  useEffect(() => { onRunRef.current = onRun }, [onRun])

  const handleRun = async () => {
    if (localStatus === 'running') return
    // Force-propagate the entire graph BEFORE running so the handler
    // closure sees the freshest upstream values. Propagation normally
    // fires on updateNodeData / onConnect, but rehydrate races,
    // bridge-driven connects, and HMR can all leave stale input fields
    // even when the wires are visually correct.
    {
      const s = useWorkflowStore.getState()
      let nodes = s.nodes
      for (const n of nodes) {
        nodes = propagateFromNode(nodes, s.edges, n.id)
      }
      if (nodes !== s.nodes) {
        useWorkflowStore.setState({ nodes })
        // Wait two animation frames so React commits the re-render and
        // useEffect refreshes onRunRef.current with the new closure that
        // captures the freshly-propagated `data` prop.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
    }
    const fn = onRunRef.current
    if (!fn) return
    setLocalStatus('running')
    const nodeId = id ?? resolveId()
    if (nodeId) useWorkflowStore.getState().updateNodeData(nodeId, { lastError: '' })
    try {
      await fn()
      setLocalStatus('done')
      setTimeout(() => setLocalStatus('idle'), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Node ${nodeId ?? '?'}] run failed:`, err)
      if (nodeId) useWorkflowStore.getState().updateNodeData(nodeId, { lastError: message })
      setLocalStatus('error')
      // Leave the error on the card; user clears by re-running.
      setTimeout(() => setLocalStatus('idle'), 4000)
    }
  }

  useEffect(() => {
    const nodeId = id ?? resolveId()
    if (!nodeId) return
    registerRunHandler(nodeId, handleRun)
    return () => unregisterRunHandler(nodeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative rounded-3xl overflow-visible ${selected ? 'node-selected-glow' : ''} ${isWorking ? 'node-pulsing' : ''}`}
      style={{
        background: 'var(--bg-surface)',
        boxShadow: selected ? undefined : 'var(--shadow-clay)',
        transition: 'border-color 0.15s ease',
        ['--node-accent' as string]: colorHex,
        minWidth: 280,
        maxWidth: 340,
        // Cap width so long input values / assembled prompts don't stretch
        // the node across the canvas. Nodes that need more room (media
        // previews, boards) set their own width and bypass this.
        width: 320,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-soft)]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: color, boxShadow: `0 0 0 3px ${colorHex}22` }}
          />
          <div className="flex flex-col min-w-0">
            <span className="text-[var(--ink)] text-[13.5px] font-medium tracking-tight truncate">
              {title}
            </span>
            {id && <DisplayNameChip nodeId={id} />}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(() => {
            // Render PresetMenu in the header for generator-class nodes
            // so winning configs are one click away. Hidden in demo
            // mode — preset save/load is an editor-only affordance.
            if (demoMode) return null
            const rfNode = id ? rf.getNode(id) : undefined
            const nodeType = rfNode?.type
            if (!id || !nodeType || !PRESETTABLE_TYPES.has(nodeType)) return null
            const nodeData = (rfNode.data ?? {}) as Record<string, unknown>
            return <PresetMenu nodeId={id} nodeType={nodeType} data={nodeData} />
          })()}
          <NodeInfoButton
            title={title}
            simpleExplanation={simpleExplanation}
            inputs={inputs.map(i => i.label)}
            outputs={outputs.map(o => o.label)}
          />
          {collapsible && (
            <button
              className="w-7 h-7 rounded-full hover:bg-[var(--bg-elevated)] flex items-center justify-center nodrag text-[var(--ink-mute)] transition-colors"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
          )}
          {/* Delete affordance hidden in demo mode — no editing allowed. */}
          {!demoMode && (
            <button
              className={`w-7 h-7 rounded-full flex items-center justify-center nodrag text-[var(--ink-mute)] hover:text-[var(--cat-video)] hover:bg-[var(--cat-video)]/10 transition-all ${hovered || selected ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => {
                const nodeId = resolveId()
                if (nodeId) deleteNode(nodeId)
              }}
              title="Delete node"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Body — flex-1 so it fills the wrapper when user resizes taller, but
          overflow-visible so the -mx-4 edge rows + handles don't get clipped
          and no scrollbar appears. */}
      {!collapsed && (
        <div className="p-4 space-y-2.5 flex-1" style={{ overflow: 'visible' }}>
          {/* Input rows.
              -mx-4 cancels the body's px-4 so each row spans wrapper edge to edge.
              Handle uses React Flow's NATIVE Position.Left placement — no
              custom transform overrides; this lets React Flow's connection
              geometry use the handle's real DOM rect. updateNodeInternals
              above ensures the cache is fresh. */}
          {inputs.length > 0 && (
            <div className="-mx-4 space-y-1.5">
              {inputs.map(input => (
                <div key={input.id} className="relative flex items-center pl-5 pr-4 py-1">
                  {/* Notch — circle of canvas color punched through the card
                      edge, so the handle dot looks recessed into the border
                      instead of floating on top of it. */}
                  <div
                    aria-hidden
                    className="absolute pointer-events-none rounded-full"
                    style={{
                      left: -13,
                      top: '50%',
                      width: 26,
                      height: 26,
                      transform: 'translateY(-50%)',
                      background: 'var(--bg-canvas)',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.10)',
                    }}
                  />
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={input.id}
                    style={{
                      background: HANDLE_VAR[input.type || 'any'] || 'var(--ink-mute)',
                      zIndex: 2,
                    }}
                  />
                  <span className="text-[var(--ink-mute)] text-[11.5px] relative">{input.label}</span>
                </div>
              ))}
            </div>
          )}

          {children}

          {lastError && (
            <div
              className="mt-2 px-3 py-2 rounded-lg text-[10.5px] leading-relaxed"
              style={{
                background: 'color-mix(in srgb, var(--cat-video) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--cat-video) 35%, transparent)',
                color: 'var(--cat-video)',
              }}
              title={lastError}
            >
              <span className="font-medium uppercase tracking-[0.1em] text-[9px] opacity-80 block mb-0.5">Run failed</span>
              <span className="break-words">{lastError.length > 240 ? lastError.slice(0, 240) + '…' : lastError}</span>
            </div>
          )}

          {hasRunButton && !demoMode && (
            <button
              onClick={handleRun}
              disabled={localStatus === 'running'}
              className="clay-press w-full mt-2 py-2.5 rounded-full text-[12px] font-medium flex items-center justify-center gap-1.5 nodrag"
              style={{
                background:
                  localStatus === 'done' ? 'var(--cat-image)' :
                  localStatus === 'error' ? 'var(--cat-video)' :
                  'var(--accent)',
                color: 'var(--bg-surface)',
                opacity: localStatus === 'running' ? 0.7 : 1,
              }}
            >
              {localStatus === 'running' && <Loader2 size={13} className="animate-spin" />}
              {localStatus === 'done' && <CheckCircle size={13} />}
              {localStatus === 'error' && <AlertCircle size={13} />}
              {localStatus === 'idle' && <Play size={13} />}
              {localStatus === 'running' ? 'Generating…' : localStatus === 'done' ? 'Done' : localStatus === 'error' ? 'Retry' : 'Run'}
            </button>
          )}

          {outputs.length > 0 && (
            <div className="-mx-4 space-y-1.5">
              {outputs.map(output => (
                <div key={output.id} className="relative flex items-center justify-end pl-4 pr-5 py-1">
                  {/* Notch on the right edge */}
                  <div
                    aria-hidden
                    className="absolute pointer-events-none rounded-full"
                    style={{
                      right: -13,
                      top: '50%',
                      width: 26,
                      height: 26,
                      transform: 'translateY(-50%)',
                      background: 'var(--bg-canvas)',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.10)',
                    }}
                  />
                  <span className="text-[var(--ink-mute)] text-[11.5px] relative">{output.label}</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={output.id}
                    style={{
                      background: HANDLE_VAR[output.type || 'any'] || 'var(--ink-mute)',
                      zIndex: 2,
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
