import assert from 'node:assert';

/**
 * API route tests. Routes are exercised directly (no HTTP server) by calling
 * their GET handlers with mock requests.
 */

async function readFirstChunk(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

async function runTests() {
  console.log('Running API route tests...');

  const mockReq = () => ({ signal: new AbortController().signal }) as any;
  const params = (scenario: string) => ({ params: Promise.resolve({ scenario }) }) as any;

  // --- replay route ---
  const { GET: replayGET } = await import('../../app/api/replay/[scenario]/route');
  const ok = await replayGET(mockReq(), params('r2b_nominal'));
  assert.strictEqual(ok.status, 200);
  assert.match(ok.headers.get('content-type') ?? '', /text\/event-stream/);
  const chunk = await readFirstChunk(ok);
  assert.ok(chunk.startsWith('data: '), 'SSE frame expected');
  const frame = JSON.parse(chunk.slice(6).trim());
  assert.strictEqual(typeof frame.t, 'number');
  assert.ok(frame.cam_age_ms !== undefined, 'replay line should carry sensor ages');

  const bad = await replayGET(mockReq(), params('nonexistent'));
  assert.strictEqual(bad.status, 404);

  // --- telemetry route ---
  const { GET: telGET } = await import('../../app/api/telemetry/[scenario]/route');
  const tok = await telGET(mockReq(), params('r2b_telemetry'));
  assert.strictEqual(tok.status, 200);
  const tchunk = await readFirstChunk(tok);
  const tframe = JSON.parse(tchunk.slice(6).trim());
  assert.strictEqual(tframe.source, 'r2b_replay_telemetry', 'telemetry must be labelled replay, not live');

  const tbad = await telGET(mockReq(), params('bogus'));
  assert.strictEqual(tbad.status, 404);

  // --- fleet route: one real robot, honest rollout fields ---
  const { GET: fleetGET } = await import('../../app/api/fleet/stream/route');
  const fres = await fleetGET(mockReq() as any);
  assert.strictEqual(fres.status, 200);
  const fchunk = await readFirstChunk(fres);
  const snap = JSON.parse(fchunk.slice(6).trim());
  assert.strictEqual(snap.robots.length, 1, 'dataset has exactly one robot');
  assert.strictEqual(snap.robots[0].robot_id, 'r2b-01');
  assert.strictEqual(snap.rollout.to_version, 'Not in dataset');
  assert.strictEqual(snap.rollout.from_version, 'Not in dataset');

  console.log('All API route tests passed!');
  // The fleet pump holds a setInterval; exit explicitly so the test process ends.
  process.exit(0);
}

runTests().catch((e) => { console.error(e); process.exit(1); });
