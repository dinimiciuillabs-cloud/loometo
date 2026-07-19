// Browser-entered keys (Settings → API Keys) ride to the localhost
// proxies as an x-user-key header. The proxy prefers .env.local and
// falls back to this header, so pasting a key in the app Just Works
// without a dev server restart. Localhost-only transport either way.

import { useWorkflowStore } from '@/lib/store/workflowStore'

export function userKeyHeader(provider: 'muapi' | 'elevenlabs'): Record<string, string> {
  const key = useWorkflowStore.getState().apiKeys[provider]
  return key ? { 'x-user-key': key } : {}
}
