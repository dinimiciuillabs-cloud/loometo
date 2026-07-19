/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app renders media with plain <img>/<video> tags (model outputs are
  // arbitrary provider URLs), so Next's image optimizer endpoint is unused.
  // Disabling it removes the /_next/image attack surface entirely (DoS,
  // cache-confusion, and content-injection advisories all target it).
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // Demo route: explicitly iframe-embeddable from any origin so the
        // marketing site can drop it in. Everything else stays default
        // (SAMEORIGIN, set by Next.js out of the box).
        source: '/demo/:path*',
        headers: [
          // Override the default X-Frame-Options: SAMEORIGIN by REMOVING
          // it (we ship a CSP frame-ancestors instead, which is the
          // modern equivalent and lets us scope which origins are
          // allowed to embed). Removing means we set an empty value —
          // Next.js skips writing the header.
          //
          // Some browsers cache X-Frame-Options aggressively; CSP
          // frame-ancestors is the source of truth for modern browsers.
          {
            key: 'Content-Security-Policy',
            // Allows ANY origin to embed the demo. If you self-host and
            // want to restrict embedding, tighten to e.g.
            // `frame-ancestors 'self' https://your-site.com;`
            value: "frame-ancestors *;",
          },
          // Allow embedding-related cross-origin policies so the iframe
          // can fetch /demos/<slug>.json from the same origin.
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
        ],
      },
      {
        // The demo JSON files themselves — also embeddable, cacheable.
        source: '/demos/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
