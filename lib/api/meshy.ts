// Meshy v2 API — image-to-3D and text-to-3D, with GLB / FBX / OBJ outputs.
// Browser-direct calls work because Meshy ships permissive CORS.
//
// The API is asynchronous: POST creates a task, then we poll GET until status
// is SUCCEEDED. We expose a single `generate3D` that returns once the model
// asset is ready (or throws on failure / timeout).

const MESHY_BASE = 'https://api.meshy.ai/v2'

export const MESHY_MODELS = [
  { id: 'meshy-4',          name: 'Meshy 4',          description: 'Best 3D quality', cost: '$$$' },
  { id: 'meshy-4-fast',     name: 'Meshy 4 Fast',     description: 'Faster, slightly lower quality', cost: '$$' },
]

interface MeshyTask {
  id: string
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'
  model_urls?: {
    glb?: string
    fbx?: string
    obj?: string
    usdz?: string
  }
  thumbnail_url?: string
  task_error?: { message?: string }
}

async function meshyFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MESHY_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    throw new Error(`Meshy ${res.status}: ${errorBody || res.statusText}`)
  }
  return res.json()
}

async function pollUntilDone(apiKey: string, taskId: string, endpoint: 'image-to-3d' | 'text-to-3d', timeoutMs = 600_000): Promise<MeshyTask> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await meshyFetch<MeshyTask>(apiKey, `/${endpoint}/${taskId}`)
    if (task.status === 'SUCCEEDED') return task
    if (task.status === 'FAILED') throw new Error(task.task_error?.message || 'Meshy task failed')
    await new Promise(r => setTimeout(r, 5_000))
  }
  throw new Error('Meshy task timed out after 10 minutes')
}

export async function generateImageTo3D(apiKey: string, params: {
  imageUrl: string
  model?: string
}): Promise<{ glbUrl?: string; thumbnailUrl?: string; raw: MeshyTask }> {
  // Meshy image-to-3D needs the image as a URL or a data URL. We accept either.
  const created = await meshyFetch<{ result: string }>(apiKey, '/image-to-3d', {
    method: 'POST',
    body: JSON.stringify({
      image_url: params.imageUrl,
      ai_model: params.model || 'meshy-4',
      enable_pbr: true,
    }),
  })
  const task = await pollUntilDone(apiKey, created.result, 'image-to-3d')
  return {
    glbUrl: task.model_urls?.glb,
    thumbnailUrl: task.thumbnail_url,
    raw: task,
  }
}

export async function generateTextTo3D(apiKey: string, params: {
  prompt: string
  model?: string
}): Promise<{ glbUrl?: string; thumbnailUrl?: string; raw: MeshyTask }> {
  const created = await meshyFetch<{ result: string }>(apiKey, '/text-to-3d', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'preview',
      prompt: params.prompt,
      ai_model: params.model || 'meshy-4',
      art_style: 'realistic',
    }),
  })
  const task = await pollUntilDone(apiKey, created.result, 'text-to-3d')
  return {
    glbUrl: task.model_urls?.glb,
    thumbnailUrl: task.thumbnail_url,
    raw: task,
  }
}
