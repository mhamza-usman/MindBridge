import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

const VALID = new Set(['r2b_nominal', 'r2b_stale', 'r2b_conflict', 'r2b_unknown'])

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: { scenario: string } }
) {
  const { scenario } = params
  if (!VALID.has(scenario)) {
    return new Response('Unknown scenario', { status: 404 })
  }

  const filePath = path.join(process.cwd(), 'public', 'replay', `${scenario}.jsonl`)
  let lines: string[]
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
  } catch {
    return new Response('Replay file not found on server', { status: 404 })
  }

  const enc = new TextEncoder()
  let idx = 0

  const stream = new ReadableStream({
    start(ctrl) {
      const iv = setInterval(() => {
        if (idx >= lines.length) {
          ctrl.close()
          clearInterval(iv)
          return
        }
        ctrl.enqueue(enc.encode(`data: ${lines[idx]}\n\n`))
        idx++
      }, 100)

      // Clean up on disconnect
      _req.signal.addEventListener('abort', () => {
        clearInterval(iv)
        try { ctrl.close() } catch { /* ignore */ }
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection':    'keep-alive',
    }
  })
}
