// Thin client wrapper around /api/proxy/r2. Hands a data: URL (or a
// remote http(s) URL) to the server, which signs an S3 V4 PUT against
// Cloudflare R2 and returns a public r2.dev URL. Use this for any
// generated media you want to persist beyond IndexedDB.

export interface R2UploadResult {
  url: string
  key: string
  size: number
  contentType: string
}

/**
 * Upload a data: or http(s) URL to R2.
 *
 * @param source    A data:* URL or remote http(s) URL.
 * @param opts.prefix  Optional path prefix, e.g. "wf-<name>/<nodeId>". Falls
 *                     back to "misc" if omitted.
 * @param opts.key  Optional exact object key. If given, prefix is ignored.
 */
export async function uploadToR2(
  source: string,
  opts: { prefix?: string; key?: string } = {},
): Promise<R2UploadResult> {
  const res = await fetch('/api/proxy/r2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, prefix: opts.prefix, key: opts.key }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || `R2 upload failed: HTTP ${res.status}`)
  return json as R2UploadResult
}

/**
 * Ping the proxy to confirm env vars are wired before relying on uploads.
 * Useful for a settings-page health check.
 */
export async function r2HealthCheck(): Promise<{
  ok: boolean; bucket: string | null; publicBase: string | null; hasCreds: boolean
}> {
  const res = await fetch('/api/proxy/r2', { method: 'GET' })
  return res.json()
}
