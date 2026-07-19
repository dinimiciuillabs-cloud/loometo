'use client'
import { useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, MousePointerClick } from 'lucide-react'
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useWorkflowStore } from '@/lib/store/workflowStore'
import {
  PromptNode, PromptEnhancerNode, PromptConcatNode, DirectorPromptNode, LLMNode, ImageDescriberNode, VideoDescriberNode, AudioTranscriberNode, TTSNode, VoiceClonerNode,
  TextToImageNode, ImageToImageNode, UpscaleNode, BGRemoveNode, RelightNode,
  InpaintNode, OutpaintNode, FaceSwapNode, ObjectRemoveNode, OutfitChangeNode,
  TextToVideoNode, ImageToVideoNode, VideoToVideoNode, LipSyncNode,
  VideoUpscaleNode, SpeechToVideoNode,
  CompositorNode, ReferenceSheetNode, ImageToJsonNode,
  CharacterBoardNode, LocationBoardNode, ProductBoardNode,
  BRollBoardNode, StoryboardNode, MascotBoardNode, CreatureBoardNode,
  CropNode, BlurNode, LevelsNode, InvertNode, ExtractFrameNode, PainterNode,
  MaskExtractorNode, MaskByTextNode, MatteGrowShrinkNode, MergeAlphaNode, VideoMatteNode,
  ImageUploadNode, VideoUploadNode, AudioUploadNode,
  FigmaImportNode, UrlImportNode, CarouselBoardNode,
  CompareNode, StickyNoteNode, IteratorNode,
  ImageTo3DNode,
  OutputNode,
} from './nodes/AllNodes'
import AccentEdge from './edges/AccentEdge'
import { type PipelineTemplate } from '@/lib/flow/templates'
import { propagateFromNode } from '@/lib/flow/propagate'
import TemplateStrip from './TemplateStrip'

const nodeTypes = {
  promptNode: PromptNode,
  promptEnhancerNode: PromptEnhancerNode,
  promptConcatNode: PromptConcatNode,
  directorPromptNode: DirectorPromptNode,
  llmNode: LLMNode,
  imageDescriberNode: ImageDescriberNode,
  imageToJsonNode: ImageToJsonNode,
  videoDescriberNode: VideoDescriberNode,
  audioTranscriberNode: AudioTranscriberNode,
  ttsNode: TTSNode,
  voiceClonerNode: VoiceClonerNode,
  textToImageNode: TextToImageNode,
  imageToImageNode: ImageToImageNode,
  upscaleNode: UpscaleNode,
  bgRemoveNode: BGRemoveNode,
  relightNode: RelightNode,
  inpaintNode: InpaintNode,
  outpaintNode: OutpaintNode,
  faceSwapNode: FaceSwapNode,
  objectRemoveNode: ObjectRemoveNode,
  outfitChangeNode: OutfitChangeNode,
  compositorNode: CompositorNode,
  referenceSheetNode: ReferenceSheetNode,
  characterBoardNode: CharacterBoardNode,
  locationBoardNode: LocationBoardNode,
  productBoardNode: ProductBoardNode,
  bRollBoardNode: BRollBoardNode,
  storyboardNode: StoryboardNode,
  mascotBoardNode: MascotBoardNode,
  creatureBoardNode: CreatureBoardNode,
  textToVideoNode: TextToVideoNode,
  imageToVideoNode: ImageToVideoNode,
  videoToVideoNode: VideoToVideoNode,
  lipSyncNode: LipSyncNode,
  videoUpscaleNode: VideoUpscaleNode,
  speechToVideoNode: SpeechToVideoNode,
  cropNode: CropNode,
  blurNode: BlurNode,
  levelsNode: LevelsNode,
  invertNode: InvertNode,
  extractFrameNode: ExtractFrameNode,
  painterNode: PainterNode,
  maskExtractorNode: MaskExtractorNode,
  maskByTextNode: MaskByTextNode,
  matteGrowShrinkNode: MatteGrowShrinkNode,
  mergeAlphaNode: MergeAlphaNode,
  videoMatteNode: VideoMatteNode,
  imageUploadNode: ImageUploadNode,
  videoUploadNode: VideoUploadNode,
  audioUploadNode: AudioUploadNode,
  figmaImportNode: FigmaImportNode,
  urlImportNode: UrlImportNode,
  carouselBoardNode: CarouselBoardNode,
  compareNode: CompareNode,
  stickyNoteNode: StickyNoteNode,
  iteratorNode: IteratorNode,
  imageTo3DNode: ImageTo3DNode,
  outputNode: OutputNode,
}

const edgeTypes = { accent: AccentEdge }

const CATEGORY_VAR_BY_TYPE: Record<string, string> = {
  // small set is enough — minimap picks one of these based on node category
}

export default function FlowCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode } = useWorkflowStore()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  // screenToFlowPosition translates browser-pixel coords into React Flow's
  // internal coord space, accounting for the current pan + zoom. Without
  // this, drops land at a fixed pixel offset and miss the cursor any time
  // the canvas isn't at default zoom/pan.
  const { screenToFlowPosition, fitView } = useReactFlow()

  // Spawn a pre-wired pipeline template. APPENDS to whatever's already on
  // the canvas (so a second template can join a project) — template node
  // ids are remapped to fresh ones and the whole block is offset below the
  // existing content. Then propagate so pre-filled prompts flow, and fit.
  const spawnTemplate = useCallback((tpl: PipelineTemplate) => {
    const { nodes: tNodes, edges: tEdges } = tpl.build()
    const s = useWorkflowStore.getState()
    const existing = s.nodes
    const existingEdges = s.edges

    const maxN = existing.reduce((m, n) => {
      const x = /^node_(\d+)$/.exec(n.id)
      return x ? Math.max(m, Number(x[1])) : m
    }, 0)
    const offsetY = existing.length
      ? Math.max(...existing.map(n => n.position.y)) + 480
      : 0

    // Fresh id per template node; edges rewritten to the new ids.
    const idMap = new Map<string, string>()
    tNodes.forEach((n, i) => idMap.set(n.id, `node_${maxN + 1 + i}`))
    const newNodes = tNodes.map(n => ({
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x, y: n.position.y + offsetY },
    }))
    const newEdges = tEdges.map(e => ({
      ...e,
      id: `e_${maxN}_${e.id}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }))

    let mergedNodes = [...existing, ...newNodes]
    const mergedEdges = [...existingEdges, ...newEdges]
    for (const n of newNodes) {
      mergedNodes = propagateFromNode(mergedNodes, mergedEdges, n.id)
    }
    s.setNodes(mergedNodes)
    s.setEdges(mergedEdges)
    // Wait a frame for React Flow to measure the new nodes before fitting.
    setTimeout(() => fitView({ maxZoom: 0.8, padding: 0.12, duration: 400 }), 80)
  }, [fitView])

  // Paste an image from the clipboard (screenshot, copied image) straight
  // onto the canvas. If a single Upload Image node is selected, the image
  // drops into it; otherwise a fresh Upload Image node is spawned at the
  // centre of the visible canvas, already holding the image. Text pastes
  // carry no image item, so they fall through to normal textarea behaviour.
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (useWorkflowStore.getState().demoMode) return
      const items = e.clipboardData?.items
      if (!items) return
      const imgItem = Array.from(items).find(it => it.kind === 'file' && it.type.startsWith('image/'))
      const file = imgItem?.getAsFile()
      if (!file) return
      e.preventDefault()
      const reader = new FileReader()
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : ''
        if (!url) return
        const s = useWorkflowStore.getState()
        const sel = s.nodes.filter(n => n.selected)
        const target = sel.length === 1 && sel[0].type === 'imageUploadNode' ? sel[0] : null
        if (target) {
          s.updateNodeData(target.id, { imageUrl: url, fileName: file.name || 'pasted-image' })
          s.pulseNode(target.id)
          return
        }
        const rect = reactFlowWrapper.current?.getBoundingClientRect()
        const screen = rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        const c = screenToFlowPosition(screen)
        const maxN = s.nodes.reduce((m, n) => {
          const x = /^node_(\d+)$/.exec(n.id); return x ? Math.max(m, Number(x[1])) : m
        }, 0)
        s.addNode({
          id: `node_${maxN + 1}`, type: 'imageUploadNode',
          position: { x: c.x - 160, y: c.y - 40 },
          data: { imageUrl: url, fileName: file.name || 'pasted-image' },
        })
      }
      reader.readAsDataURL(file)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [screenToFlowPosition])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/nodeType')
    if (!raw) return
    const info = JSON.parse(raw)
    // Offset by half the typical node footprint so the cursor lands near
    // the center of the dropped card, not the top-left corner.
    const cursor = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const position = { x: cursor.x - 160, y: cursor.y - 40 }
    // Derive next id from store state (not a module counter) so dropping
    // never collides with an id that's already on canvas.
    const existing = useWorkflowStore.getState().nodes
    const maxN = existing.reduce((m, n) => {
      const match = /^node_(\d+)$/.exec(n.id)
      return match ? Math.max(m, Number(match[1])) : m
    }, 0)
    addNode({ id: `node_${maxN + 1}`, type: info.type, position, data: { label: info.label } })
  }, [addNode, screenToFlowPosition])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div ref={reactFlowWrapper} className="flex-1 h-full relative" style={{ background: 'var(--bg-canvas)' }}>
      {/* Decorative backdrop — sits behind React Flow. Pointer-events off
          so it never blocks pan/zoom. */}
      <div className="canvas-backdrop">
        <div className="canvas-backdrop-vignette" />
        <div className="canvas-backdrop-noise" />
      </div>

      {/* Pinned template bar — top-center, appears once the canvas has
          nodes so a second template can be added to the same project. */}
      {nodes.length > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[70%]"
          style={{ pointerEvents: 'none' }}>
          <div className="rounded-2xl px-2.5 py-2 glass-strong"
            style={{ border: '1px solid var(--line-soft)', boxShadow: 'var(--shadow-clay-sm, 0 4px 14px rgba(0,0,0,0.2))', pointerEvents: 'auto' }}>
            <TemplateStrip onPick={spawnTemplate} compact scroll />
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        // Cap how far fitView zooms in — without this, a single small node
        // gets scaled 2x+ which makes the whole UI look oversized.
        fitViewOptions={{ maxZoom: 1.1, minZoom: 0.5, padding: 0.2 }}
        // Default viewport for empty canvas — 1x zoom, centered.
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.25}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'accent' }}
        style={{ background: 'transparent', position: 'relative', zIndex: 1 }}
      >
        {/*
          Background, Controls, and MiniMap need real color strings — they
          paint to canvas/SVG and don't resolve CSS variables. Picking a
          neutral gray that reads cleanly on both light and dark themes.
        */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1}
          color="rgba(140,131,119,0.35)"
        />
        {/* Controls also needs fitViewOptions to honor maxZoom on button click */}
        <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1.1, padding: 0.2 }} />
        <MiniMap
          nodeColor="rgba(140,131,119,0.55)"
          maskColor="rgba(140,131,119,0.18)"
          pannable
          zoomable
        />

      </ReactFlow>

      {/* Empty-state hero — sibling of ReactFlow, so it lives in the
          wrapper's coordinate space (stationary), not the flow's
          (pan/zoom). absolute inset-0 centers to the visible canvas area. */}
      {nodes.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center px-6"
          style={{ pointerEvents: 'none', zIndex: 5 }}
        >
          <div className="text-center w-full max-w-md hero-fade-up" style={{ minWidth: 0 }}>
              {/* Sidebar pointer — animated arrow nudging toward the left rail */}
              <div className="flex items-center justify-center gap-2 mb-7" style={{ color: 'var(--accent)' }}>
                <ArrowLeft size={18} className="hero-arrow-pulse" />
                <span className="text-[10px] uppercase tracking-[0.18em] font-medium" style={{ color: 'var(--ink-mute)' }}>
                  Pick a node from the sidebar
                </span>
              </div>

              {/* Title — responsive to prevent overflow on narrow flow areas */}
              <h1 className="font-display leading-[1.05] mb-3 text-[clamp(28px,5vw,44px)]" style={{ color: 'var(--ink)' }}>
                A blank canvas.<br />
                <span style={{ color: 'var(--accent)' }}>What will you build?</span>
              </h1>
              <p className="text-[12.5px] mb-8" style={{ color: 'var(--ink-mute)' }}>
                Drag any node from the left, wire them together, hit Run All. Loometo does the rest.
              </p>

              {/* Template chips — horizontal, wrapping, no scroll. */}
              <div className="mb-2">
                <TemplateStrip onPick={spawnTemplate} />
              </div>
              <p className="text-[9.5px] uppercase tracking-[0.14em] mb-7" style={{ color: 'var(--ink-faint)' }}>
                Click a template to start pre-wired
              </p>

              {/* Drop-here pulse target — purely decorative, sits in the centre
                  to invite the first drop. The drop is handled by the canvas
                  itself; this is just the visual cue. */}
              <div className="inline-flex items-center justify-center relative">
                <div
                  className="absolute inset-0 rounded-full hero-drop-ring"
                  style={{ border: '2px solid var(--accent)' }}
                />
                <div
                  className="relative w-12 h-12 rounded-full flex items-center justify-center"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
                    border: '1.5px dashed color-mix(in srgb, var(--accent) 55%, transparent)',
                  }}
                >
                  <MousePointerClick size={16} style={{ color: 'var(--accent)' }} />
                </div>
              </div>
            <p className="text-[9.5px] uppercase tracking-[0.18em] mt-3" style={{ color: 'var(--ink-faint)' }}>
              Drop here
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
