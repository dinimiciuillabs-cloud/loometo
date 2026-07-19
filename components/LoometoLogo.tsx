'use client'

// Loometo brand mark — wordmark only.
export default function LoometoLogo() {
  return (
    <div
      role="img"
      aria-label="Loometo"
      style={{
        width: 170,
        height: 42,
        backgroundImage: 'url(/brand/loometo-wordmark.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}
