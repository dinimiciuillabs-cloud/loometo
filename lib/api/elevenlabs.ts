// ElevenLabs client. Browser → /api/proxy/elevenlabs → ElevenLabs.
// Auth happens server-side; the browser never touches the key.

// Built-in premade voice IDs (free tier). These are stable across
// every ElevenLabs account — no need to fetch /voices for a basic
// dropdown. Custom cloned voices can be discovered via fetchVoices().
import { userKeyHeader } from '@/lib/api/userKeys'

export const ELEVENLABS_PREMADE_VOICES: Array<{ id: string; name: string; description: string }> = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel',  description: 'Calm, warm female narrator. Great for content / explainer voiceover.' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',    description: 'Strong, confident female. Energetic delivery.' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',   description: 'Soft, friendly female. Conversational UGC tone.' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni',  description: 'Well-rounded male narrator. Versatile.' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli',    description: 'Emotional, expressive young female.' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',    description: 'Deep, warm male. Trustworthy narrator.' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold',  description: 'Crisp, confident male. Punchy delivery.' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',    description: 'Deep, gravelly male. Authoritative narrator.' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam',     description: 'Casual, raspy male. Approachable UGC tone.' },
]

// Available models. eleven_multilingual_v2 is the quality default;
// eleven_turbo_v2_5 is faster + cheaper but slightly lower quality.
// eleven_flash_v2_5 is fastest for real-time use.
export const ELEVENLABS_MODELS: Array<{ id: string; name: string; description: string }> = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: 'Highest quality. Supports 29 languages. Default choice for narration.' },
  { id: 'eleven_turbo_v2_5',      name: 'Turbo v2.5',      description: 'Faster + cheaper than Multilingual. Good for iterative drafts.' },
  { id: 'eleven_flash_v2_5',      name: 'Flash v2.5',      description: 'Fastest, lowest latency. For real-time / live use.' },
]

export interface ElevenLabsTTSParams {
  text: string
  voiceId: string
  modelId?: string                                  // defaults to eleven_multilingual_v2
  // ElevenLabs voice settings — fine-tune the delivery
  voiceSettings?: {
    stability?: number                              // 0-1: 0 = expressive/variable, 1 = stable/monotone
    similarity_boost?: number                       // 0-1: higher = closer to original voice (esp. for clones)
    style?: number                                  // 0-1: style exaggeration (v2 models)
    use_speaker_boost?: boolean
  }
}

// TTS → returns { url } where url is a blob: URL for in-browser playback.
// The blob is created from the audio/mpeg bytes the proxy streams back.
// Caller is responsible for URL.revokeObjectURL when done (typically
// the Output / Audio node handles this on unmount).
export async function ttsElevenLabs(_apiKey: string, params: ElevenLabsTTSParams): Promise<{ url: string; raw: Blob }> {
  const res = await fetch('/api/proxy/elevenlabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userKeyHeader('elevenlabs') },
    body: JSON.stringify({
      kind: 'tts',
      voiceId: params.voiceId,
      text: params.text,
      modelId: params.modelId ?? 'eleven_multilingual_v2',
      voiceSettings: params.voiceSettings,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `ElevenLabs TTS failed: HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  return { url, raw: blob }
}

// Fetch the account's full voice library (premade + cloned). Used by
// the TTS node to populate the voice dropdown with the user's own
// cloned voices alongside the premade list.
export interface ElevenLabsVoice {
  voice_id: string
  name: string
  description?: string
  category?: string  // 'premade' | 'cloned' | 'generated' | 'professional'
  labels?: Record<string, string>
}

export async function fetchElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  const res = await fetch('/api/proxy/elevenlabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userKeyHeader('elevenlabs') },
    body: JSON.stringify({ kind: 'voices' }),
  })
  if (!res.ok) throw new Error(`fetchElevenLabsVoices failed: HTTP ${res.status}`)
  const data = await res.json() as { voices?: ElevenLabsVoice[] }
  return data.voices ?? []
}

// Clone a voice from one or more audio samples. ElevenLabs needs
// 30+ seconds of clean speech for a good clone; more is better.
// Returns the new voice_id which the caller can then pass to tts().
export async function cloneVoiceElevenLabs(params: {
  name: string
  description?: string
  // audio sources can be data: URLs or http(s) URLs. We convert to
  // base64 on the way out so the proxy can multipart-upload them.
  audioUrls: string[]
}): Promise<{ voice_id: string }> {
  const files: Array<{ data: string; mime: string; filename: string }> = []
  for (let i = 0; i < params.audioUrls.length; i++) {
    const src = params.audioUrls[i]
    let blob: Blob
    if (src.startsWith('data:')) {
      blob = await (await fetch(src)).blob()
    } else {
      // Route remote URLs through our fetch proxy to bypass CORS.
      const fetchTarget = `/api/proxy/fetch?url=${encodeURIComponent(src)}`
      blob = await (await fetch(fetchTarget)).blob()
    }
    const buf = await blob.arrayBuffer()
    // Chunked base64 — String.fromCharCode(...new Uint8Array(buf)) can
    // overflow the call stack on large audio files, and the spread
    // also needs downlevelIteration. Build the binary string in 8KB
    // slices instead.
    const bytes = new Uint8Array(buf)
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    }
    const data = btoa(bin)
    files.push({
      data,
      mime: blob.type || 'audio/mpeg',
      filename: `sample-${i + 1}.mp3`,
    })
  }
  const res = await fetch('/api/proxy/elevenlabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...userKeyHeader('elevenlabs') },
    body: JSON.stringify({
      kind: 'clone',
      name: params.name,
      description: params.description,
      files,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Voice clone failed: HTTP ${res.status}`)
  }
  return res.json()
}
