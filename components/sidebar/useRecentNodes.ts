'use client'
import { useCallback, useEffect, useState } from 'react'

// Track which node TYPES the user has added recently so the sidebar can
// surface them at the top. Lives in localStorage so it survives reloads.
// Capped at 8 — beyond that the section gets visually noisy.

const KEY = 'loometo:recentNodeTypes'
const CAP = 5

function read(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string').slice(0, CAP) : []
  } catch { return [] }
}

export function useRecentNodes() {
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => { setRecent(read()) }, [])

  const record = useCallback((type: string) => {
    setRecent(prev => {
      const next = [type, ...prev.filter(t => t !== type)].slice(0, CAP)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const clear = useCallback(() => {
    try { localStorage.removeItem(KEY) } catch {}
    setRecent([])
  }, [])

  return { recent, record, clear }
}
