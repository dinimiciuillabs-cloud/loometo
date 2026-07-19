// Model recommendations + cautions surfaced as badges in the model picker.
//
// RECOMMENDED: per category, the models we'd pick first — best quality/cost
// balance for that job, validated in real runs. They sort to the top of
// the dropdown with a star chip.
//
// CAUTION: per slug, a short warning shown as an amber chip. Only add
// entries for failure modes actually observed — this is a trust surface,
// not a guess list.

export const RECOMMENDED: Record<string, string[]> = {
  'Text to Image': ['flux-2-pro', 'nano-banana-pro'],
  'Image to Image': ['nano-banana-pro-edit'],
  'Image to Video': ['veo3.1-fast-image-to-video', 'seedance-2.0-omni-reference'],
  'Text to Video': ['veo3.1-fast-text-to-video'],
  'Image to 3D': ['tripo3d-h31-image-to-3d'],
}

export const CAUTION: Record<string, string> = {
  // Observed 2026-07-02: refused a Character Board run ("content could
  // not be processed") — OpenAI image models moderate identity/person
  // reference work far more aggressively than Nano Banana / Seedream.
  'gpt-image-2-image-to-image': 'Often refuses people / identity-reference work',
  'gpt4o-image-to-image': 'Strict moderation on faces and real-person references',
  'gpt4o-edit': 'Strict moderation on faces and real-person references',
}

export function isRecommended(category: string, slug: string): boolean {
  return RECOMMENDED[category]?.includes(slug) ?? false
}

export function cautionFor(slug: string): string | undefined {
  return CAUTION[slug]
}
