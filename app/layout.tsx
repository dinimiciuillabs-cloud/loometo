import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Loometo — node-based AI studio for creators',
  description: 'Loometo is a visual canvas where you wire every major AI model into one workflow: image, video, audio, 3D. Bring your own API keys, ship faster.',
  icons: { icon: '/brand/loometo-icon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Google's model-viewer web component — used by the Image → 3D node
            to render interactive GLB previews. ~80 KB, lazy. */}
        <script
          type="module"
          src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js"
          async
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
