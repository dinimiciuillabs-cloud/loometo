/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Bound to CSS variables so dark mode just works
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        panel: 'var(--bg-panel)',
        elevated: 'var(--bg-elevated)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        'ink-mute': 'var(--ink-mute)',
        'ink-faint': 'var(--ink-faint)',
        line: 'var(--line)',
        'line-soft': 'var(--line-soft)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-tint': 'var(--accent-tint)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
    },
  },
  plugins: [],
}
