'use client'
import { useEffect, useState } from 'react'
import { X, Eye, EyeOff, CheckCircle, ExternalLink, FileLock2 } from 'lucide-react'
import { useWorkflowStore } from '@/lib/store/workflowStore'

const API_FIELDS = [
  {
    key: 'muapi',
    label: 'Loometo',
    description: 'Powers video generation (Kling, Veo3, Wan, Sora), upscaling, face swap, relight and more',
    required: true,
    url: 'https://muapi.ai',
    placeholder: 'mu-xxxxxxxxxxxx',
    dot: 'var(--cat-video)',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'Powers image generation (DALL-E 3), prompt enhancement, and LLM nodes',
    required: false,
    url: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-xxxxxxxxxxxx',
    dot: 'var(--cat-image)',
  },
  {
    key: 'google',
    label: 'Google AI',
    description: 'Powers Imagen image generation and Veo video models',
    required: false,
    url: 'https://aistudio.google.com/apikey',
    placeholder: 'AIzaxxxxxxxxxxxx',
    dot: 'var(--cat-edit)',
  },
  {
    key: 'meshy',
    label: 'Meshy',
    description: 'Image → 3D and text → 3D models. Rotate, change camera angle, export GLB.',
    required: false,
    url: 'https://www.meshy.ai/api/keys',
    placeholder: 'msy_xxxxxxxxxxxx',
    dot: 'var(--cat-edit)',
  },
  {
    key: 'figma',
    label: 'Figma PAT',
    description: 'Personal Access Token. Pull frames from Figma files into your canvas as images.',
    required: false,
    url: 'https://www.figma.com/settings#personal-access-tokens',
    placeholder: 'figd_xxxxxxxxxxxx',
    dot: 'var(--cat-text)',
  },
  {
    key: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'High-quality TTS + voice cloning. Free tier available. Used by the Text → Speech node.',
    required: false,
    url: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'sk_xxxxxxxxxxxx',
    dot: 'var(--cat-text)',
  },
]

export default function APIKeysPanel() {
  const { apiKeys, setAPIKeys, setShowAPIPanel } = useWorkflowStore()
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(false)
  // Which keys came from .env (vs typed locally). Drives the "from .env"
  // badge so the user knows where the value originated.
  const [fromEnv, setFromEnv] = useState<Record<string, boolean>>({})

  // On mount, ask the local-only /api/keys endpoint for whatever's set
  // in .env.local and hydrate the store. Typed values that DON'T appear
  // in .env stay intact — env hydration only fills missing fields, never
  // clobbers what the user manually entered.
  useEffect(() => {
    let cancelled = false
    fetch('/api/keys')
      .then(r => r.ok ? r.json() : { ok: false })
      .then(data => {
        if (cancelled || !data.ok) return
        const keys = (data.keys as Record<string, string>) || {}
        const patch: Record<string, string> = {}
        const env: Record<string, boolean> = {}
        for (const [field, value] of Object.entries(keys)) {
          if (value && value.length > 0) {
            patch[field] = value
            env[field] = true
          }
        }
        if (Object.keys(patch).length > 0) setAPIKeys(patch)
        setFromEnv(env)
      })
      .catch(() => { /* offline or 403 — ignore */ })
    return () => { cancelled = true }
  }, [setAPIKeys])

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => { setSaved(false); setShowAPIPanel(false) }, 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(27,24,19,0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-3xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col glass-strong"
        style={{ boxShadow: 'var(--shadow-clay)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--line-soft)]">
          <div>
            <h2 className="font-display text-[var(--ink)] text-xl leading-none">API Keys</h2>
            <p className="text-[var(--ink-mute)] text-[11px] mt-1">
              Loaded from <code className="text-[var(--ink-soft)]">.env.local</code> if present; otherwise saved in your browser only.
            </p>
          </div>
          <button
            onClick={() => setShowAPIPanel(false)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Keys list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin">
          {API_FIELDS.map(field => {
            const val = apiKeys[field.key as keyof typeof apiKeys] || ''
            const hasKey = val.length > 0
            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: field.dot }} />
                    <span className="text-[var(--ink)] text-[13px] font-medium">{field.label}</span>
                    {field.required && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded text-[var(--cat-video)] border border-[var(--cat-video)]/40">Required</span>
                    )}
                    {hasKey && !fromEnv[field.key] && <CheckCircle size={12} className="text-[var(--cat-image)]" />}
                    {fromEnv[field.key] && (
                      <span
                        className="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded-full font-mono uppercase tracking-wider"
                        style={{
                          background: 'color-mix(in srgb, var(--cat-image) 14%, transparent)',
                          color: 'var(--cat-image)',
                        }}
                        title="Loaded from .env.local — change there + restart the dev server"
                      >
                        <FileLock2 size={9} strokeWidth={2.5} />
                        from .env
                      </span>
                    )}
                  </div>
                  <a href={field.url} target="_blank" rel="noopener noreferrer"
                    className="text-[var(--ink-mute)] hover:text-[var(--accent)] transition-colors flex items-center gap-1 text-[10.5px]">
                    Get key <ExternalLink size={10} />
                  </a>
                </div>
                <p className="text-[var(--ink-mute)] text-[11px]">{field.description}</p>
                <div className="relative">
                  <input
                    type={show[field.key] ? 'text' : 'password'}
                    value={val}
                    onChange={e => setAPIKeys({ [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="w-full rounded-full px-4 py-2.5 pr-11 text-[12px] text-[var(--ink)] focus:outline-none placeholder-[var(--ink-faint)] clay-surface-soft border-0"
                    style={{ background: 'var(--bg-surface)' }}
                  />
                  <button
                    onClick={() => setShow(p => ({ ...p, [field.key]: !p[field.key] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    {show[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--line-soft)] flex items-center justify-between">
          <p className="text-[var(--ink-mute)] text-[10.5px]">
            Paste keys here and Save — that&apos;s all you need. Keys never leave your machine. Optional: <code className="text-[var(--ink-soft)]">.env.local</code> works too (needs a dev server restart).
          </p>
          <button
            onClick={handleSave}
            className="clay-press px-5 py-2.5 rounded-full text-[12.5px] font-medium"
            style={{ background: saved ? 'var(--cat-image)' : 'var(--accent)', color: 'var(--bg-surface)' }}
          >
            {saved ? 'Saved' : 'Save Keys'}
          </button>
        </div>
      </div>
    </div>
  )
}
