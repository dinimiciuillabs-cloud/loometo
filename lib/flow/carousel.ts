// Carousel slide renderer — programmatic 1080×1350 (4:5) PNG slides via
// offscreen canvas. Text stays crisp and rendering is free, unlike
// image-gen which mangles text and costs per slide.

export interface CarouselSlide {
  kind: 'hook' | 'point' | 'cta'
  title: string
  body?: string
}

export interface CarouselStyle {
  brandColor: string   // slide background
  textColor: string    // title + body
  accentColor: string  // tick bars, ghost numbers, CTA pill
  handle: string       // footer @handle, optional
}

export interface CarouselAssets {
  logo?: HTMLImageElement       // drawn top-right on every slide
  bg?: HTMLImageElement         // hook-slide background, dimmed under text
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    // Cross-origin assets (site logos, CDN refs) that don't send
    // Access-Control-Allow-Origin get BLOCKED by the browser because we
    // request crossOrigin='anonymous' — the load fails and the logo/theme
    // silently drops (this is exactly why an SVG site-logo never appears).
    // Route them through the same-origin byte proxy so the image loads AND
    // the canvas stays untainted (toDataURL / getImageData keep working).
    // ponytail: proxy only genuinely cross-origin http(s); data/blob/same-origin pass through.
    let src = url
    if (/^https?:\/\//i.test(url) && typeof window !== 'undefined' && !url.startsWith(window.location.origin)) {
      src = `/api/proxy/fetch?url=${encodeURIComponent(url)}`
    }
    img.src = src
  })
}

// Draw a logo onto an already-rendered slide (top-right, 72px tall) and
// return a fresh PNG. Used AFTER the AI-enhance pass so the logo is always
// crisp and present — the image model can't mangle or drop it.
export async function compositeLogo(slideUrl: string, logo: HTMLImageElement): Promise<string> {
  const base = await loadImage(slideUrl)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(base, 0, 0, W, H)
  const lh = 72
  const lw = logo.width * (lh / logo.height)
  ctx.drawImage(logo, W - PAD - lw, PAD - 10, lw, lh)
  return canvas.toDataURL('image/png')
}

const W = 1080
const H = 1350
const PAD = 100

// Pull the dominant + a bright accent color from a brand image so the
// carousel matches the site instead of using generic defaults. Returns
// hex for background (darkened dominant), text (auto contrast), accent
// (the most saturated pixel). Deterministic — samples on a small grid.
export function sampleBrandTheme(img: HTMLImageElement): { brandColor: string; textColor: string; accentColor: string } {
  const c = document.createElement('canvas')
  const S = 48
  c.width = S; c.height = S
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, S, S)
  const px = ctx.getImageData(0, 0, S, S).data
  let rs = 0, gs = 0, bs = 0, n = 0
  let bestSat = -1, ar = 234, ag = 88, ab = 12   // fallback = Loometo orange
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3]
    if (a < 128) continue
    rs += r; gs += g; bs += b; n++
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (sat > bestSat && mx > 90) { bestSat = sat; ar = r; ag = g; ab = b }
  }
  if (n === 0) return { brandColor: '#1B1813', textColor: '#FBFAF6', accentColor: '#EA580C' }
  let r = rs / n, g = gs / n, b = bs / n
  // Darken the dominant color for a legible slide background.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const k = lum > 0.5 ? 0.22 : 0.9      // pull light brands down to a dark bg
  r *= k; g *= k; b *= k
  const hex = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')
  const brandColor = `#${hex(r)}${hex(g)}${hex(b)}`
  const bgLum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const textColor = bgLum > 0.5 ? '#111111' : '#FBFAF6'
  return { brandColor, textColor, accentColor: `#${hex(ar)}${hex(ag)}${hex(ab)}` }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = probe
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawFooter(ctx: CanvasRenderingContext2D, style: CarouselStyle, index: number, total: number) {
  const font = '"Plus Jakarta Sans", sans-serif'
  ctx.globalAlpha = 0.65
  ctx.fillStyle = style.textColor
  ctx.font = `600 34px ${font}`
  if (style.handle) ctx.fillText(style.handle, PAD, H - PAD - 20)
  if (index < total - 1) {
    // Swipe cue — accent circle with arrow.
    ctx.globalAlpha = 1
    ctx.fillStyle = style.accentColor
    ctx.beginPath()
    ctx.arc(W - PAD - 36, H - PAD - 4, 44, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = style.brandColor
    ctx.font = `800 44px ${font}`
    ctx.textAlign = 'center'
    ctx.fillText('→', W - PAD - 36, H - PAD - 26)
    ctx.textAlign = 'left'
  }
  ctx.globalAlpha = 1
}

export function renderSlide(
  slide: CarouselSlide,
  index: number,
  total: number,
  style: CarouselStyle,
  assets: CarouselAssets = {},
): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const font = '"Plus Jakarta Sans", sans-serif'

  ctx.fillStyle = style.brandColor
  ctx.fillRect(0, 0, W, H)

  // Hook slide gets the reference image as a dimmed cover background —
  // text stays readable through the brand-color scrim.
  if (slide.kind === 'hook' && assets.bg) {
    const img = assets.bg
    const scale = Math.max(W / img.width, H / img.height)
    const dw = img.width * scale, dh = img.height * scale
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
    ctx.fillStyle = style.brandColor
    ctx.globalAlpha = 0.78
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
  }

  // Logo top-right on every slide, capped at 72px tall.
  if (assets.logo) {
    const lh = 72
    const lw = assets.logo.width * (lh / assets.logo.height)
    ctx.drawImage(assets.logo, W - PAD - lw, PAD - 10, lw, lh)
  }

  ctx.textBaseline = 'top'

  const bodyText = (slide.body ?? '').trim()

  if (slide.kind === 'hook') {
    // Accent tick bar top-left, then a huge title low-anchored.
    ctx.fillStyle = style.accentColor
    ctx.fillRect(PAD, PAD, 140, 18)

    ctx.fillStyle = style.textColor
    ctx.font = `800 118px ${font}`
    const lines = wrap(ctx, slide.title, W - PAD * 2)
    const lineH = 118 * 1.12
    let y = H * 0.34
    for (const line of lines) { ctx.fillText(line, PAD, y); y += lineH }

    if (bodyText) {
      y += 36
      ctx.font = `500 46px ${font}`
      ctx.globalAlpha = 0.8
      for (const line of wrap(ctx, bodyText, W - PAD * 2)) { ctx.fillText(line, PAD, y); y += 64 }
      ctx.globalAlpha = 1
    }
  } else if (slide.kind === 'cta') {
    // Centered title + accent pill button.
    ctx.fillStyle = style.textColor
    ctx.font = `800 96px ${font}`
    ctx.textAlign = 'center'
    const lines = wrap(ctx, slide.title, W - PAD * 2)
    const lineH = 96 * 1.14
    let y = H / 2 - (lines.length * lineH) / 2 - 80
    for (const line of lines) { ctx.fillText(line, W / 2, y); y += lineH }

    if (bodyText) {
      y += 48
      const pillFont = `700 46px ${font}`
      ctx.font = pillFont
      const tw = Math.min(ctx.measureText(bodyText).width, W - PAD * 2)
      const pw = tw + 120, ph = 118
      ctx.fillStyle = style.accentColor
      ctx.beginPath()
      ctx.roundRect((W - pw) / 2, y, pw, ph, ph / 2)
      ctx.fill()
      ctx.fillStyle = style.brandColor
      ctx.fillText(bodyText, W / 2, y + (ph - 46) / 2 - 4)
    }
    ctx.textAlign = 'left'
  } else {
    // Point slide — oversized ghost number, accent tick, title + body.
    ctx.fillStyle = style.accentColor
    ctx.globalAlpha = 0.16
    ctx.font = `800 420px ${font}`
    ctx.textAlign = 'right'
    ctx.fillText(String(index), W - 40, -60)
    ctx.textAlign = 'left'
    ctx.globalAlpha = 1

    ctx.fillStyle = style.accentColor
    ctx.fillRect(PAD, H * 0.3, 90, 14)

    ctx.fillStyle = style.textColor
    ctx.font = `800 82px ${font}`
    const lines = wrap(ctx, slide.title, W - PAD * 2)
    const lineH = 82 * 1.15
    let y = H * 0.3 + 70
    for (const line of lines) { ctx.fillText(line, PAD, y); y += lineH }

    if (bodyText) {
      y += 34
      ctx.font = `500 46px ${font}`
      ctx.globalAlpha = 0.8
      for (const line of wrap(ctx, bodyText, W - PAD * 2)) { ctx.fillText(line, PAD, y); y += 66 }
      ctx.globalAlpha = 1
    }

    // Slide counter top-left.
    ctx.font = `700 34px ${font}`
    ctx.fillStyle = style.accentColor
    ctx.fillText(`${index + 1} / ${total}`, PAD, PAD)
  }

  drawFooter(ctx, style, index, total)
  return canvas.toDataURL('image/png')
}
