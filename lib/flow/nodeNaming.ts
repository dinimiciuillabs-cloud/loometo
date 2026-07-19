// Auto-naming for canvas nodes. Each node gets a short, readable
// displayName like `char-board-1`, `img-json-2`, `compositor-3` —
// stored on node.data.displayName and rendered as a chip in the node
// header. This is the canonical "talkback" identifier between Blue and
// the user: Blue says "edit char-board-1", the user sees that chip on
// the canvas card and knows which node to look at.
//
// Internal node IDs (node_100, node_1238, ...) stay as the
// machine-side identity. displayName is the human-side identity.

import type { Node } from '@xyflow/react'

// Maps an internal node type (the slug used in NODE_IO + FlowCanvas)
// to its short slug used in displayName. Keep slugs short so the chip
// stays compact on small node cards.
const TYPE_SLUGS: Record<string, string> = {
  // Text / prompt
  promptNode: 'prompt',
  promptEnhancerNode: 'enhancer',
  promptConcatNode: 'concat',
  directorPromptNode: 'director',
  llmNode: 'llm',
  imageDescriberNode: 'img-describe',
  imageToJsonNode: 'img-json',
  videoDescriberNode: 'vid-describe',
  audioTranscriberNode: 'audio-text',
  ttsNode: 'tts',

  // Image
  textToImageNode: 't2i',
  imageToImageNode: 'i2i',
  upscaleNode: 'upscale',
  bgRemoveNode: 'bg-remove',
  relightNode: 'relight',
  inpaintNode: 'inpaint',
  outpaintNode: 'outpaint',
  faceSwapNode: 'faceswap',
  objectRemoveNode: 'obj-remove',
  outfitChangeNode: 'outfit',
  compositorNode: 'compositor',
  referenceSheetNode: 'ref-sheet',
  characterBoardNode: 'char-board',
  locationBoardNode: 'loc-board',
  productBoardNode: 'prod-board',
  bRollBoardNode: 'broll-board',
  storyboardNode: 'story-board',
  mascotBoardNode: 'mascot-board',
  creatureBoardNode: 'creature-board',

  // Video
  textToVideoNode: 't2v',
  imageToVideoNode: 'i2v',
  videoToVideoNode: 'v2v',
  lipSyncNode: 'lipsync',
  videoUpscaleNode: 'vid-upscale',
  speechToVideoNode: 's2v',

  // Edit / mask
  cropNode: 'crop',
  blurNode: 'blur',
  levelsNode: 'levels',
  invertNode: 'invert',
  extractFrameNode: 'frame',
  painterNode: 'painter',
  maskExtractorNode: 'mask-x',
  maskByTextNode: 'mask-by-text',
  matteGrowShrinkNode: 'matte',
  mergeAlphaNode: 'merge-alpha',
  videoMatteNode: 'vid-matte',

  // Uploads / sources
  imageUploadNode: 'img',
  videoUploadNode: 'vid',
  audioUploadNode: 'audio',
  figmaImportNode: 'figma',

  // 3D
  imageTo3DNode: 'i23d',

  // Helpers
  compareNode: 'compare',
  stickyNoteNode: 'note',
  iteratorNode: 'iter',

  // Output
  outputNode: 'output',
}

function typeSlug(nodeType: string): string {
  if (TYPE_SLUGS[nodeType]) return TYPE_SLUGS[nodeType]
  // Fallback: strip "Node" suffix, kebab-case the rest.
  return nodeType
    .replace(/Node$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

interface NodeLike {
  id: string
  type?: string
  data?: Record<string, unknown>
}

/**
 * Generate a unique displayName for a new node based on its type and
 * the names already in use on the canvas. Returns e.g. "char-board-3"
 * if char-board-1 and char-board-2 are taken.
 */
export function generateDisplayName(
  nodeType: string,
  existingNodes: NodeLike[],
): string {
  const slug = typeSlug(nodeType)
  const used = new Set<string>()
  for (const n of existingNodes) {
    const dn = n.data?.displayName
    if (typeof dn === 'string') used.add(dn)
  }
  let i = 1
  while (used.has(`${slug}-${i}`)) i++
  return `${slug}-${i}`
}

/**
 * Walk a nodes array and assign displayName to any node missing one.
 * Returns a NEW nodes array (does not mutate). Useful as a one-time
 * migration after rehydrate / on first render of an older workflow.
 */
export function backfillDisplayNames<T extends NodeLike>(nodes: T[]): T[] {
  const known = new Set<string>()
  for (const n of nodes) {
    const dn = n.data?.displayName
    if (typeof dn === 'string') known.add(dn)
  }
  let mutated = false
  const out = nodes.map(n => {
    const dn = n.data?.displayName
    if (typeof dn === 'string' && dn.length > 0) return n
    if (!n.type) return n
    const slug = typeSlug(n.type)
    let i = 1
    while (known.has(`${slug}-${i}`)) i++
    const newName = `${slug}-${i}`
    known.add(newName)
    mutated = true
    return { ...n, data: { ...(n.data ?? {}), displayName: newName } } as T
  })
  return mutated ? out : nodes
}

/**
 * Look up a node by its displayName. Returns undefined if not found.
 * Use this in canvas-op endpoints / Blue tooling so callers can target
 * nodes by name instead of internal ID.
 */
export function findNodeByDisplayName<T extends NodeLike>(
  nodes: T[],
  displayName: string,
): T | undefined {
  const target = displayName.trim().toLowerCase()
  return nodes.find(n => {
    const dn = n.data?.displayName
    return typeof dn === 'string' && dn.toLowerCase() === target
  })
}

/**
 * Check whether a displayName is already in use (other than the node
 * identified by skipNodeId, if provided). Used by rename UIs to
 * block collisions.
 */
export function isDisplayNameTaken<T extends NodeLike>(
  nodes: T[],
  displayName: string,
  skipNodeId?: string,
): boolean {
  const target = displayName.trim().toLowerCase()
  return nodes.some(n => {
    if (n.id === skipNodeId) return false
    const dn = n.data?.displayName
    return typeof dn === 'string' && dn.toLowerCase() === target
  })
}

export { typeSlug }
