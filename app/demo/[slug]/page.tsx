// /demo/[slug] — public, read-only, iframe-embeddable AiFlow showcase.
//
// Loads a pre-built workflow JSON from /public/demos/<slug>.json, sets
// the store's demoMode flag, hides every editing affordance, and shows
// a corner "Try the live app" CTA. Designed to be iframed from the
// marketing site.
//
// No auth needed. No API key panel. No sidebar. No top nav. No run
// buttons. Visitors can pan, zoom, click nodes to inspect them, open
// the lightbox on generated assets — and nothing else.

'use client'

import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useParams } from 'next/navigation'
import FlowCanvas from '@/components/FlowCanvas'
import Lightbox from '@/components/Lightbox'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import type { Node, Edge } from '@xyflow/react'

interface DemoPayload {
  name?: string                       // display name for the corner caption
  description?: string                // one-liner under the name
  nodes: Node[]
  edges: Edge[]
  // Optional: the canonical CTA URL (defaults to the app root).
  ctaUrl?: string
  ctaLabel?: string
}

export default function DemoPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const setNodes = useWorkflowStore(s => s.setNodes)
  const setEdges = useWorkflowStore(s => s.setEdges)
  const setDemoMode = useWorkflowStore(s => s.setDemoMode)
  const [payload, setPayload] = useState<DemoPayload | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    // Demo mode ON on mount, OFF on unmount — so navigating into and
    // out of the demo route never leaves the editor in read-only.
    setDemoMode(true)
    // Force-lock dark theme for the demo regardless of what the editor's
    // theme is set to. The marketing site embeds expect a consistent
    // look. Restore prior state on unmount so navigating back to the
    // editor doesn't change the user's theme preference.
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    root.classList.add('dark')
    return () => {
      setDemoMode(false)
      if (!hadDark) root.classList.remove('dark')
    }
  }, [setDemoMode])

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    fetch(`/demos/${slug}.json`)
      .then(r => {
        if (!r.ok) throw new Error(`Demo not found (${r.status})`)
        return r.json()
      })
      .then((data: DemoPayload) => {
        if (cancelled) return
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error('Malformed demo payload')
        }
        setPayload(data)
        setNodes(data.nodes)
        setEdges(data.edges)
      })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [slug, setNodes, setEdges])

  return (
    <ReactFlowProvider>
      <div
        className="relative w-screen h-screen overflow-hidden"
        style={{ background: 'var(--bg-canvas)' }}
      >
        <FlowCanvas />
        <Lightbox />

        {/* Top-left caption — wordmark anchors the brand, workflow info below */}
        {payload && (
          <div
            className="absolute top-5 left-5 px-5 py-4 rounded-2xl pointer-events-none select-none"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 86%, transparent)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--line)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)',
              maxWidth: 360,
            }}
          >
            <div
              role="img"
              aria-label="Loometo"
              style={{
                width: 150,
                height: 36,
                backgroundImage: 'url(/brand/loometo-wordmark.png)',
                backgroundSize: 'contain',
                backgroundPosition: 'left center',
                backgroundRepeat: 'no-repeat',
                marginLeft: -8,
              }}
            />
            <div className="flex items-center gap-2 mt-1 mb-2.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)' }}
              />
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.22em]"
                style={{ color: 'var(--accent)' }}
              >
                Live demo
              </span>
            </div>
            {payload.name && (
              <div className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>
                {payload.name}
              </div>
            )}
            {payload.description && (
              <div className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--ink-soft)' }}>
                {payload.description}
              </div>
            )}
          </div>
        )}

        {/* Bottom-right CTA — clean label + arrow. Icon dropped because the
            dark-on-dark Loometo mark doesn't read on the orange accent. */}
        <a
          href={payload?.ctaUrl ?? '/'}
          target="_top"
          rel="noopener"
          className="absolute bottom-6 right-6 inline-flex items-center gap-2 px-5 py-3 rounded-full font-medium text-[13px] transition-transform hover:scale-[1.02]"
          style={{
            background: 'var(--accent)',
            color: 'var(--bg-surface)',
            boxShadow: '0 4px 16px rgba(234,88,12,0.4), 0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          {payload?.ctaLabel ?? 'Try the live app'}
          <span aria-hidden style={{ fontSize: 14 }}>→</span>
        </a>

        {/* Bottom-left watermark — single accent dot + label, no icon. */}
        <div
          className="absolute bottom-5 left-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] pointer-events-none select-none"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 78%, transparent)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'var(--ink-faint)',
            border: '1px solid var(--line)',
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--ink-mute)' }}
          />
          Read-only preview
        </div>

        {/* Error overlay */}
        {error && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div
              className="px-6 py-5 rounded-2xl text-center max-w-md pointer-events-auto"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--line)',
                boxShadow: 'var(--shadow-clay, 0 8px 24px rgba(0,0,0,0.08))',
              }}
            >
              <div
                className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2"
                style={{ color: 'var(--cat-video)' }}
              >
                Could not load demo
              </div>
              <div className="text-[13px]" style={{ color: 'var(--ink)' }}>
                {error}
              </div>
              <div className="text-[11px] mt-2" style={{ color: 'var(--ink-faint)' }}>
                Slug: <code>{slug}</code>
              </div>
            </div>
          </div>
        )}
      </div>
    </ReactFlowProvider>
  )
}
