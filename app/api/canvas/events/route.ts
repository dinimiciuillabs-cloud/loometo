// GET /api/canvas/events
// Server-Sent Events stream. The browser subscribes once on app mount and
// receives every CanvasOp emitted on the bus in real time. Each message is
// a single newline-delimited JSON payload preceded by `data: `.
//
// Next.js App Router serves this with a streaming Response — keep the
// connection open until the client disconnects.

import { NextRequest } from 'next/server'
import { onOp, type CanvasOp } from '@/lib/canvas/bus'
import { guardLocal } from '@/lib/server/guard'

export const dynamic = 'force-dynamic'  // never cache SSE responses
export const runtime = 'nodejs'         // need full Node APIs for streams

export async function GET(req: NextRequest) {
  const guard = guardLocal(req)
  if (guard) return guard
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send a heartbeat every 25s so proxies don't drop the connection.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': hb\n\n')) } catch { /* closed */ }
      }, 25_000)

      const send = (op: CanvasOp) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(op)}\n\n`))
        } catch { /* client gone */ }
      }
      const unsubscribe = onOp(send)

      // Initial hello so the browser knows the channel is alive.
      controller.enqueue(encoder.encode(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`))

      // Cleanup when the client closes.
      const cleanup = () => {
        clearInterval(heartbeat)
        unsubscribe()
        try { controller.close() } catch { /* already closed */ }
      }
      // ReadableStream doesn't have a built-in cancellation hook here —
      // we rely on the cancel() override below.
      ;(controller as unknown as { __cleanup?: () => void }).__cleanup = cleanup
    },
    cancel() {
      const c = this as unknown as { __cleanup?: () => void }
      c.__cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // disable nginx buffering if any
    },
  })
}
