// UGC + ad video mode presets. Picked the same 9 modes Higgsfield's
// Marketing Studio ships, but the prompt scaffolds are ours — written to
// match what MuAPI's video models (Kling, Veo, Sora, Seedance) actually
// respond well to. Clicking a mode in a video node drops its template
// into the prompt textarea; the user can still edit before running.

export interface VideoModePreset {
  slug: string
  label: string
  description: string
  // Prompt scaffold dropped into the node's `prompt` field on click.
  // Written in the "verbs of motion, don't redescribe the static frame"
  // style that image-to-video models reward.
  promptTemplate: string
  // Suggested aspect ratio for this mode — set on the node if the chosen
  // model supports it. 9:16 for phone-native UGC, 16:9 for cinematic.
  preferredAspect?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '21:9'
  // Suggested duration in seconds for the mode. Models clamp to their
  // own allowed set (Veo 3 → 4/6/8 only, etc.) — this is just a hint.
  preferredDuration?: number
}

export const VIDEO_MODES: VideoModePreset[] = [
  {
    slug: 'ugc',
    label: 'UGC',
    description: 'Casual organic-feel selfie video from a presenter',
    promptTemplate:
      'Casual UGC selfie-style video, presenter speaks naturally to camera, ' +
      'subtle handheld phone sway, authentic candid feel, soft natural ' +
      'window lighting, single continuous take, direct eye contact.',
    preferredAspect: '9:16',
    preferredDuration: 8,
  },
  {
    slug: 'ugc_unboxing',
    label: 'Unboxing',
    description: 'Reveal moment — opens package, holds up product',
    promptTemplate:
      'UGC unboxing reveal video. Hands open packaging, lift the product ' +
      'into frame, slow tilt up to show it clearly. Excited natural reaction, ' +
      'desk or floor surface in soft warm light, handheld phone POV.',
    preferredAspect: '9:16',
    preferredDuration: 8,
  },
  {
    slug: 'ugc_how_to',
    label: 'Tutorial',
    description: 'Explainer / how-to — presenter teaching a step',
    promptTemplate:
      'UGC tutorial-style video. Presenter demonstrates one clear action ' +
      'step, hands-on with the subject, alternates between face-to-camera ' +
      'and overhead close-up of the action. Friendly direct explanation.',
    preferredAspect: '9:16',
    preferredDuration: 10,
  },
  {
    slug: 'product_showcase',
    label: 'Showcase',
    description: 'Polished product highlight, no presenter',
    promptTemplate:
      'Polished product showcase. Hero product centered, slow orbit camera ' +
      'move around it, dramatic studio lighting with rim light, premium ' +
      'cinematic feel, slow reveal, no people in frame.',
    preferredAspect: '16:9',
    preferredDuration: 8,
  },
  {
    slug: 'product_review',
    label: 'Review',
    description: 'Presenter holding product and giving opinion',
    promptTemplate:
      'Product review video. Presenter holds the product, gestures while ' +
      'speaking, camera cuts between medium shot of presenter and close-up ' +
      'of the product detail, honest casual tone, well-lit indoor setting.',
    preferredAspect: '9:16',
    preferredDuration: 10,
  },
  {
    slug: 'tv_spot',
    label: 'TV Spot',
    description: 'Broadcast commercial, high production',
    promptTemplate:
      'Broadcast-style TV commercial. Cinematic camera work — dolly in, ' +
      'tracking shot, smooth crane move. Polished color grade with rich ' +
      'shadows, dramatic music-driven pacing, brand-quality production.',
    preferredAspect: '16:9',
    preferredDuration: 10,
  },
  {
    slug: 'wild_card',
    label: 'Wild Card',
    description: 'Experimental — model picks the vibe',
    promptTemplate:
      'Experimental cinematic video. Unexpected camera angle in the first ' +
      'second, surreal lighting, bold color palette, attention-grabbing ' +
      'first frame that pays off in the rest of the clip.',
    preferredAspect: '9:16',
    preferredDuration: 8,
  },
  {
    slug: 'ugc_virtual_try_on',
    label: 'Try-On UGC',
    description: 'Trying on clothing — casual selfie feel',
    promptTemplate:
      'UGC virtual try-on video. Person tries on the garment in a casual ' +
      'mirror or selfie angle, natural body movement, authentic reactions, ' +
      'well-lit indoor home setting, phone-shot feel.',
    preferredAspect: '9:16',
    preferredDuration: 8,
  },
  {
    slug: 'virtual_try_on',
    label: 'Try-On Pro',
    description: 'Polished try-on — model + studio',
    promptTemplate:
      'Polished virtual try-on video. Model wearing the garment, fashion-' +
      'shoot angles, professional poses, clean studio background, dramatic ' +
      'lighting, brand-catalog quality.',
    preferredAspect: '4:3',
    preferredDuration: 8,
  },
]

export function modeBySlug(slug: string): VideoModePreset | undefined {
  return VIDEO_MODES.find(m => m.slug === slug)
}
