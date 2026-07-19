'use client'
// Drag-and-resize layer editor for the Compositor node. The polaroid IS
// the composition surface — scene image as backdrop, subjects as draggable
// images stacked on top. Each subject has independent position + scale.
//
// Coordinate system: positions and sizes are stored as percentages of the
// frame so they survive resizes without distortion. The frame itself is
// whatever ImageFirstNode's media body gives us (4:3 by default).
//
// Output rendering happens in flattenLayers() — called by the parent on
// Run. Uses an offscreen canvas at scene resolution (or 1024 fallback) so
// the AI edit model gets a real image to consume.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react'

export interface Layer {
  // 0..1, top-left anchored. 0.5/0.5 = top-left of layer at frame center.
  x: number
  y: number
  // 0..1, fraction of frame width. Height is derived from the image's
  // natural aspect ratio so we don't squish.
  scale: number
  url: string
}

interface Props {
  sceneUrl?: string
  layers: Layer[]
  onChange: (next: Layer[]) => void
  selected: number | null
  onSelect: (idx: number | null) => void
}

export default function CompositorCanvas({
  sceneUrl, layers, onChange, selected, onSelect,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  // Track natural image dimensions so we can keep aspect ratio while
  // dragging the resize handle.
  const naturalRef = useRef<Map<string, { w: number; h: number }>>(new Map())
  const [, forceRender] = useState(0)

  const onImgLoad = useCallback((url: string, w: number, h: number) => {
    naturalRef.current.set(url, { w, h })
    forceRender(n => n + 1)
  }, [])

  // ───── Drag ────────────────────────────────────────────────────────
  const startDrag = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation()
    e.preventDefault()
    onSelect(idx)
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const orig = { x: layers[idx].x, y: layers[idx].y }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / rect.width
      const dy = (ev.clientY - start.y) / rect.height
      const next = layers.map((l, i) => i === idx ? {
        ...l,
        x: Math.max(0, Math.min(1, orig.x + dx)),
        y: Math.max(0, Math.min(1, orig.y + dy)),
      } : l)
      onChange(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ───── Resize ──────────────────────────────────────────────────────
  const startResize = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation()
    e.preventDefault()
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const origScale = layers[idx].scale
    const move = (ev: PointerEvent) => {
      // Drag bottom-right corner outward = bigger; inward = smaller.
      // Map horizontal delta to scale delta as fraction of frame width.
      const dx = (ev.clientX - start.x) / rect.width
      const next = layers.map((l, i) => i === idx ? {
        ...l,
        scale: Math.max(0.05, Math.min(2, origScale + dx)),
      } : l)
      onChange(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ───── Z-order + delete ────────────────────────────────────────────
  const moveLayer = (idx: number, dir: -1 | 1) => {
    const ni = idx + dir
    if (ni < 0 || ni >= layers.length) return
    const next = [...layers]
    ;[next[idx], next[ni]] = [next[ni], next[idx]]
    onChange(next)
    onSelect(ni)
  }
  const deleteLayer = (idx: number) => {
    const next = layers.filter((_, i) => i !== idx)
    onChange(next)
    onSelect(null)
  }

  // Click on empty backdrop deselects.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onSelect(null)
  }

  // ───── Keyboard shortcuts (when a layer is selected) ───────────────
  useEffect(() => {
    if (selected === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteLayer(selected)
      }
      if (e.key === 'ArrowUp' && e.shiftKey)   { e.preventDefault(); moveLayer(selected, 1) }
      if (e.key === 'ArrowDown' && e.shiftKey) { e.preventDefault(); moveLayer(selected, -1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, layers])

  return (
    <div
      ref={frameRef}
      onClick={onBackdropClick}
      onPointerDown={onBackdropClick as unknown as React.PointerEventHandler}
      className="relative w-full h-full overflow-hidden"
      style={{
        background: sceneUrl ? 'transparent' : 'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, transparent 6px 12px)',
      }}
    >
      {sceneUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sceneUrl}
          alt="scene"
          crossOrigin="anonymous"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
      )}
      {!sceneUrl && layers.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
          <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-faint)' }}>
            Wire a SCENE + subjects to start composing
          </span>
        </div>
      )}
      {layers.map((layer, i) => {
        const isSelected = selected === i
        const nat = naturalRef.current.get(layer.url)
        // Layer width = scale * frame width; height keeps aspect ratio.
        const wPct = layer.scale * 100
        const aspect = nat ? nat.h / nat.w : 1
        return (
          <div
            key={`${i}-${layer.url}`}
            onPointerDown={(e) => startDrag(e, i)}
            className="absolute cursor-move select-none"
            style={{
              left: `${layer.x * 100}%`,
              top: `${layer.y * 100}%`,
              width: `${wPct}%`,
              aspectRatio: `1 / ${aspect}`,
              outline: isSelected ? '2px solid var(--accent)' : 'none',
              outlineOffset: 2,
              boxShadow: isSelected ? '0 4px 18px rgba(234,88,12,0.35)' : '0 2px 6px rgba(0,0,0,0.30)',
              zIndex: 10 + i,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={layer.url}
              alt={`layer ${i + 1}`}
              crossOrigin="anonymous"
              onLoad={(e) => {
                const img = e.currentTarget
                onImgLoad(layer.url, img.naturalWidth, img.naturalHeight)
              }}
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
            />
            {isSelected && (
              <>
                {/* Resize handle — bottom-right corner. */}
                <div
                  onPointerDown={(e) => startResize(e, i)}
                  className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-full cursor-nwse-resize"
                  style={{ background: 'var(--accent)', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                  title="Drag to resize"
                />
                {/* Toolbar — z-order + delete, top-right of layer. */}
                <div
                  className="absolute -top-7 right-0 flex items-center gap-0.5 px-1 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                  onPointerDown={e => e.stopPropagation()}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); moveLayer(i, -1) }}
                    disabled={i === 0}
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-30"
                    title="Send down"
                  ><ChevronDown size={11} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveLayer(i, 1) }}
                    disabled={i === layers.length - 1}
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-30"
                    title="Bring up"
                  ><ChevronUp size={11} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteLayer(i) }}
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white hover:bg-red-500/30"
                    title="Remove layer (Delete)"
                  ><Trash2 size={10} /></button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ───── Flatten layers to a single PNG dataUrl ────────────────────────
// Renders scene + each layer at its (x, y, scale) into an offscreen
// canvas. Resolution defaults to the scene's natural dimensions; falls
// back to 1024×768 (4:3) when no scene is wired. Returns a PNG dataUrl
// the parent can upload to R2.
export async function flattenLayers(opts: {
  sceneUrl?: string
  layers: Layer[]
  fallbackSize?: { w: number; h: number }
}): Promise<string> {
  const { sceneUrl, layers } = opts
  const loadImg = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${url.slice(0, 60)}`))
    img.src = url
  })
  let canvasW = opts.fallbackSize?.w ?? 1024
  let canvasH = opts.fallbackSize?.h ?? 768
  let sceneImg: HTMLImageElement | null = null
  if (sceneUrl) {
    sceneImg = await loadImg(sceneUrl)
    canvasW = sceneImg.naturalWidth
    canvasH = sceneImg.naturalHeight
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  if (sceneImg) {
    ctx.drawImage(sceneImg, 0, 0, canvasW, canvasH)
  } else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvasW, canvasH)
  }
  for (const layer of layers) {
    try {
      const img = await loadImg(layer.url)
      const w = layer.scale * canvasW
      const h = w * (img.naturalHeight / img.naturalWidth)
      ctx.drawImage(img, layer.x * canvasW, layer.y * canvasH, w, h)
    } catch (e) {
      console.warn('[flattenLayers] skipping layer (load failed):', e)
    }
  }
  return canvas.toDataURL('image/png')
}
