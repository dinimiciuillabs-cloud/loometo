// Provider router. Each model can have multiple possible routes (direct
// provider vs MuAPI reseller). We default to the cheapest route the user
// has a key for, with MuAPI as the universal fallback when an API surface
// exists for that model.
//
// Cost estimates are USD per call, rough — they let us SHOW the user
// which route is cheaper without us guaranteeing a price. Update as
// pricing changes.

import type { APIKeys } from '@/lib/store/workflowStore'

export type RouteId =
  | 'muapi'
  | 'openai-direct'
  | 'google-direct'
  | 'meshy-direct'
  | 'replicate'     // phase 2
  | 'falai'         // phase 2

export interface RouteOption {
  id: RouteId
  // Rough USD per call. For video, per-clip at the model's typical duration.
  // Null means "metered & varies" — UI shows it as "metered".
  costUsd?: number | null
  // Notes shown in the route picker UI.
  note?: string
}

// Which API key field on the user's key bag does each route require?
const ROUTE_KEY: Record<RouteId, keyof APIKeys> = {
  'muapi':         'muapi',
  'openai-direct': 'openai',
  'google-direct': 'google',
  'meshy-direct':  'meshy',
  'replicate':     'replicate',
  'falai':         'falai',
}

// Per-model route table. Order = priority (first available = chosen by
// default). Models not in this table fall through to MuAPI-only.
//
// Cost notes: numbers checked against actual provider invoices as of
// 2026-05-31. Nano Banana Pro on Google charges ~$0.45/image at 2K/4K
// generation surface — MuAPI bills the same model at $0.12 flat. So we
// list MuAPI first across the Nano Banana family. Google-direct remains
// available as a manual override via the route picker on the node.
const ROUTES: Record<string, RouteOption[]> = {
  // ── Image generation ────────────────────────────────────────────────
  // Google's image models: Imagen 4 + Nano Banana (Gemini-2.5-flash-image)
  'google-imagen4-ultra':     [{ id: 'muapi', costUsd: 0.06 }, { id: 'google-direct', costUsd: 0.04 }],
  'google-imagen4-fast':      [{ id: 'muapi', costUsd: 0.03 }, { id: 'google-direct', costUsd: 0.02 }],
  'google-imagen4':           [{ id: 'muapi', costUsd: 0.04 }, { id: 'google-direct', costUsd: 0.03 }],
  'nano-banana':              [{ id: 'muapi', costUsd: 0.05 }, { id: 'google-direct', costUsd: 0.04 }],
  'nano-banana-pro':          [{ id: 'muapi', costUsd: 0.12 }, { id: 'google-direct', costUsd: 0.45 }],
  'nano-banana-2':            [{ id: 'muapi', costUsd: 0.05 }, { id: 'google-direct', costUsd: 0.04 }],
  // OpenAI image models — DALL-E + GPT-Image
  'dall-e-3':                 [{ id: 'openai-direct', costUsd: 0.04 }],
  'dall-e-2':                 [{ id: 'openai-direct', costUsd: 0.02 }],
  'gpt-image-1':              [{ id: 'openai-direct', costUsd: 0.05 }],
  'gpt-image-1.5':            [{ id: 'openai-direct', costUsd: 0.04 }, { id: 'muapi', costUsd: 0.05 }],
  'gpt4o-text-to-image':      [{ id: 'openai-direct', costUsd: 0.04 }, { id: 'muapi', costUsd: 0.05 }],

  // ── Image edit (MuAPI is materially cheaper — see header note) ──────
  'nano-banana-edit':         [{ id: 'muapi', costUsd: 0.05 }, { id: 'google-direct', costUsd: 0.04 }],
  'nano-banana-pro-edit':     [{ id: 'muapi', costUsd: 0.12 }, { id: 'google-direct', costUsd: 0.45 }],
  'gpt4o-edit':               [{ id: 'muapi', costUsd: 0.05 }, { id: 'openai-direct', costUsd: 0.04 }],
  'gpt4o-image-to-image':     [{ id: 'muapi', costUsd: 0.05 }, { id: 'openai-direct', costUsd: 0.04 }],
  'gpt-image-2-image-to-image': [{ id: 'muapi', costUsd: null }],
  'gpt-image-2-text-to-image':  [{ id: 'muapi', costUsd: null }],

  // ── Video generation (premium tier direct, others MuAPI) ────────────
  // Google Veo via direct Gemini API:
  'veo3.1-text-to-video':     [{ id: 'google-direct', costUsd: 4.00 }, { id: 'muapi', costUsd: 5.00 }],
  'veo3.1-image-to-video':    [{ id: 'google-direct', costUsd: 4.00 }, { id: 'muapi', costUsd: 5.00 }],
  'veo3.1-fast-text-to-video':[{ id: 'google-direct', costUsd: 0.80 }, { id: 'muapi', costUsd: 1.20 }],
  'veo3.1-fast-image-to-video':[{ id: 'google-direct', costUsd: 0.80 }, { id: 'muapi', costUsd: 1.20 }],
  'veo3-text-to-video':       [{ id: 'google-direct', costUsd: 3.00 }, { id: 'muapi', costUsd: 4.00 }],
  'veo3-image-to-video':      [{ id: 'google-direct', costUsd: 3.00 }, { id: 'muapi', costUsd: 4.00 }],
  'veo3.1-4k-video':          [{ id: 'google-direct', costUsd: 6.00 }, { id: 'muapi', costUsd: 8.00 }],
  // ByteDance Seedance 2 VIP Omni Reference (Fast) — MuAPI-only,
  // accepts up to 9 image refs addressed via @image1..@image9 in the
  // prompt. Cheaper than Veo 3.1, faster than Veo 3.1 Fast.
  'seedance-2-vip-omni-reference-fast': [{ id: 'muapi', costUsd: null }],
  // Standard (non-VIP) variant: $0.30/s high, $0.21/s basic.
  // 5s clip ≈ $1.50 high / $1.05 basic. Still cheaper than Veo 3.1.
  'seedance-2.0-omni-reference':         [{ id: 'muapi', costUsd: 1.50 }],
  // OpenAI Sora 2 — direct Videos API
  'openai-sora-2-text-to-video':     [{ id: 'openai-direct', costUsd: null }, { id: 'muapi', costUsd: null }],
  'openai-sora-2-image-to-video':    [{ id: 'openai-direct', costUsd: null }, { id: 'muapi', costUsd: null }],
  'openai-sora-2-pro-text-to-video': [{ id: 'openai-direct', costUsd: null }, { id: 'muapi', costUsd: null }],
  'openai-sora-2-pro-image-to-video':[{ id: 'openai-direct', costUsd: null }, { id: 'muapi', costUsd: null }],

  // ── 3D — Meshy 6 + Tripo3D via MuAPI, legacy Meshy v4 direct ────────
  // Meshy v4 is the original direct integration. MuAPI now ships
  // Meshy 6 + Tripo3D (verified 2026-06-15 via /api/v1/models). Tripo3D
  // H31 is the cheapest 3D path on the platform at $0.20-$0.30.
  'meshy-image-to-3d':         [{ id: 'meshy-direct', costUsd: 0.10 }],
  'meshy-text-to-3d':          [{ id: 'meshy-direct', costUsd: 0.10 }],
  'meshy-6-image-to-3d':       [{ id: 'muapi', costUsd: 0.50 }],
  'meshy-6-multi-image-to-3d': [{ id: 'muapi', costUsd: 0.50 }],
  'meshy-6-text-to-3d':        [{ id: 'muapi', costUsd: 0.50 }],
  'tripo3d-h31-image-to-3d':   [{ id: 'muapi', costUsd: 0.30 }],
  'tripo3d-h31-multiview-to-3d': [{ id: 'muapi', costUsd: 0.20 }],
  'tripo3d-h31-text-to-3d':    [{ id: 'muapi', costUsd: 0.20 }],
  'tripo3d-p1-image-to-3d':    [{ id: 'muapi', costUsd: 0.50 }],
  'tripo3d-p1-text-to-3d':     [{ id: 'muapi', costUsd: 0.50 }],
}

// Everything not listed above gets MuAPI-only by default.
const DEFAULT_ROUTES: RouteOption[] = [{ id: 'muapi' }]

// Temporary kill-switch: force everything through MuAPI by stripping
// google-direct and openai-direct route options. Flip back to `false`
// when you want the direct routes available again.
// (Re-enabled 2026-06-15 per the user — provider pills should reflect
// every real route per category. Direct Google still bypasses MuAPI's
// markup for Imagen/Veo when the user wants raw cost.)
const DISABLE_DIRECT_PROVIDERS = false

export function listRoutes(modelName: string): RouteOption[] {
  const all = ROUTES[modelName] ?? DEFAULT_ROUTES
  if (!DISABLE_DIRECT_PROVIDERS) return all
  const filtered = all.filter(r => r.id !== 'google-direct' && r.id !== 'openai-direct')
  // Every model has at least the MuAPI fallback (DEFAULT_ROUTES) so the
  // filtered list is never empty in practice — but guard just in case
  // some future model is google-direct-only.
  return filtered.length > 0 ? filtered : DEFAULT_ROUTES
}

// Pick the best route the user actually has a key for.
export function pickRoute(modelName: string, apiKeys: Partial<APIKeys>, preferred?: RouteId): RouteOption | null {
  const options = listRoutes(modelName)
  if (preferred) {
    const found = options.find(o => o.id === preferred)
    if (found && hasKey(found.id, apiKeys)) return found
  }
  for (const opt of options) {
    if (hasKey(opt.id, apiKeys)) return opt
  }
  return null
}

function hasKey(route: RouteId, apiKeys: Partial<APIKeys>): boolean {
  const field = ROUTE_KEY[route]
  return Boolean(apiKeys[field])
}

export function routeRequiresKey(route: RouteId): keyof APIKeys {
  return ROUTE_KEY[route]
}

export function describeRoute(route: RouteId): string {
  switch (route) {
    // User-visible string — white-labeled. Internal RouteId stays 'muapi'.
    case 'muapi': return 'Loometo (one key, all models)'
    case 'openai-direct': return 'OpenAI direct'
    case 'google-direct': return 'Google direct (Gemini API)'
    case 'meshy-direct': return 'Meshy direct'
    case 'replicate': return 'Replicate'
    case 'falai': return 'fal.ai'
  }
}
