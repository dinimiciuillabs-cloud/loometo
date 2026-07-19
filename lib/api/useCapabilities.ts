'use client'
import { useEffect, useState } from 'react'
import { loadCapabilities, allModelsSync, type ModelSpec } from './capabilities'

// React hook that ensures the capabilities catalog is loaded once at app
// boot and exposes the list to consumers. Caches in module state — every
// call after the first returns the cached array synchronously.
let bootPromise: Promise<ModelSpec[]> | null = null

export function useCapabilities(): { models: ModelSpec[]; loading: boolean } {
  const [models, setModels] = useState<ModelSpec[]>(() => allModelsSync())
  const [loading, setLoading] = useState(() => allModelsSync().length === 0)

  useEffect(() => {
    if (allModelsSync().length > 0) {
      setLoading(false)
      return
    }
    if (!bootPromise) bootPromise = loadCapabilities()
    let cancelled = false
    bootPromise
      .then(list => {
        if (cancelled) return
        setModels(list)
        setLoading(false)
      })
      .catch(err => {
        // Surface in console; node UIs degrade to "no models available" but app
        // doesn't crash.
        console.error('Failed to load capabilities', err)
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { models, loading }
}
