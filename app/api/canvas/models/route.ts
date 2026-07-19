// GET /api/canvas/models?category=Text%20to%20Video
//   → returns the model list for the given category (or all if omitted)
//     so external callers (Claude Code) can pick a real slug without
//     having to fetch and parse the 638KB schema themselves.

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { guardLocal } from '@/lib/server/guard'

interface RawModel {
  name: string
  category: string
  variant: string
  family: string
  description: string
  input_schema?: { schemas?: { input_data?: { properties?: Record<string, unknown> } } }
}

let cache: RawModel[] | null = null

async function load(): Promise<RawModel[]> {
  if (cache) return cache
  const fp = path.join(process.cwd(), 'public', 'muapi-schema.json')
  const raw = await readFile(fp, 'utf8')
  cache = JSON.parse(raw) as RawModel[]
  return cache
}

export async function GET(req: NextRequest) {
  const guard = guardLocal(req)
  if (guard) return guard
  const category = req.nextUrl.searchParams.get('category') ?? undefined
  const family = req.nextUrl.searchParams.get('family') ?? undefined
  const search = req.nextUrl.searchParams.get('q')?.toLowerCase() ?? undefined

  const all = await load()
  const filtered = all.filter(m => {
    if (category && m.category !== category) return false
    if (family && m.family !== family) return false
    if (search) {
      const hay = `${m.name} ${m.variant} ${m.family} ${m.description}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })

  // Return a compact shape — full schemas would be huge. Include params so
  // the caller can build a valid payload.
  const compact = filtered.map(m => ({
    name: m.name,
    category: m.category,
    variant: m.variant,
    family: m.family,
    description: m.description,
    params: m.input_schema?.schemas?.input_data?.properties ?? {},
  }))
  return NextResponse.json({ count: compact.length, models: compact })
}
