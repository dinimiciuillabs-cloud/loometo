// Figma REST API — pull a frame as a PNG into the canvas.
//
// URL formats supported:
//   https://www.figma.com/design/:fileKey/:fileName?node-id=:nodeId
//   https://www.figma.com/file/:fileKey/:fileName?node-id=:nodeId
//
// nodeId in the URL uses '-' (e.g. 12-345); the API requires ':' (12:345).

const FIGMA_BASE = 'https://api.figma.com/v1'

export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } | null {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean) // ['design'|'file', fileKey, fileName, ...]
    if (parts.length < 2 || (parts[0] !== 'design' && parts[0] !== 'file')) return null
    const fileKey = parts[1]
    const nodeIdRaw = u.searchParams.get('node-id') || u.searchParams.get('nodeId')
    if (!fileKey || !nodeIdRaw) return null
    return { fileKey, nodeId: nodeIdRaw.replace('-', ':') }
  } catch {
    return null
  }
}

export async function fetchFigmaNodeImage(pat: string, fileKey: string, nodeId: string): Promise<string> {
  const res = await fetch(`${FIGMA_BASE}/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`, {
    headers: { 'X-Figma-Token': pat },
  })
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const url = data?.images?.[nodeId]
  if (!url) throw new Error('Figma returned no image for that node — is the file shared with your token?')
  return url
}
