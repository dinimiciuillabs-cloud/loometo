'use client'
import { useEffect, useRef, useState } from 'react'
import { Brush, Eraser, RotateCcw, Trash2 } from 'lucide-react'

interface Stroke {
  points: Array<{ x: number; y: number }>
  size: number
  erase: boolean
}

interface PainterCanvasProps {
  // Input image — painted as backdrop, NOT included in the mask.
  backgroundUrl?: string
  // Canvas dimensions (kept small so the node stays compact).
  width?: number
  height?: number
  // Fires whenever strokes change. We emit two outputs:
  //  mask  — white strokes on transparent background (consumed by Inpaint etc.)
  //  composite — backdrop + strokes (consumed as a regular image)
  onChange?: (mask: string, composite: string) => void
}

// Brush-based painter — strokes are stored as point arrays so undo + clear
// stay cheap and we can re-render the mask at any time.
export default function PainterCanvas({
  backgroundUrl,
  width = 256,
  height = 192,
  onChange,
}: PainterCanvasProps) {
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null)
  const [brushSize, setBrushSize] = useState(18)
  const [erasing, setErasing] = useState(false)
  const bgImageRef = useRef<HTMLImageElement | null>(null)

  // Load backdrop image into a hidden image element so we can repaint on demand.
  useEffect(() => {
    if (!backgroundUrl) {
      bgImageRef.current = null
      redraw(strokes)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { bgImageRef.current = img; redraw(strokes) }
    img.onerror = () => { bgImageRef.current = null; redraw(strokes) }
    img.src = backgroundUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundUrl])

  // Render mask + composite from the current stroke list. Called after every
  // stroke completion and after clear/undo.
  const redraw = (currentStrokes: Stroke[]) => {
    const mask = maskCanvasRef.current
    const composite = compositeCanvasRef.current
    if (!mask || !composite) return
    const mctx = mask.getContext('2d')
    const cctx = composite.getContext('2d')
    if (!mctx || !cctx) return

    // ── Mask layer ── (white strokes on transparent background)
    mctx.clearRect(0, 0, width, height)
    mctx.lineCap = 'round'
    mctx.lineJoin = 'round'
    mctx.strokeStyle = 'white'
    for (const s of currentStrokes) {
      if (s.erase) {
        mctx.globalCompositeOperation = 'destination-out'
        mctx.strokeStyle = 'rgba(0,0,0,1)'
      } else {
        mctx.globalCompositeOperation = 'source-over'
        mctx.strokeStyle = 'white'
      }
      drawPath(mctx, s)
    }

    // ── Composite layer ── (backdrop + strokes overlaid)
    cctx.clearRect(0, 0, width, height)
    if (bgImageRef.current) {
      cctx.drawImage(bgImageRef.current, 0, 0, width, height)
    } else {
      cctx.fillStyle = 'rgba(0,0,0,0)'
      cctx.fillRect(0, 0, width, height)
    }
    cctx.globalAlpha = 0.65
    for (const s of currentStrokes) {
      if (s.erase) {
        cctx.globalCompositeOperation = 'destination-out'
        cctx.strokeStyle = 'rgba(0,0,0,1)'
      } else {
        cctx.globalCompositeOperation = 'source-over'
        cctx.strokeStyle = '#FFFFFF'
      }
      drawPath(cctx, s)
    }
    cctx.globalAlpha = 1

    // Emit data URLs
    onChange?.(mask.toDataURL('image/png'), composite.toDataURL('image/png'))
  }

  const drawPath = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    if (s.points.length === 0) return
    ctx.lineWidth = s.size
    ctx.beginPath()
    const [first, ...rest] = s.points
    ctx.moveTo(first.x, first.y)
    if (rest.length === 0) {
      // Single tap — draw a dot.
      ctx.lineTo(first.x + 0.01, first.y + 0.01)
    }
    for (const p of rest) ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  // Pointer handling
  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerPos(e)
    setActiveStroke({ points: [p], size: brushSize, erase: erasing })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeStroke) return
    const p = pointerPos(e)
    const next = { ...activeStroke, points: [...activeStroke.points, p] }
    setActiveStroke(next)
    // Live-redraw with the in-progress stroke appended
    redraw([...strokes, next])
  }

  const onPointerUp = () => {
    if (!activeStroke) return
    const nextStrokes = [...strokes, activeStroke]
    setStrokes(nextStrokes)
    setActiveStroke(null)
    redraw(nextStrokes)
  }

  const handleUndo = () => {
    if (strokes.length === 0) return
    const next = strokes.slice(0, -1)
    setStrokes(next)
    redraw(next)
  }

  const handleClear = () => {
    setStrokes([])
    redraw([])
  }

  const toolBtn = (active: boolean) => ({
    width: 28, height: 28, borderRadius: 9999,
    background: active ? 'var(--accent)' : 'var(--bg-surface)',
    color: active ? 'var(--bg-surface)' : 'var(--ink-soft)',
    boxShadow: active ? 'var(--shadow-clay-pressed)' : 'var(--shadow-clay-soft)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', border: 'none', flexShrink: 0,
  } as React.CSSProperties)

  return (
    <div className="space-y-2 nodrag">
      {/* The visible canvas — we render the composite layer for the user. */}
      <div
        className="rounded-2xl overflow-hidden clay-surface-soft relative"
        style={{ background: 'var(--bg-elevated)', width: '100%', aspectRatio: `${width} / ${height}` }}
      >
        <canvas
          ref={compositeCanvasRef}
          width={width}
          height={height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
          className="block w-full h-full"
          style={{ cursor: erasing ? 'cell' : 'crosshair', touchAction: 'none' }}
        />
        {/* Hidden mask canvas — never displayed, just used to render the
            black/white PNG output. */}
        <canvas
          ref={maskCanvasRef}
          width={width}
          height={height}
          style={{ display: 'none' }}
        />
        {strokes.length === 0 && !activeStroke && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[var(--ink-faint)] text-[10.5px]">
              {backgroundUrl ? 'paint on the image' : 'paint the mask'}
            </span>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1.5">
        <button onClick={() => setErasing(false)} style={toolBtn(!erasing)} title="Brush">
          <Brush size={12} />
        </button>
        <button onClick={() => setErasing(true)} style={toolBtn(erasing)} title="Eraser">
          <Eraser size={12} />
        </button>
        <div className="flex-1 flex items-center gap-2 px-2.5 py-1 rounded-full clay-surface-soft" style={{ background: 'var(--bg-elevated)' }}>
          <span className="text-[9.5px] text-[var(--ink-mute)] uppercase tracking-wider">size</span>
          <input
            type="range"
            min={4}
            max={56}
            value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            className="flex-1 h-1"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="text-[10px] text-[var(--ink-soft)] w-5 text-right">{brushSize}</span>
        </div>
        <button onClick={handleUndo} disabled={strokes.length === 0} style={{ ...toolBtn(false), opacity: strokes.length === 0 ? 0.4 : 1 }} title="Undo last stroke">
          <RotateCcw size={12} />
        </button>
        <button onClick={handleClear} disabled={strokes.length === 0} style={{ ...toolBtn(false), opacity: strokes.length === 0 ? 0.4 : 1 }} title="Clear all">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}
