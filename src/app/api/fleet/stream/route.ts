import { NextRequest } from 'next/server';
import { createSyntheticFleet } from '../../../../assurance/fleet/syntheticFleet';

/**
 * GET /api/fleet/stream
 *
 * Server-Sent Events endpoint that pushes FleetSnapshot JSON to the client
 * every time the aggregator emits an update.
 *
 * The fleet UI currently uses in-process subscription (same JS heap) which
 * works perfectly for the single-process Cloud Run deployment. This SSE
 * endpoint exposes the same data stream for external consumers (monitoring
 * dashboards, mobile apps, tests) without requiring a WebSocket upgrade.
 *
 * Read-only. Never accepts writes. Never commands a robot.
 */

// Module-level singleton so all SSE clients share the same aggregator state.
let aggregator: ReturnType<typeof createSyntheticFleet> | null = null;
function getAggregator() {
  if (!aggregator) aggregator = createSyntheticFleet();
  return aggregator;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const agg = getAggregator();

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      const send = (data: string) => {
        try {
          controller.enqueue(enc.encode(`data: ${data}\n\n`));
        } catch {
          // client disconnected
        }
      };

      // Push current snapshot immediately on connect
      send(JSON.stringify(agg.getSnapshot()));

      // Subscribe to future updates
      const unsub = agg.subscribe((snap) => {
        send(JSON.stringify(snap));
      });

      // Clean up when the client disconnects
      _req.signal.addEventListener('abort', () => {
        unsub();
        try { controller.close(); } catch { /* ignore */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',       // disable nginx buffering on Cloud Run
      'Connection': 'keep-alive',
    },
  });
}
