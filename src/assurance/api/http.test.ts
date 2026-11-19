/**
 * HTTP-level tests: one real HTTP request per API route against a spawned
 * `next dev` server. Covers the assurance SSE routes end-to-end (route
 * handler -> JSONL file -> SSE bytes on the wire).
 *
 * Requires no build; spawns its own server on an ephemeral port.
 */
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;

async function waitForServer(timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/replay/r2b_nominal`, { signal: AbortSignal.timeout(2000) });
      if (res.status > 0) return; // server is up (SSE stays open; we only need headers)
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('next dev server did not start in time');
}

/** Read the first SSE frame then abort the connection. */
async function firstSseFrame(url: string): Promise<any> {
  const res = await fetch(url);
  assert.strictEqual(res.status, 200, `${url} should return 200`);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/, `${url} should be SSE`);
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value);
  assert.ok(text.startsWith('data: '), `${url} first chunk should be an SSE data frame`);
  return JSON.parse(text.slice(6).trim());
}

async function runTests() {
  console.log('Running HTTP route tests...');

  server = spawn('pnpm', ['exec', 'next', 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  });
  server.stderr?.on('data', () => {});

  try {
    await waitForServer();

    // GET /api/replay/[scenario]
    const frame = await firstSseFrame(`${BASE}/api/replay/r2b_nominal`);
    assert.strictEqual(typeof frame.t, 'number');
    assert.ok(frame.cam_age_ms !== undefined, 'replay frame carries sensor ages');
    const badReplay = await fetch(`${BASE}/api/replay/bogus`);
    assert.strictEqual(badReplay.status, 404, 'unknown replay scenario -> 404');

    // GET /api/telemetry/[scenario]
    const tframe = await firstSseFrame(`${BASE}/api/telemetry/r2b_telemetry`);
    assert.strictEqual(tframe.source, 'r2b_replay_telemetry', 'telemetry labelled replay, not live');
    const badTel = await fetch(`${BASE}/api/telemetry/bogus`);
    assert.strictEqual(badTel.status, 404, 'unknown telemetry scenario -> 404');

    // GET /api/fleet/stream
    const fframe = await firstSseFrame(`${BASE}/api/fleet/stream`);
    assert.strictEqual(fframe.robots.length, 1, 'fleet stream: exactly one real robot');
    assert.strictEqual(fframe.robots[0].robot_id, 'r2b-01');
    assert.strictEqual(fframe.rollout.to_version, 'Not in dataset');

    // CopilotKit runtime routes exist (AG-UI POST endpoints; GET should not 500).
    for (const p of ['/api/copilotkit-pdf', '/api/copilotkit/info']) {
      const res = await fetch(`${BASE}${p}`, { method: 'GET' });
      assert.ok(res.status < 500, `${p} should not server-error (got ${res.status})`);
    }

    console.log('All HTTP route tests passed!');
  } finally {
    server?.kill('SIGTERM');
  }
}

runTests().then(() => process.exit(0)).catch(async (e) => {
  console.error(e);
  server?.kill('SIGTERM');
  process.exit(1);
});
