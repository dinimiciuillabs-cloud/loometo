'use client'
import { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import { X } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import { NODE_CATALOG, type NodeCategory } from '@/lib/types/nodes'

// Neon hex per category — wires render as a linear gradient from the
// source node's category color to the target's. Kept in this file (not
// globals.css) so the SVG <stop> elements get real hex strings rather
// than CSS variables (SVG resolves vars unreliably across browsers).
const NEON: Record<NodeCategory, string> = {
  text:   '#B94EFF',  // electric purple
  image:  '#00FF88',  // neon green
  video:  '#FF2D87',  // hot pink
  edit:   '#00E5FF',  // electric cyan
  mask:   '#39FF14',  // electric lime
  helper: '#FFB400',  // electric amber
  output: '#FFEA00',  // acid yellow
}

const TYPE_TO_CATEGORY: Record<string, NodeCategory> = (() => {
  const m: Record<string, NodeCategory> = {}
  for (const n of NODE_CATALOG) m[n.type] = n.category
  return m
})()

function categoryOf(nodeType: string | undefined): NodeCategory {
  if (!nodeType) return 'helper'
  return TYPE_TO_CATEGORY[nodeType] ?? 'helper'
}

// Custom edge with a delete control that appears at the wire's
// midpoint on hover or when selected. Cleaner than anchoring next to
// the source handle, which caused overlap with image-first node cards.
export default function AccentEdge({
  id,
  source, target,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  selected,
  markerEnd,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const deleteEdge = useWorkflowStore(s => s.deleteEdge)
  // Look up the connected nodes by id so we know which category color each
  // end of the wire should be painted with.
  const nodes = useWorkflowStore(s => s.nodes)
  const sourceCat = categoryOf(nodes.find(n => n.id === source)?.type)
  const targetCat = categoryOf(nodes.find(n => n.id === target)?.type)
  const sourceColor = NEON[sourceCat]
  const targetColor = NEON[targetCat]
  // When the source node is actively running, the pulse speeds up + brightens
  // — a visible signal that data is moving through this wire RIGHT NOW.
  const isSourcePulsing = useWorkflowStore(s => s.pulsingNodeIds.includes(source))
  // Unique id per edge so multiple wires don't share a gradient.
  const gradId = `edge-grad-${id}`
  const glowId = `edge-glow-${id}`

  const [path] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const showControls = hovered || selected
  const lit = hovered || selected

  return (
    <>
      <defs>
        {/* userSpaceOnUse + actual source/target coords makes the gradient
            line up with the wire regardless of curvature or direction. */}
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX} y1={sourceY}
          x2={targetX} y2={targetY}
        >
          <stop offset="0%" stopColor={sourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
        {/* Soft outer glow — only painted on hovered/selected wires so
            resting state stays calm. */}
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Glow layer underneath — wider, blurred, low opacity */}
      {lit && (
        <path
          d={path}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={6}
          strokeLinecap="round"
          opacity={0.35}
          filter={`url(#${glowId})`}
          pointerEvents="none"
        />
      )}
      {/* Main wire — gradient stroke */}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: lit ? 2.4 : 2,
          opacity: lit ? 1 : 0.85,
          transition: 'stroke-width 0.15s ease, opacity 0.15s ease',
        }}
      />
      {/* Flowing pulse — small bright dot travels source → target along the
          bezier so the eye reads data direction at a glance. Speeds up
          (1s vs 3s) + brightens when the source node is actively running. */}
      <circle
        r={isSourcePulsing ? 4.5 : 3.5}
        fill={targetColor}
        opacity={isSourcePulsing ? 1 : 0.8}
        pointerEvents="none"
        style={{
          filter: isSourcePulsing
            ? `drop-shadow(0 0 8px ${targetColor})`
            : `drop-shadow(0 0 4px ${targetColor})`,
        }}
      >
        <animateMotion
          dur={isSourcePulsing ? '1s' : '3s'}
          repeatCount="indefinite"
          path={path}
          rotate="auto"
        />
      </circle>
      {/* Wider invisible hit area so the user doesn't have to land on a 2px line */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        {/* Anchored at the wire's MIDPOINT — hover the wire, the delete
            button appears on the wire itself. Out of every card body's
            way, and matches the standard node-graph UX pattern. */}
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)`,
            pointerEvents: 'all',
            opacity: showControls ? 1 : 0,
            transition: 'opacity 0.15s ease',
          }}
          className="nodrag nopan"
        >
          <button
            onClick={(e) => { e.stopPropagation(); deleteEdge(id) }}
            title="Delete connection"
            style={{
              width: 22, height: 22, borderRadius: 11,
              background: 'var(--bg-surface)',
              border: '1px solid var(--line)',
              color: 'var(--cat-video)',
              boxShadow: 'var(--shadow-clay-soft)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
