import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReplayFleet, REPLAY_ROBOT_ID, NOT_IN_DATASET } from '../../../../assurance/fleet/replayFleet';
import { replayLineToSnapshot } from '../../../../assurance/sources/replay';
import { AssuranceState } from '../../../../assurance/domain/types';

/**
 * GET /api/fleet/stream
 *
 * Server-Sent Events endpoint that pushes FleetSnapshot JSON to the client.
 * Backed by the single real robot in the r2b replay data — the dataset has no
 * multi-robot fleet, so the snapshot carries exactly one robot and rollout
 * fields are "Not in dataset".
 *
 * Read-only. Never accepts writes. Never commands a robot.
 */

const VALID_STATES: AssuranceState[] = ['Autonomous', 'Degraded', 'Supervised', 'Unknown', 'Blocked'];

let aggregator: ReturnType<typeof createReplayFleet> | null = null;
let pumpStarted = false;

function getAggregator() {
  if (!aggregator) {
    aggregator = createReplayFleet();
    startPump(aggregator);
  }
  return aggregator;
}

function startPump(agg: ReturnType<typeof createReplayFleet>) {
  if (pumpStarted) return;
  pumpStarted = true;

  let lines: any[] = [];
  try {
    const raw = readFileSync(join(process.cwd(), 'public/replay/r2b_nominal.jsonl'), 'utf8');
    lines = raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  } catch {
    // No replay file: fleet stays at the registered robot's initial state.
    return;
  }

  let idx = 0;
  setInterval(() => {
    const line = lines[idx % lines.length];
    idx += 1;
    const state = VALID_STATES.includes(line?.state) ? line.state : 'Unknown';
    agg.updateRobotState(REPLAY_ROBOT_ID, state, replayLineToSnapshot(line), NOT_IN_DATASET);
  }, 100);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const agg = getAggregator();
  let unsub: (() => void) | undefined;

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

      send(JSON.stringify(agg.getSnapshot()));

      unsub = agg.subscribe((snap) => {
        send(JSON.stringify(snap));
      });

      _req.signal.addEventListener('abort', () => {
        unsub?.();
        try { controller.close(); } catch { /* ignore */ }
      });
    },
    cancel() {
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  });
}
