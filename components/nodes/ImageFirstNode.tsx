'use client'
// Flora-style image-first node wrapper.
//
// Use this in place of BaseNode for VISUAL generator nodes where the
// output (image/video) is the hero — Text→Image, Image→Image, Text→Video,
// Image→Video, all the Boards. Keep BaseNode for text/LLM/helper nodes
// where the form IS the content.
//
// Layout summary:
//   • Output media fills the card body (polaroid feel)
//   • Title / status / close live in a slim top chip
//   • Run / Download / Copy / Info float on the right edge — hover only
//   • Model + aspect + route render as small pills at the bottom strip
//   • Input + output handles fade in on hover
//   • Children (controls + prompt) render in a bottom drawer that is
//     always visible when there's no output, collapses to a compact
//     strip once output exists. Click the strip (or hover) to expand.

import { ReactNode, useEffect, useRef, useState } from 'react'
import {
  Handle, Position, useReactFlow, useUpdateNodeInternals,
} from '@xyflow/react'
import {
  Play, Loader2, CheckCircle, AlertCircle, X, Download, Copy,
  Maximize2, ChevronDown, ChevronUp,
} from 'lucide-react'
import NodeInfoButton from '../NodeInfoButton'
import PresetMenu from './PresetMenu'
import { NodeCategory } from '@/lib/types/nodes'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import {
  registerRunHandler, unregisterRunHandler,
} from '@/lib/flow/runRegistry'
import { propagateFromNode } from '@/lib/flow/propagate'

const PRESETTABLE_TYPES = new Set([
  'textToImageNode', 'imageToImageNode', 'textToVideoNode',
  'imageToVideoNode', 'characterBoardNode', 'locationBoardNode',
  'productBoardNode', 'bRollBoardNode', 'storyboardNode',
  'mascotBoardNode', 'creatureBoardNode',
])

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface ImageFirstNodeProps {
  id?: string
  title: string
  category: NodeCategory
  simpleExplanation: string
  inputs?: Array<{ id: string; label: string; type?: string }>
  outputs?: Array<{ id: string; label: string; type?: string }>
  selected?: boolean
  hasRunButton?: boolean
  onRun?: () => Promise<void>
  status?: RunStatus

  // The hero output that fills the card.
  outputUrl?: string
  outputKind?: 'image' | 'video' | 'mesh'

  // When outputKind === 'mesh' and the actual GLB lives separately from
  // outputUrl (because outputUrl holds a 2D snapshot for downstream image
  // consumers), pass the GLB here. model-viewer renders meshUrl; outputUrl
  // is what gets flowed to image inputs downstream.
  meshUrl?: string
  // Fired after a GLB loads and ImageFirstNode auto-captures a 2D
  // snapshot. Parent persists the dataUrl as outputUrl so downstream
  // image nodes have a real image to consume.
  onMeshSnapshot?: (dataUrl: string) => void

  // When set, renders inside the media frame INSTEAD of the empty-state
  // Run button (suitable for nodes that need an interactive canvas as
  // their "hero" — e.g. Compositor's layer editor). The Run button
  // moves to the bottom-right action cluster when output arrives.
  // Ignored when outputUrl/meshUrl is present.
  editorContent?: ReactNode

  // Small chips that summarise the active config — model name, size, etc.
  // Rendered along the bottom strip.
  paramPills?: Array<{ label: string; tone?: 'default' | 'accent' }>

  // The drawer content. Typically the model picker, prompt textarea,
  // negative prompt area, advanced params. Same children that BaseNode
  // would otherwise render in its body.
  children?: ReactNode
}

const CATEGORY_VAR: Record<string, string> = {
  text: 'var(--cat-text)', image: 'var(--cat-image)', video: 'var(--cat-video)',
  edit: 'var(--cat-edit)', mask: 'var(--cat-mask)', helper: 'var(--cat-helper)',
  output: 'var(--cat-output)',
}

const HANDLE_VAR: Record<string, string> = {
  text: 'var(--cat-text)', image: 'var(--cat-image)', video: 'var(--cat-video)',
  mask: 'var(--cat-mask)', audio: 'var(--cat-edit)', any: 'var(--cat-helper)',
}

const CATEGORY_HEX: Record<string, string> = {
  text: '#B94EFF', image: '#00E5FF', video: '#FF2D87', edit: '#2E92FF',
  mask: '#39FF14', helper: '#FFB400', output: '#FFEA00',
}

// Shared talkback name chip — single-click copies, double-click renames.
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
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') { setDraft(displayName); setEditing(false) } }}
        onBlur={submit} onClick={e => e.stopPropagation()}
        className="text-[9.5px] uppercase tracking-[0.08em] bg-transparent outline-none border-b nodrag"
        style={{ color: 'var(--ink-soft)', fontFamily: 'var(--font-mono), JetBrains Mono, monospace', borderColor: 'var(--accent)', width: 80 }} />
    )
  }
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); try { navigator.clipboard?.writeText(displayName) } catch {} }}
      onDoubleClick={e => { e.stopPropagation(); if (demoMode) return; setEditing(true) }}
      className="text-[9.5px] uppercase tracking-[0.08em] truncate text-left nodrag hover:opacity-100 transition-opacity"
      style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono), JetBrains Mono, monospace', opacity: 0.7, maxWidth: 90 }}
      title={`${displayName} — click to copy, double-click to rename`}>
      {displayName}
    </button>
  )
}

export default function ImageFirstNode({
  id, title, category, simpleExplanation,
  inputs = [], outputs = [],
  selected, hasRunButton = false, onRun, status = 'idle',
  outputUrl, outputKind = 'image',
  meshUrl, onMeshSnapshot,
  editorContent,
  paramPills = [], children,
}: ImageFirstNodeProps) {
  const color = CATEGORY_VAR[category]
  const colorHex = CATEGORY_HEX[category]
  const [hovered, setHovered] = useState(false)
  // For mesh nodes, the GLB IS the output even when outputUrl is still
  // empty (the 2D snapshot lands a moment after the GLB loads). Treat
  // either as "has output" so the empty state hides immediately on run.
  const hasOutput = Boolean(outputUrl || meshUrl)
  const [drawerOpen, setDrawerOpen] = useState(!hasOutput)
  const [localStatus, setLocalStatus] = useState<RunStatus>(status)
  const deleteNode = useWorkflowStore(s => s.deleteNode)
  const demoMode = useWorkflowStore(s => s.demoMode)
  const openLightbox = useWorkflowStore(s => s.openLightbox)
  const isBridgePulsing = useWorkflowStore(s => id ? s.pulsingNodeIds.includes(id) : false)
  const isWorking = isBridgePulsing || localStatus === 'running'
  const rf = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const lastError = useWorkflowStore(s => {
    if (!id) return ''
    const node = s.nodes.find(n => n.id === id)
    return (node?.data?.lastError as string) || ''
  })

  // Auto-collapse the drawer once an output arrives; if user re-opens
  // manually, respect that until they collapse again.
  const prevHadOutputRef = useRef(hasOutput)
  useEffect(() => {
    if (!prevHadOutputRef.current && hasOutput) setDrawerOpen(false)
    prevHadOutputRef.current = hasOutput
  }, [hasOutput])

  // Snapshot capture for mesh kind: after the GLB loads, ask
  // model-viewer for a 2D dataUrl and bubble it up so the parent can
  // persist as outputUrl (so downstream image consumers have a real
  // image, not a .glb URL the browser can't render).
  const meshElRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (outputKind !== 'mesh' || !meshUrl || !onMeshSnapshot) return
    const el = meshElRef.current
    if (!el) return
    let cancelled = false
    const handler = async () => {
      if (cancelled) return
      try {
        // model-viewer exposes toDataURL() (sync, returns PNG dataUrl).
        // 2 frames after load gives the auto-rotate a moment to settle.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        const dataUrl = (el as unknown as { toDataURL?: (mime?: string) => string }).toDataURL?.('image/png')
        if (dataUrl) onMeshSnapshot(dataUrl)
      } catch (e) {
        console.warn('[ImageFirstNode] mesh snapshot failed:', e)
      }
    }
    el.addEventListener('load', handler)
    return () => { cancelled = true; el.removeEventListener('load', handler) }
  }, [meshUrl, outputKind, onMeshSnapshot])

  // Re-measure handle positions after pop-in animation finishes.
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

  // ResizeObserver — catches every layout shift.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || !id) return
    const observer = new ResizeObserver(() => updateNodeInternals(id))
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, updateNodeInternals])

  useEffect(() => {
    if (!id) return
    updateNodeInternals(id)
    const raf = requestAnimationFrame(() => updateNodeInternals(id))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, drawerOpen, inputs.length, outputs.length])

  const resolveId = (): string | undefined => {
    if (id) return id
    const sel = rf.getNodes().find(n => n.selected)
    return sel?.id
  }

  // Latest onRun closure — see BaseNode for the same rationale.
  const onRunRef = useRef(onRun)
  useEffect(() => { onRunRef.current = onRun }, [onRun])

  const handleRun = async () => {
    if (localStatus === 'running') return
    {
      const s = useWorkflowStore.getState()
      let nodes = s.nodes
      for (const n of nodes) nodes = propagateFromNode(nodes, s.edges, n.id)
      if (nodes !== s.nodes) {
        useWorkflowStore.setState({ nodes })
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

  // For mesh nodes, download the .glb (meshUrl), not the snapshot.
  const downloadTarget = outputKind === 'mesh' ? (meshUrl ?? outputUrl) : outputUrl
  const handleDownload = async () => {
    if (!downloadTarget) return
    try {
      const r = await fetch(downloadTarget)
      const blob = await r.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}.${
        outputKind === 'video' ? 'mp4' : outputKind === 'mesh' ? 'glb' : 'png'
      }`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (e) { console.error('download failed', e) }
  }
  const handleCopy = async () => {
    const target = downloadTarget
    if (!target) return
    try { await navigator.clipboard.writeText(target) } catch {}
  }

  const chrome = hovered || selected || !hasOutput

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`relative rounded-3xl ${selected ? 'node-selected-glow' : ''} ${isWorking ? 'node-pulsing' : ''}`}
      style={{
        background: 'var(--bg-surface)',
        boxShadow: selected ? undefined : 'var(--shadow-clay)',
        ['--node-accent' as string]: colorHex,
        width: 320,
      }}
    >
      {/* Top chrome chip — title only. Chrome buttons are icon-sized, hover-only.
          DisplayName chip moves below the title as a subtle subtitle so it
          doesn't compete with the title or the chrome cluster for width. */}
      <div className="flex items-start justify-between px-3.5 pt-2 pb-1.5 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: color, boxShadow: `0 0 0 3px ${colorHex}22` }} />
          <div className="flex flex-col min-w-0">
            <span className="text-[var(--ink)] text-[12px] font-medium tracking-tight truncate leading-tight">{title}</span>
            {id && <DisplayNameChip nodeId={id} />}
          </div>
        </div>
        <div className={`flex items-center gap-0.5 transition-opacity flex-shrink-0 ${chrome ? 'opacity-100' : 'opacity-0'}`}>
          <NodeInfoButton title={title} simpleExplanation={simpleExplanation}
            inputs={inputs.map(i => i.label)} outputs={outputs.map(o => o.label)} />
          {!demoMode && (
            <button
              className="w-6 h-6 rounded-full flex items-center justify-center nodrag text-[var(--ink-mute)] hover:text-[var(--cat-video)] hover:bg-[var(--cat-video)]/10 transition-colors"
              onClick={() => { const nid = resolveId(); if (nid) deleteNode(nid) }}
              title="Delete node"
            ><X size={11} /></button>
          )}
        </div>
      </div>

      {/* Media body — full-bleed inside a rounded inset frame. */}
      <div className="px-3 pb-2 relative">
        <div
          className="rounded-2xl overflow-hidden relative clay-surface-soft"
          style={{ aspectRatio: '4 / 3', background: 'var(--bg-canvas)' }}
        >
          {hasOutput ? (
            outputKind === 'video' ? (
              <video src={outputUrl} controls className="w-full h-full object-contain" />
            ) : outputKind === 'mesh' ? (
              // Mesh: prefer meshUrl (the GLB) for the viewer. outputUrl
              // is the 2D snapshot once captured — it doubles as a poster
              // until the GLB streams in, so model-viewer never renders
              // a black void during load.
              (() => {
                const src = meshUrl ?? outputUrl
                if (!src) return null
                return /\.(glb|gltf|usdz)(\?|$)/i.test(src) ? (
                  // Wrap in a nodrag DIV — React doesn't reliably put the
                  // `class` attribute on a custom element, so React Flow
                  // never sees nodrag on <model-viewer> itself and pans the
                  // whole card. The wrapper is a plain div that DOES carry
                  // nodrag, so orbit works (same pattern as the Output node).
                  <div className="w-full h-full nodrag">
                    {/* @ts-expect-error model-viewer is a custom element loaded by CDN */}
                    <model-viewer
                      ref={(el: HTMLElement | null) => { meshElRef.current = el }}
                      src={src}
                      alt="Generated 3D model"
                      camera-controls
                      auto-rotate
                      poster={outputUrl && outputUrl !== src ? outputUrl : undefined}
                      style={{ width: '100%', height: '100%', background: 'transparent' }}
                    />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="3D preview" className="w-full h-full object-cover" />
                )
              })()
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={outputUrl} alt="output" className="w-full h-full object-cover" />
            )
          ) : editorContent ? (
            // Interactive editor mode (Compositor's drag/resize canvas).
            // The Run button moves to the bottom-right cluster below so
            // the editor uses the full media frame.
            <div className="w-full h-full nodrag">{editorContent}</div>
          ) : (
            // Empty state — the center disc IS the run button. Single primary
            // CTA, no double-play confusion with a floating action column.
            <div className="w-full h-full flex flex-col items-center justify-center gap-2.5">
              <button
                onClick={handleRun}
                disabled={!hasRunButton || isWorking || demoMode}
                className="w-12 h-12 rounded-full clay-press flex items-center justify-center nodrag transition-transform"
                style={{
                  background: hasRunButton && !demoMode ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: hasRunButton && !demoMode ? 'var(--bg-surface)' : 'var(--ink-faint)',
                  boxShadow: hasRunButton && !demoMode ? '0 4px 14px rgba(234,88,12,0.35)' : 'none',
                  border: hasRunButton && !demoMode ? 'none' : '1px solid var(--line)',
                }}
                title={hasRunButton ? 'Run' : 'No run handler'}
              >
                {isWorking
                  ? <Loader2 size={16} className="animate-spin" />
                  : <Play size={15} style={{ marginLeft: 2 }} />}
              </button>
              <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-faint)' }}>
                {isWorking ? 'Generating' : hasRunButton ? 'Tap to run' : 'No output yet'}
              </span>
            </div>
          )}

          {/* Lightbox trigger — top right of the media frame, hover only. */}
          {hasOutput && hovered && (
            <button
              onClick={e => { e.stopPropagation(); openLightbox(outputKind === 'mesh' ? '3d' : outputKind, meshUrl ?? outputUrl ?? '') }}
              className="absolute top-2 right-2 w-7 h-7 rounded-full nodrag flex items-center justify-center transition-opacity"
              style={{ background: 'rgba(0,0,0,0.55)', color: 'white' }}
              title="Expand"
            ><Maximize2 size={12} /></button>
          )}

          {/* Status badge — top-left of media. Always shows while non-idle. */}
          {localStatus !== 'idle' && (
            <div
              className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-medium uppercase tracking-[0.12em] flex items-center gap-1"
              style={{
                background:
                  localStatus === 'done' ? 'color-mix(in srgb, var(--cat-image) 90%, transparent)' :
                  localStatus === 'error' ? 'color-mix(in srgb, var(--cat-video) 90%, transparent)' :
                  'rgba(0,0,0,0.55)',
                color: 'white',
              }}
            >
              {localStatus === 'running' && <Loader2 size={9} className="animate-spin" />}
              {localStatus === 'done' && <CheckCircle size={9} />}
              {localStatus === 'error' && <AlertCircle size={9} />}
              {localStatus}
            </div>
          )}
        </div>

        {/* Bottom-right action cluster on the MEDIA. Visible when:
              - There's output AND user hovers (Run/Download/Copy)
              - Editor mode is active (Run is the primary CTA, always shown)
            Lives INSIDE the media frame so it never collides with edge handles. */}
        {!demoMode && ((hasOutput && hovered) || (editorContent && !hasOutput)) && (
          <div
            className="absolute bottom-2 right-2 flex items-center gap-1 px-1 py-1 rounded-full transition-opacity"
            style={{
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              zIndex: 5,
            }}
          >
            {hasRunButton && (
              <button onClick={handleRun} disabled={isWorking}
                className="w-7 h-7 rounded-full flex items-center justify-center nodrag"
                style={{ background: 'var(--accent)', color: 'var(--bg-surface)' }}
                title={hasOutput ? 'Run again' : 'Run'}>
                {isWorking ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} style={{ marginLeft: 1 }} />}
              </button>
            )}
            {hasOutput && (
              <>
                <button onClick={handleDownload}
                  className="w-7 h-7 rounded-full flex items-center justify-center nodrag text-white hover:bg-white/10"
                  title="Download"><Download size={12} /></button>
                <button onClick={handleCopy}
                  className="w-7 h-7 rounded-full flex items-center justify-center nodrag text-white hover:bg-white/10"
                  title="Copy URL"><Copy size={12} /></button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Param pills strip — model + active params. */}
      {paramPills.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap items-center gap-1 nodrag">
          {paramPills.map((pill, i) => (
            <span key={i}
              className="px-2 py-0.5 rounded-full text-[9.5px] font-medium uppercase tracking-[0.08em] truncate"
              style={{
                background: pill.tone === 'accent' ? 'var(--accent)' : 'var(--bg-canvas)',
                color: pill.tone === 'accent' ? 'var(--bg-surface)' : 'var(--ink-soft)',
                border: pill.tone === 'accent' ? 'none' : '1px solid var(--line)',
                maxWidth: 140,
              }}
            >{pill.label}</span>
          ))}
        </div>
      )}

      {/* Error surface. */}
      {lastError && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-[10.5px] leading-relaxed"
          style={{
            background: 'color-mix(in srgb, var(--cat-video) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--cat-video) 35%, transparent)',
            color: 'var(--cat-video)',
          }} title={lastError}>
          <span className="font-medium uppercase tracking-[0.1em] text-[9px] opacity-80 block mb-0.5">Run failed</span>
          <span className="break-words">{lastError.length > 220 ? lastError.slice(0, 220) + '…' : lastError}</span>
        </div>
      )}

      {/* Drawer — controls + prompt. Preset menu lives on the toggle row
          so it stays accessible without crowding the top chrome chip. */}
      {children && (
        <div className="border-t border-[var(--line-soft)]">
          {hasOutput && (
            <div className="w-full px-3 py-1.5 flex items-center justify-between nodrag">
              <button
                onClick={() => setDrawerOpen(o => !o)}
                className="flex items-center gap-1 text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors"
              >
                <span className="text-[10px] uppercase tracking-[0.14em] font-medium">
                  {drawerOpen ? 'Hide controls' : 'Edit prompt + controls'}
                </span>
                {drawerOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {(() => {
                if (demoMode) return null
                const rfNode = id ? rf.getNode(id) : undefined
                const nodeType = rfNode?.type
                if (!id || !nodeType || !PRESETTABLE_TYPES.has(nodeType)) return null
                const nodeData = (rfNode.data ?? {}) as Record<string, unknown>
                return <PresetMenu nodeId={id} nodeType={nodeType} data={nodeData} />
              })()}
            </div>
          )}
          {drawerOpen && (
            <div className="px-3 pb-3 pt-1 space-y-2.5">
              {!hasOutput && (() => {
                // When no output yet, the toggle bar is hidden, so surface
                // PresetMenu in the drawer head instead.
                if (demoMode) return null
                const rfNode = id ? rf.getNode(id) : undefined
                const nodeType = rfNode?.type
                if (!id || !nodeType || !PRESETTABLE_TYPES.has(nodeType)) return null
                const nodeData = (rfNode.data ?? {}) as Record<string, unknown>
                return (
                  <div className="flex justify-end -mt-0.5 mb-0.5">
                    <PresetMenu nodeId={id} nodeType={nodeType} data={nodeData} />
                  </div>
                )
              })()}
              {children}
            </div>
          )}
        </div>
      )}

      {/* Handles — anchored to the MEDIA frame so they never overlap the
          top chrome row. Each handle gets a circular "notch" of canvas
          color behind it so the dot reads as recessed into the card
          edge, with the colored bullet floating cleanly in the middle.
          Labels render OUTSIDE the card edge and only on selected. */}
      {inputs.length > 0 && (
        <div className="absolute left-0 pointer-events-none" style={{ width: 0, top: 56, height: 240 }}>
          {inputs.map((input, i) => {
            const stride = 240 / (inputs.length + 1)
            const top = `${Math.round(stride * (i + 1))}px`
            const dotColor = HANDLE_VAR[input.type || 'any'] || 'var(--ink-mute)'
            return (
              <div key={input.id} className="absolute" style={{ top, left: 0 }}>
                {/* Notch — canvas-colored circle punched through the card edge. */}
                <div
                  aria-hidden
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    left: -13, top: '50%', width: 26, height: 26,
                    transform: 'translateY(-50%)',
                    background: 'var(--bg-canvas)',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.10)',
                  }}
                />
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.id}
                  className=""
                  style={{
                    background: dotColor,
                    width: 11, height: 11, border: 'none',
                    boxShadow: `0 0 0 1px color-mix(in srgb, ${dotColor} 55%, transparent), 0 0 10px color-mix(in srgb, ${dotColor} 40%, transparent)`,
                    zIndex: 2,
                  }}
                  title={input.label}
                />
                {selected && (
                  <span
                    className="absolute pointer-events-none text-[8.5px] uppercase tracking-[0.08em] whitespace-nowrap text-right"
                    style={{
                      right: 16, top: -6,
                      color: 'var(--ink-faint)',
                      background: 'color-mix(in srgb, var(--bg-canvas) 85%, transparent)',
                      padding: '1px 5px', borderRadius: 4,
                    }}
                  >{input.label}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {outputs.length > 0 && (
        <div className="absolute right-0 pointer-events-none" style={{ width: 0, top: 56, height: 240 }}>
          {outputs.map((output, i) => {
            const stride = 240 / (outputs.length + 1)
            const top = `${Math.round(stride * (i + 1))}px`
            const dotColor = HANDLE_VAR[output.type || 'any'] || 'var(--ink-mute)'
            return (
              <div key={output.id} className="absolute" style={{ top, right: 0 }}>
                <div
                  aria-hidden
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    right: -13, top: '50%', width: 26, height: 26,
                    transform: 'translateY(-50%)',
                    background: 'var(--bg-canvas)',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.10)',
                  }}
                />
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.id}
                  className=""
                  style={{
                    background: dotColor,
                    width: 11, height: 11, border: 'none',
                    boxShadow: `0 0 0 1px color-mix(in srgb, ${dotColor} 55%, transparent), 0 0 10px color-mix(in srgb, ${dotColor} 40%, transparent)`,
                    zIndex: 2,
                  }}
                  title={output.label}
                />
                {selected && (
                  <span
                    className="absolute pointer-events-none text-[8.5px] uppercase tracking-[0.08em] whitespace-nowrap"
                    style={{
                      left: 16, top: -6,
                      color: 'var(--ink-faint)',
                      background: 'color-mix(in srgb, var(--bg-canvas) 85%, transparent)',
                      padding: '1px 5px', borderRadius: 4,
                    }}
                  >{output.label}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
