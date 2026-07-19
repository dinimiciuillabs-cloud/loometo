// POST /api/proxy/fetch-url — server-side page fetch for the URL Import
// node. The browser can't fetch arbitrary sites (CORS), so this route
// pulls the HTML server-side and strips it to readable text.
//
// ponytail: regex-based extraction, no readability dependency. Good
// enough for article/landing pages; upgrade to a parser lib if users
// hit JS-only sites.

import { NextRequest, NextResponse } from 'next/server'
import { guardLocalJson } from '@/lib/server/guard'

export const dynamic = 'force-dynamic'

function isLocalRequest(req: NextRequest): boolean {
  const hostname = (req.headers.get('host') ?? '').split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function meta(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i')
  // content= can also come before property= — try both orders.
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i')
  return html.match(re)?.[1] ?? html.match(re2)?.[1] ?? ''
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

export async function POST(req: NextRequest) {
  const jsonGuard = guardLocalJson(req)
  if (jsonGuard) return jsonGuard
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'localhost only' }, { status: 403 })
  }
  let url: string
  try {
    const body = await req.json()
    url = String(body.url ?? '').trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: 'URL must start with http(s)://' }, { status: 400 })
  }

  let html: string
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        // Plain-browser UA — some sites 403 unknown agents.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Site returned HTTP ${res.status}` }, { status: 502 })
    }
    html = await res.text()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `Fetch failed: ${msg}` }, { status: 502 })
  }

  const title = decodeEntities(
    meta(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '')
  const description = decodeEntities(meta(html, 'og:description') || meta(html, 'description'))

  // Resolve any src to an absolute URL against the page.
  const abs = (src: string): string | null => {
    if (!src || src.startsWith('data:')) return null
    if (src.startsWith('//')) return 'https:' + src
    try { return new URL(src, url).href } catch { return null }
  }

  let image = abs(meta(html, 'og:image')) || undefined

  // Recover every <img> on the page for the asset picker: dedupe, resolve
  // to absolute, drop tracking pixels / sprites. og:image floats first.
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi
  const seen = new Set<string>()
  const images: string[] = []
  if (image) { seen.add(image); images.push(image) }
  let im: RegExpExecArray | null
  while ((im = imgRe.exec(html)) !== null && images.length < 40) {
    const u = abs(im[1])
    if (!u || seen.has(u)) continue
    if (/1x1|pixel|spacer|tracking|blank\.gif|\.svg\?/i.test(u)) continue
    seen.add(u)
    images.push(u)
  }
  // Best-guess logo: an image whose URL or nearby markup mentions "logo".
  const logo = images.find(u => /logo|brand/i.test(u)) || undefined

  // Body text: drop script/style/nav/footer, keep heading + paragraph text.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
  const chunks: string[] = []
  const tagRe = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(cleaned)) !== null && chunks.length < 200) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (text.length > 25) chunks.push(m[1].startsWith('h') ? `## ${text}` : text)
  }
  // Cap so a huge page doesn't blow the LLM context downstream.
  const text = chunks.join('\n').slice(0, 12000)

  if (!title && !text) {
    return NextResponse.json({ ok: false, error: 'Could not extract readable content — the page may be JavaScript-only.' }, { status: 422 })
  }

  return NextResponse.json({ ok: true, url, title, description, image, logo, images, text })
}
