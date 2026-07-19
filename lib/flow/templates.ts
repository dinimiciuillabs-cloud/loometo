// Pipeline templates — one-click pre-wired canvases for the empty state.
//
// Each template encodes a production-tested pipeline shape (the same
// recipes documented in the loometo-prompt skill) so a new user sees a
// working workflow in seconds instead of a blank canvas. Prompts are
// pre-filled with director-formula-grade briefs the user edits in place;
// models are pre-picked per the recommendation table.
//
// Handle ids MUST match the node components' input/output declarations
// in AllNodes.tsx — propagation resolves targetHandle → data field from
// those ids (ref1 → ref1Url, firstImage → imageUrl, text → prompt...).

import type { Node, Edge } from '@xyflow/react'
import {
  Sparkles, Wand2, Link2, MousePointerClick, Mic, Box, Palette,
  UsersRound, Clapperboard, LayoutGrid, Lightbulb, AudioLines, Zap,
  Sticker, Replace, Sun, Shirt, Camera, ImageUp, Eraser, Copy, Newspaper,
  type LucideIcon,
} from 'lucide-react'

export interface PipelineTemplate {
  id: string
  name: string
  tagline: string        // one-liner under the name on the card
  icon: LucideIcon
  complex?: boolean      // badge + grouped under "Advanced" in the picker
  build: () => { nodes: Node[]; edges: Edge[] }
}

// Node ids in templates start at node_101 to stay clear of the demo
// exports and any lingering canvas state; addNode's max-scan keeps
// future drops collision-free either way.
const n = (
  id: number,
  type: string,
  x: number,
  y: number,
  data: Record<string, unknown> = {},
): Node => ({
  id: `node_${id}`,
  type,
  position: { x, y },
  data,
})

const e = (
  id: number,
  source: number,
  sourceHandle: string,
  target: number,
  targetHandle: string,
): Edge => ({
  id: `e_${id}`,
  source: `node_${source}`,
  target: `node_${target}`,
  sourceHandle,
  targetHandle,
  type: 'accent',
})

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'ugc-clip',
    name: 'UGC Clip',
    tagline: 'Person + place → video',
    icon: Sparkles,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'imageUploadNode', 0, 420, { label: 'Upload Image' }),
        n(103, 'characterBoardNode', 480, -60, { label: 'Character Board' }),
        n(104, 'locationBoardNode', 480, 440, { label: 'Location Board' }),
        n(105, 'imageToVideoNode', 1020, 180, {
          label: 'Image → Video',
          model: 'seedance-2.0-omni-reference',
          prompt:
            '@image1 is the character. @image2 is the location. ' +
            'The character walks through the location toward camera, natural talking energy, ' +
            'one hand gesture, handheld feel, golden hour. 5 seconds.',
        }),
        n(106, 'outputNode', 1560, 260, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 103, 'ref1'),
        e(102, 102, 'image', 104, 'ref1'),
        e(103, 103, 'image', 105, 'ref1'),
        e(104, 104, 'image', 105, 'ref2'),
        e(105, 105, 'video', 106, 'video'),
      ],
    }),
  },
  {
    id: 'product-shots',
    name: 'Product Shots',
    tagline: 'One photo → angle board + cutout',
    icon: Wand2,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 60, { label: 'Upload Image' }),
        n(102, 'productBoardNode', 480, -40, { label: 'Product Board' }),
        n(103, 'bgRemoveNode', 1020, 60, { label: 'Remove Background' }),
        n(104, 'outputNode', 1520, 120, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'ref1'),
        e(102, 102, 'image', 103, 'image'),
        e(103, 103, 'image', 104, 'image'),
      ],
    }),
  },
  {
    id: 'link-carousel',
    name: 'Link → Carousel',
    tagline: 'Paste a link, post a carousel',
    icon: Link2,
    build: () => ({
      nodes: [
        n(101, 'urlImportNode', 0, 100, { label: 'Import from URL' }),
        n(102, 'carouselBoardNode', 480, 0, { label: 'Carousel Board' }),
        n(103, 'outputNode', 1000, 120, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'text', 102, 'text'),
        e(102, 102, 'slide1', 103, 'image'),
      ],
    }),
  },
  {
    id: 'launch-kit',
    name: 'Launch Kit',
    tagline: 'One hero → every channel',
    icon: MousePointerClick,
    build: () => ({
      nodes: [
        n(101, 'promptNode', 0, 240, {
          label: 'Prompt',
          prompt:
            'Hero shot of [your product] on a clean surface. Medium close-up, 85mm f/2.8, ' +
            'soft window light from camera left with gentle fill, natural texture on the product ' +
            'surface, rule of thirds, styled like premium editorial product photography.',
        }),
        n(102, 'textToImageNode', 440, 200, {
          label: 'Text → Image',
          model: 'flux-2-pro',
        }),
        n(103, 'imageToImageNode', 980, -160, {
          label: 'Image → Image',
          prompt:
            'Adapt this exact image for a square 1:1 social post. Keep the subject identical, ' +
            'recompose the background gracefully. Do not change the product.',
        }),
        n(104, 'imageToImageNode', 980, 240, {
          label: 'Image → Image',
          prompt:
            'Adapt this exact image for a vertical 9:16 story. Keep the subject identical, ' +
            'extend the background vertically, leave headroom at the top for UI overlays.',
        }),
        n(105, 'imageToImageNode', 980, 640, {
          label: 'Image → Image',
          prompt:
            'Adapt this exact image for a wide banner. Keep the subject identical, extend the ' +
            'background horizontally, keep the left third clear for headline text.',
        }),
        n(106, 'outputNode', 1520, -100, { label: 'Output' }),
        n(107, 'outputNode', 1520, 300, { label: 'Output' }),
        n(108, 'outputNode', 1520, 700, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'text', 102, 'text'),
        e(102, 102, 'image', 103, 'image'),
        e(103, 102, 'image', 104, 'image'),
        e(104, 102, 'image', 105, 'image'),
        e(105, 103, 'image', 106, 'image'),
        e(106, 104, 'image', 107, 'image'),
        e(107, 105, 'image', 108, 'image'),
      ],
    }),
  },
  {
    id: 'product-3d',
    name: '3D Product Spin',
    tagline: 'Photo → spinnable 3D',
    icon: Box,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 60, { label: 'Upload Image' }),
        n(102, 'imageTo3DNode', 480, 0, { label: 'Image → 3D', model: 'tripo3d-h31-image-to-3d' }),
        n(103, 'outputNode', 960, 80, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'image'),
        e(102, 102, 'image', 103, 'image'),
      ],
    }),
  },
  {
    id: 'style-remix',
    name: 'Style Remix',
    tagline: 'Photo + idea → upscaled art',
    icon: Palette,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'promptNode', 0, 380, {
          label: 'Prompt',
          prompt: 'Reimagine this as a bold editorial illustration, rich color, clean shapes.',
        }),
        n(103, 'imageToImageNode', 480, 120, { label: 'Image → Image', model: 'nano-banana-pro-edit' }),
        n(104, 'upscaleNode', 960, 120, { label: 'Upscale' }),
        n(105, 'outputNode', 1420, 180, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 103, 'image'),
        e(102, 102, 'text', 103, 'text'),
        e(103, 103, 'image', 104, 'image'),
        e(104, 104, 'image', 105, 'image'),
      ],
    }),
  },
  {
    id: 'face-swap',
    name: 'Face Swap',
    tagline: 'Two photos → swapped',
    icon: UsersRound,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image', hint: 'Face source' }),
        n(102, 'imageUploadNode', 0, 380, { label: 'Upload Image', hint: 'Target scene' }),
        n(103, 'faceSwapNode', 480, 120, { label: 'Face Swap' }),
        n(104, 'outputNode', 960, 180, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 103, 'source'),
        e(102, 102, 'image', 103, 'target'),
        e(103, 103, 'image', 104, 'image'),
      ],
    }),
  },
  {
    id: 'video-restyle',
    name: 'Video Restyle',
    tagline: 'Clip + idea → new look',
    icon: Clapperboard,
    build: () => ({
      nodes: [
        n(101, 'videoUploadNode', 0, 0, { label: 'Upload Video' }),
        n(102, 'promptNode', 0, 360, {
          label: 'Prompt',
          prompt: 'Restyle this clip as cinematic anime, preserve motion and timing.',
        }),
        n(103, 'videoToVideoNode', 480, 100, { label: 'Video → Video' }),
        n(104, 'outputNode', 960, 160, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'video', 103, 'video'),
        e(102, 102, 'text', 103, 'text'),
        e(103, 103, 'video', 104, 'video'),
      ],
    }),
  },
  {
    id: 'talking-avatar',
    name: 'Talking Avatar',
    tagline: 'Photo + script → talking video',
    icon: Mic,
    complex: true,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 40, { label: 'Upload Image' }),
        n(102, 'characterBoardNode', 440, -40, { label: 'Character Board', model: 'nano-banana-pro-edit' }),
        n(103, 'imageToVideoNode', 900, 40, {
          label: 'Image → Video', model: 'veo3.1-fast-image-to-video',
          prompt: 'The person speaks to camera, natural head movement, subtle expression, eye contact.',
        }),
        n(104, 'promptNode', 440, 460, {
          label: 'Prompt',
          prompt: 'Hey! Welcome to the channel. Today I want to show you something that changes everything.',
        }),
        n(105, 'ttsNode', 900, 460, { label: 'Text → Speech' }),
        n(106, 'lipSyncNode', 1340, 220, { label: 'Lip Sync' }),
        n(107, 'outputNode', 1780, 280, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'ref1'),
        e(102, 102, 'image', 103, 'firstImage'),
        e(103, 104, 'text', 105, 'text'),
        e(104, 103, 'video', 106, 'video'),
        e(105, 105, 'audio', 106, 'audio'),
        e(106, 106, 'video', 107, 'video'),
      ],
    }),
  },
  {
    id: 'full-ugc-campaign',
    name: 'Full UGC Campaign',
    tagline: 'Character + place + product → 3 clips',
    icon: LayoutGrid,
    complex: true,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, -40, { label: 'Upload Image' }),
        n(102, 'imageUploadNode', 0, 320, { label: 'Upload Image' }),
        n(103, 'imageUploadNode', 0, 680, { label: 'Upload Image' }),
        n(104, 'characterBoardNode', 440, -80, { label: 'Character Board', model: 'nano-banana-pro-edit' }),
        n(105, 'locationBoardNode', 440, 320, { label: 'Location Board', model: 'nano-banana-pro-edit' }),
        n(106, 'productBoardNode', 440, 720, { label: 'Product Board', model: 'nano-banana-pro-edit' }),
        n(107, 'imageToVideoNode', 940, -40, {
          label: 'Image → Video', model: 'seedance-2.0-omni-reference',
          prompt: '@image1 holds @image3 in @image2, smiling at camera, hero shot. 5 seconds.',
        }),
        n(108, 'imageToVideoNode', 940, 320, {
          label: 'Image → Video', model: 'seedance-2.0-omni-reference',
          prompt: '@image1 demonstrates @image3 in @image2, close-up detail. 5 seconds.',
        }),
        n(109, 'imageToVideoNode', 940, 680, {
          label: 'Image → Video', model: 'seedance-2.0-omni-reference',
          prompt: '@image1 gives a thumbs up with @image3 in @image2, closing shot. 5 seconds.',
        }),
        n(110, 'outputNode', 1460, 40, { label: 'Output' }),
        n(111, 'outputNode', 1460, 400, { label: 'Output' }),
        n(112, 'outputNode', 1460, 760, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 104, 'ref1'),
        e(102, 102, 'image', 105, 'ref1'),
        e(103, 103, 'image', 106, 'ref1'),
        // char + loc + product feed all three clips
        e(104, 104, 'image', 107, 'ref1'), e(105, 105, 'image', 107, 'ref2'), e(106, 106, 'image', 107, 'ref3'),
        e(107, 104, 'image', 108, 'ref1'), e(108, 105, 'image', 108, 'ref2'), e(109, 106, 'image', 108, 'ref3'),
        e(110, 104, 'image', 109, 'ref1'), e(111, 105, 'image', 109, 'ref2'), e(112, 106, 'image', 109, 'ref3'),
        e(113, 107, 'video', 110, 'video'),
        e(114, 108, 'video', 111, 'video'),
        e(115, 109, 'video', 112, 'video'),
      ],
    }),
  },

  // ── Creator ──────────────────────────────────────────────────────────
  {
    id: 'carousel-idea',
    name: 'Carousel from Idea',
    tagline: 'Topic → carousel',
    icon: Lightbulb,
    build: () => ({
      nodes: [
        n(101, 'promptNode', 0, 40, {
          label: 'Prompt',
          prompt: '5 tips for staying consistent with content creation as a solo founder.',
        }),
        n(102, 'carouselBoardNode', 460, 0, { label: 'Carousel Board' }),
        n(103, 'outputNode', 980, 80, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'text', 102, 'text'),
        e(102, 102, 'slide1', 103, 'image'),
      ],
    }),
  },
  {
    id: 'voiceover-reel',
    name: 'Voiceover Reel',
    tagline: 'Script + face → talking clip',
    icon: AudioLines,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'promptNode', 0, 380, {
          label: 'Prompt',
          prompt: 'Three things nobody tells you about starting a business.',
        }),
        n(103, 'ttsNode', 460, 380, { label: 'Text → Speech' }),
        n(104, 'speechToVideoNode', 900, 140, { label: 'Speech → Video' }),
        n(105, 'outputNode', 1360, 200, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 104, 'image'),
        e(102, 102, 'text', 103, 'text'),
        e(103, 103, 'audio', 104, 'audio'),
        e(104, 104, 'video', 105, 'video'),
      ],
    }),
  },
  {
    id: 'animated-logo',
    name: 'Animated Logo',
    tagline: 'Logo → motion sting',
    icon: Zap,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 40, { label: 'Upload Image' }),
        n(102, 'imageToVideoNode', 460, 0, {
          label: 'Image → Video', model: 'veo3.1-fast-image-to-video',
          prompt: 'The logo animates in with a subtle shimmer and gentle motion, clean background. 3 seconds.',
        }),
        n(103, 'outputNode', 980, 80, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'firstImage'),
        e(102, 102, 'video', 103, 'video'),
      ],
    }),
  },
  {
    id: 'sticker-pack',
    name: 'Sticker Pack',
    tagline: 'Photo → 4 die-cut stickers',
    icon: Sticker,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 220, { label: 'Upload Image' }),
        n(102, 'bgRemoveNode', 440, 220, { label: 'Remove Background' }),
        ...([0, 1, 2, 3].map(i => n(103 + i, 'imageToImageNode', 900, i * 320, {
          label: 'Image → Image', model: 'nano-banana-pro-edit',
          prompt: ['Cartoon sticker style, bold outline, flat colors, glossy.',
            'Kawaii chibi sticker, soft pastel, thick white border.',
            'Pop-art comic sticker, halftone shading, bold outline.',
            'Watercolor sticker, soft edges, white die-cut border.'][i],
        }))),
        ...([0, 1, 2, 3].map(i => n(107 + i, 'outputNode', 1380, i * 320, { label: 'Output' }))),
      ],
      edges: [
        e(101, 101, 'image', 102, 'image'),
        ...([0, 1, 2, 3].map(i => e(102 + i, 102, 'image', 103 + i, 'image'))),
        ...([0, 1, 2, 3].map(i => e(106 + i, 103 + i, 'image', 107 + i, 'image'))),
      ],
    }),
  },

  // ── E-commerce ───────────────────────────────────────────────────────
  {
    id: 'bg-swap',
    name: 'Background Swap',
    tagline: 'Cut out → drop in a scene',
    icon: Replace,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'bgRemoveNode', 440, 0, { label: 'Remove Background' }),
        n(103, 'promptNode', 440, 360, {
          label: 'Prompt',
          prompt: 'Place the product on a sunlit marble kitchen counter, soft morning light, shallow depth of field.',
        }),
        n(104, 'compositorNode', 900, 80, { label: 'Compositor', mode: 'ai' }),
        n(105, 'outputNode', 1400, 140, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'image'),
        e(102, 102, 'image', 104, 'subject'),
        e(103, 103, 'text', 104, 'text'),
        e(104, 104, 'image', 105, 'image'),
      ],
    }),
  },
  {
    id: 'relight-product',
    name: 'Relight Product',
    tagline: 'Phone photo → studio light',
    icon: Sun,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'promptNode', 0, 360, {
          label: 'Prompt',
          prompt: 'Soft studio key light from the left, gentle fill, subtle rim light, clean shadow.',
        }),
        n(103, 'relightNode', 460, 80, { label: 'Relight' }),
        n(104, 'upscaleNode', 920, 80, { label: 'Upscale' }),
        n(105, 'outputNode', 1380, 140, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 103, 'image'),
        e(102, 102, 'text', 103, 'text'),
        e(103, 103, 'image', 104, 'image'),
        e(104, 104, 'image', 105, 'image'),
      ],
    }),
  },
  {
    id: 'virtual-tryon',
    name: 'Virtual Try-On',
    tagline: 'Person + outfit idea → look',
    icon: Shirt,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'promptNode', 0, 360, {
          label: 'Prompt',
          prompt: 'Dress the person in a tailored navy blazer over a white tee, keep face and pose identical.',
        }),
        n(103, 'outfitChangeNode', 460, 80, { label: 'Outfit Change' }),
        n(104, 'outputNode', 940, 140, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 103, 'image'),
        e(102, 102, 'text', 103, 'text'),
        e(103, 103, 'image', 104, 'image'),
      ],
    }),
  },

  // ── Personal / prosumer ──────────────────────────────────────────────
  {
    id: 'headshot-studio',
    name: 'Headshot Studio',
    tagline: 'Selfie → pro headshots',
    icon: Camera,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 40, { label: 'Upload Image' }),
        n(102, 'characterBoardNode', 460, -40, { label: 'Character Board', model: 'nano-banana-pro-edit' }),
        n(103, 'upscaleNode', 960, 40, { label: 'Upscale' }),
        n(104, 'outputNode', 1420, 100, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'ref1'),
        e(102, 102, 'image', 103, 'image'),
        e(103, 103, 'image', 104, 'image'),
      ],
    }),
  },
  {
    id: 'photo-restore',
    name: 'Photo Restore',
    tagline: 'Old / blurry → sharp',
    icon: ImageUp,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 40, { label: 'Upload Image' }),
        n(102, 'upscaleNode', 460, 0, { label: 'Upscale' }),
        n(103, 'outputNode', 940, 80, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'image'),
        e(102, 102, 'image', 103, 'image'),
      ],
    }),
  },
  {
    id: 'object-remove',
    name: 'Object Remover',
    tagline: 'Delete anything from a photo',
    icon: Eraser,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 0, { label: 'Upload Image' }),
        n(102, 'maskByTextNode', 440, 40, {
          label: 'Mask by Text',
          prompt: 'the person in the background',
        }),
        n(103, 'objectRemoveNode', 900, 40, { label: 'Object Remove' }),
        n(104, 'outputNode', 1360, 100, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'image', 102, 'image'),
        e(102, 101, 'image', 103, 'image'),
        e(103, 102, 'mask', 103, 'mask'),
        e(104, 103, 'image', 104, 'image'),
      ],
    }),
  },

  // ── Marketer ─────────────────────────────────────────────────────────
  {
    id: 'ad-variant-factory',
    name: 'Ad Variant Factory',
    tagline: 'One hero → 6 ad angles',
    icon: Copy,
    build: () => ({
      nodes: [
        n(101, 'imageUploadNode', 0, 320, { label: 'Upload Image' }),
        ...([0, 1, 2, 3, 4, 5].map(i => n(102 + i, 'imageToImageNode', 520, i * 240, {
          label: 'Image → Image', model: 'nano-banana-pro-edit',
          prompt: [
            'Bold sale banner treatment, high-contrast, add empty space top-left for a headline.',
            'Lifestyle context, warm natural setting, keep the product identical.',
            'Minimalist studio, single color backdrop, lots of negative space.',
            'Festive seasonal theme, subtle decorations, product stays the hero.',
            'Dark premium look, dramatic rim light, luxury feel.',
            'Playful pop-color background, energetic, youthful.'][i],
        }))),
        ...([0, 1, 2, 3, 4, 5].map(i => n(108 + i, 'outputNode', 1040, i * 240, { label: 'Output' }))),
      ],
      edges: [
        ...([0, 1, 2, 3, 4, 5].map(i => e(101 + i, 101, 'image', 102 + i, 'image'))),
        ...([0, 1, 2, 3, 4, 5].map(i => e(107 + i, 102 + i, 'image', 108 + i, 'image'))),
      ],
    }),
  },
  {
    id: 'blog-hero',
    name: 'Blog Hero',
    tagline: 'Article link → hero image',
    icon: Newspaper,
    build: () => ({
      nodes: [
        n(101, 'urlImportNode', 0, 40, { label: 'Import from URL' }),
        n(102, 'llmNode', 460, 0, {
          label: 'Run Any LLM',
          message: 'Read this article and write a single vivid image-generation prompt for an editorial hero illustration that captures its theme. Output only the prompt.',
        }),
        n(103, 'textToImageNode', 940, 40, { label: 'Text → Image', model: 'flux-2-pro' }),
        n(104, 'outputNode', 1420, 100, { label: 'Output' }),
      ],
      edges: [
        e(101, 101, 'text', 102, 'text'),
        e(102, 102, 'text', 103, 'text'),
        e(103, 103, 'image', 104, 'image'),
      ],
    }),
  },
]
