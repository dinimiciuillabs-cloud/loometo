// MuAPI client. All calls go through the local /api/proxy/muapi route
// so the API key stays on the server and the browser dodges MuAPI's
// CORS preflight (which doesn't echo our origin). See app/api/proxy/
// muapi/route.ts for the server side.
//
// The `apiKey` argument is kept on the signatures for back-compat with
// existing callers in dispatch.ts but is no longer forwarded — the
// server uses process.env.MUAPI_API_KEY.

import { userKeyHeader } from '@/lib/api/userKeys'

export async function callMuApi(
  _apiKey: string,
  modelSlug: string,
  params: Record<string, unknown>,
) {
  const res = await fetch('/api/proxy/muapi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userKeyHeader('muapi') },
    body: JSON.stringify({ kind: 'generate', slug: modelSlug, params }),
  })
  if (!res.ok) {
    // Surface MuAPI's actual rejection reason instead of bare "HTTP 422".
    // MuAPI's bodies vary:
    //   { detail: [{ msg, loc }] }      ← FastAPI validation errors
    //   { detail: "string message" }
    //   { error: "message" } / { message: "..." }
    //   plain text
    const raw = await res.text()
    let detail = raw.slice(0, 400)
    try {
      const j = JSON.parse(raw)
      if (typeof j.error === 'string') detail = j.error
      else if (typeof j.message === 'string') detail = j.message
      else if (Array.isArray(j.detail)) {
        detail = j.detail.map((d: { loc?: unknown[]; msg?: string }) =>
          `${(d.loc ?? []).join('.')}: ${d.msg}`).join(' · ')
      } else if (typeof j.detail === 'string') detail = j.detail
    } catch { /* keep raw */ }
    throw new Error(`Loometo ${modelSlug} HTTP ${res.status}: ${detail}`)
  }
  return res.json()
}

// Poll a MuAPI request by id. Returns the unwrapped result body
// (the `detail` field of the upstream response, if present).
export async function pollMuApiViaProxy(requestId: string): Promise<unknown> {
  const res = await fetch('/api/proxy/muapi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userKeyHeader('muapi') },
    body: JSON.stringify({ kind: 'poll', requestId }),
  })
  if (!res.ok && res.status !== 400) {
    throw new Error(`Loometo poll failed via proxy: HTTP ${res.status}`)
  }
  return res.json()
}
