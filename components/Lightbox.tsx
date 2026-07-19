'use client'
// Shared full-screen viewer for image / video / 3D model previews. Any
// node's preview can open it via useWorkflowStore().openLightbox(kind, url).
// Closes on backdrop click, X button, or Escape key.

import { useEffect } from 'react'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { Download, X } from 'lucide-react'

export default function Lightbox() {
  const lightbox = useWorkflowStore(s => s.lightbox)
  const closeLightbox = useWorkflowStore(s => s.closeLightbox)

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox, closeLightbox])

  if (!lightbox) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
      style={{
        // Heavy backdrop blur + dark wash so the canvas behind is muted
        // but the asset reads as the focal point.
        background: 'rgba(8, 8, 14, 0.78)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      }}
      onClick={closeLightbox}
    >
      {/* Top-right controls — sit outside the content frame so they never
          overlap the asset. */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <a
          href={lightbox.url}
          download
          onClick={e => e.stopPropagation()}
          className="w-10 h-10 rounded-full flex items-center justify-center clay-surface-soft transition-colors hover:brightness-110"
          style={{ background: 'var(--bg-surface)' }}
          title="Download"
        >
          <Download size={15} className="text-[var(--ink)]" />
        </a>
        <button
          onClick={closeLightbox}
          className="w-10 h-10 rounded-full flex items-center justify-center clay-surface-soft transition-colors hover:brightness-110"
          style={{ background: 'var(--bg-surface)' }}
          title="Close (Esc)"
        >
          <X size={16} className="text-[var(--ink)]" />
        </button>
      </div>

      {/* Asset container — stops backdrop-click bubbling so clicking
          the asset itself doesn't close the lightbox. */}
      <div
        className="relative max-w-[92vw] max-h-[88vh] flex items-center justify-center"
        onClick={e => e.stopPropagation()}
      >
        {lightbox.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lightbox.url}
            alt="Enlarged view"
            className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl"
            style={{ boxShadow: 'var(--shadow-clay)' }}
          />
        )}
        {lightbox.kind === 'video' && (
          <video
            src={lightbox.url}
            controls
            autoPlay
            className="max-w-[92vw] max-h-[88vh] rounded-xl"
            style={{ boxShadow: 'var(--shadow-clay)' }}
          />
        )}
        {lightbox.kind === '3d' && (
          // @ts-expect-error model-viewer is a Web Component imported globally
          <model-viewer
            src={lightbox.url}
            poster={lightbox.thumbnailUrl}
            camera-controls
            auto-rotate
            shadow-intensity="1"
            exposure="1"
            style={{
              width: '80vw',
              height: '80vh',
              background: 'var(--bg-canvas)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-clay)',
            }}
          />
        )}
      </div>
    </div>
  )
}
