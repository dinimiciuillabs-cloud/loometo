'use client'
// Per-node icon map. Keeps NODE_CATALOG free of UI concerns. Picked
// so the glyph hints at what the node DOES — not just what category it
// lives in (we already have a coloured dot for that).
import {
  Type, Wand2, Combine, Clapperboard, ScanEye, Braces, FileVideo, FileAudio,
  Volume2, Mic2, Bot, Image as ImageIcon, Replace, Maximize2, ImageOff,
  Lightbulb, Brush, Expand, UserRoundCog, Eraser, Shirt, Layers, LayoutGrid,
  User, MapPin, Package, Film, Smile, PawPrint, Video, PlayCircle, Mic,
  MessageSquareText, Crop, CircleDashed, SlidersHorizontal, FlipHorizontal2,
  Camera, Paintbrush, Scissors, TextSelect, MoveDiagonal, Workflow, Upload,
  UploadCloud, SplitSquareHorizontal, StickyNote, Repeat, Box, Download,
  Link2, GalleryHorizontalEnd,
  type LucideIcon,
} from 'lucide-react'

export const NODE_ICONS: Record<string, LucideIcon> = {
  // text
  promptNode:           Type,
  promptEnhancerNode:   Wand2,
  promptConcatNode:     Combine,
  directorPromptNode:   Clapperboard,
  imageDescriberNode:   ScanEye,
  imageToJsonNode:      Braces,
  videoDescriberNode:   FileVideo,
  audioTranscriberNode: FileAudio,
  ttsNode:              Volume2,
  voiceClonerNode:      Mic2,
  llmNode:              Bot,
  // image gen + edit
  textToImageNode:      ImageIcon,
  imageToImageNode:     Replace,
  upscaleNode:          Maximize2,
  bgRemoveNode:         ImageOff,
  relightNode:          Lightbulb,
  inpaintNode:          Brush,
  outpaintNode:         Expand,
  faceSwapNode:         UserRoundCog,
  objectRemoveNode:     Eraser,
  outfitChangeNode:     Shirt,
  compositorNode:       Layers,
  referenceSheetNode:   LayoutGrid,
  characterBoardNode:   User,
  locationBoardNode:    MapPin,
  productBoardNode:     Package,
  bRollBoardNode:       Film,
  storyboardNode:       Clapperboard,
  mascotBoardNode:      Smile,
  creatureBoardNode:    PawPrint,
  // video
  textToVideoNode:      Video,
  imageToVideoNode:     PlayCircle,
  videoToVideoNode:     Replace,
  lipSyncNode:          Mic,
  videoUpscaleNode:     Maximize2,
  speechToVideoNode:    MessageSquareText,
  // edit
  cropNode:             Crop,
  blurNode:             CircleDashed,
  levelsNode:           SlidersHorizontal,
  invertNode:           FlipHorizontal2,
  extractFrameNode:     Camera,
  painterNode:          Paintbrush,
  imageTo3DNode:        Box,
  // mask
  maskExtractorNode:    Scissors,
  maskByTextNode:       TextSelect,
  matteGrowShrinkNode:  MoveDiagonal,
  mergeAlphaNode:       Combine,
  videoMatteNode:       Film,
  // helper
  figmaImportNode:      Workflow,
  urlImportNode:        Link2,
  carouselBoardNode:    GalleryHorizontalEnd,
  imageUploadNode:      Upload,
  videoUploadNode:      UploadCloud,
  audioUploadNode:      Upload,
  compareNode:          SplitSquareHorizontal,
  stickyNoteNode:       StickyNote,
  iteratorNode:         Repeat,
  // output
  outputNode:           Download,
}
