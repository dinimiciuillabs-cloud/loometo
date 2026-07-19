'use client'
import { useEffect, useState } from 'react'

const MESSAGES = [
  "Hi, I'm Blue. Drag a node from below to start.",
  "Wire two nodes by dragging from one dot to another.",
  "Click the (i) on any node to learn what it does.",
  "Save your API keys in Settings — top right.",
  "Try: Prompt → Text → Image → Output.",
  "Hover any edge to delete it.",
  "Press Delete on a selected node to remove it.",
]

const IDLE_MESSAGES = [
  "Still here.",
  "Click me for a tip.",
  "Try wiring a couple of nodes.",
]

// Blue parks on top of the sidebar search bar.
// His messages render inside the sidebar tip-card below the search,
// not as an overflowing bubble. We export a Provider context so the tip-card
// can pick up his latest message.
//
// Implementation: simple shared event via a small module-level subject.

type Listener = (msg: string | null) => void
const listeners = new Set<Listener>()
function publish(msg: string | null) { listeners.forEach(l => l(msg)) }

export function useBlueMessage() {
  const [msg, setMsg] = useState<string | null>(MESSAGES[0])
  useEffect(() => {
    listeners.add(setMsg)
    return () => { listeners.delete(setMsg) }
  }, [])
  return msg
}

export default function AnimatedMascot() {
  const [msgIndex, setMsgIndex] = useState(0)
  const [bobUp, setBobUp] = useState(false)

  useEffect(() => {
    publish(MESSAGES[0])
    const welcomeTimer = setTimeout(() => publish(null), 6000)
    const idleInterval = setInterval(() => {
      const msgs = Math.random() > 0.5 ? IDLE_MESSAGES : MESSAGES
      const idx = Math.floor(Math.random() * msgs.length)
      publish(msgs[idx])
      setTimeout(() => publish(null), 5500)
    }, 22000)
    const bobInterval = setInterval(() => setBobUp(b => !b), 3000)
    return () => {
      clearTimeout(welcomeTimer)
      clearInterval(idleInterval)
      clearInterval(bobInterval)
    }
  }, [])

  const handleClick = () => {
    const idx = (msgIndex + 1) % MESSAGES.length
    setMsgIndex(idx)
    publish(MESSAGES[idx])
    setTimeout(() => publish(null), 5500)
  }

  return (
    <div
      className="absolute pointer-events-none select-none"
      style={{
        // Perch top-right, clear of the tip bubble (whose tail is anchored
        // bottom-left) and above it in z so Blue is never swallowed.
        top: -40,
        right: 12,
        zIndex: 30,
      }}
    >
      <div
        className="pointer-events-auto cursor-pointer"
        onClick={handleClick}
        style={{
          width: 46,
          height: 42,
          transform: `translateY(${bobUp ? -1 : 0}px)`,
          transition: 'transform 1.6s ease-in-out',
        }}
        title="Click me for a tip"
      >
        <svg viewBox="0 0 46 42" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.18))' }}>
          {/* Sitting body / haunches */}
          <ellipse cx="24" cy="34" rx="11" ry="7" fill="#D4B896" />
          <ellipse cx="24" cy="36" rx="7" ry="4" fill="#E8D5B0" />
          {/* Tail curl on the right */}
          <path d="M 34 31 Q 38 28 36 25 Q 34 24 36 23" stroke="#A88E66" strokeWidth="2" strokeLinecap="round" fill="none" />
          {/* Head */}
          <ellipse cx="17" cy="19" rx="11" ry="10" fill="#D4B896" />
          {/* Black face mask */}
          <ellipse cx="17" cy="22" rx="8.5" ry="7" fill="#3A2E25" />
          <ellipse cx="17" cy="25" rx="4.5" ry="3" fill="#2A2018" />
          {/* Floppy ears */}
          <ellipse cx="8" cy="14" rx="3" ry="4.5" fill="#3A2E25" transform="rotate(-25 8 14)" />
          <ellipse cx="26" cy="14" rx="3" ry="4.5" fill="#3A2E25" transform="rotate(25 26 14)" />
          {/* Forehead wrinkles */}
          <path d="M 13.5 14 Q 17 12.5 20.5 14" stroke="#A88E66" strokeWidth="1" strokeLinecap="round" fill="none" />
          <path d="M 14 17 Q 17 15.5 20 17" stroke="#A88E66" strokeWidth="1" strokeLinecap="round" fill="none" />
          {/* Eyes */}
          <circle cx="13" cy="19" r="1.9" fill="#1A1612" />
          <circle cx="21" cy="19" r="1.9" fill="#1A1612" />
          <circle cx="13.6" cy="18.4" r="0.55" fill="white" />
          <circle cx="21.6" cy="18.4" r="0.55" fill="white" />
          {/* Tiny nose */}
          <ellipse cx="17" cy="23.5" rx="1.3" ry="0.9" fill="#1A1612" />
          {/* Smile */}
          <path d="M 14.5 26.5 Q 17 28 19.5 26.5" stroke="#1A1612" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          {/* Front paws resting on the search bar edge */}
          <ellipse cx="13" cy="40.5" rx="2.6" ry="1.8" fill="#D4B896" />
          <ellipse cx="21" cy="40.5" rx="2.6" ry="1.8" fill="#D4B896" />
        </svg>
      </div>
    </div>
  )
}
