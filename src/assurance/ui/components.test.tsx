/**
 * Component-level tests: AssuranceShell contract view + alert click-through,
 * and CameraWall focus mode. Runs under jsdom with a stubbed EventSource so
 * tests push real JSONL frames through the same code path as the SSE stream.
 */
import './test-dom';
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { FakeEventSource } from './test-dom';
import fs from 'node:fs';
import path from 'node:path';

const NOMINAL_LINE = {
  t: 1.0, source: 'replay_r2b_2023',
  cam_age_ms: 50, lidar_age_ms: 50, tf_age_ms: 0, cam_rate_hz: 30,
  saturated_px_pct: 0, glare_detected: false, sensors_agree: true,
  perception_pct: 95, uncertainty_pct: 5, state: 'Autonomous',
  cam_violated: false, lidar_violated: false
};

const STALE_LINE = { ...NOMINAL_LINE, t: 2.0, cam_age_ms: 9999, cam_violated: true };

const SIX_CAM_LINE = {
  t: 1, source: 'r2b_replay_telemetry', cam_age_ms: 50, lidar_age_ms: 50,
  cam_rate: 30, lidar_rate: 10,
  cameras: Object.fromEntries([
    'hawk_0_left_rgb_image', 'hawk_0_right_rgb_image', 'd455_1_rgb_image',
    'd455_1_depth_image', 'd455_1_left_ir_image', 'd455_1_right_ir_image'
  ].map((k) => [k, { width: 640, height: 480, has_image: false }])),
  lidar: { points: [], num_points: 0, has_lidar: false },
  imu: { has_imu: false }
};

function replayES(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) => i.url.includes('/api/replay/'));
  if (!es) throw new Error('replay EventSource not created');
  return es;
}
function telemetryES(): FakeEventSource {
  const es = FakeEventSource.instances.find((i) => i.url.includes('/api/telemetry/'));
  if (!es) throw new Error('telemetry EventSource not created');
  return es;
}

async function runTests() {
  console.log('Running component tests...');

  // --- AssuranceShell: contract view + alert click-through ---
  const AssuranceShell = (await import('./AssuranceShell')).default;
  FakeEventSource.reset();
  const shell = render(<AssuranceShell />);

  // Push one healthy frame so evidence/state populate.
  await act(async () => { replayES().push(NOMINAL_LINE); });

  // Contract view: dock button labelled "Contract".
  const contractBtn = screen.getByText('Contract');
  fireEvent.click(contractBtn);
  expect_text('Autonomy contract: warehouse_navigation');
  // Not-in-dataset assumptions must be labelled, not fabricated.
  expect_text('Not in dataset');
  expect_text('Localization std dev');

  // Back to evidence view and trigger an alert with a stale camera frame.
  fireEvent.click(screen.getByText('Evidence'));
  await act(async () => { replayES().push(STALE_LINE); });

  // Alert renders with actual value vs limit info, then click-through to contract.
  // The alert card is the clickable div (cursor:pointer) containing the rule name.
  let alertCard: HTMLElement | null = null;
  for (let i = 0; i < 50 && !alertCard; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    alertCard = Array.from(document.querySelectorAll<HTMLElement>('div[style*="cursor: pointer"]'))
      .find((d) => d.textContent?.includes('Camera freshness')) ?? null;
  }
  assert(alertCard, 'stale-camera alert card must render');
  assert(alertCard!.textContent!.includes('9999'), 'alert must show the actual stale value');
  fireEvent.click(alertCard!);

  // After click-through we should be on the contract view with the failing row highlighted.
  const camRow = Array.from(document.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Camera freshness'));
  assert(camRow, 'contract table must contain Camera freshness row');
  assert(
    /196,\s*22,\s*42/.test((camRow as HTMLElement).style.background),
    'failing contract row must be highlighted after alert click-through'
  );
  const statusCell = camRow!.querySelectorAll('td')[3];
  assert(/Violated|No data/.test(statusCell?.textContent ?? ''), 'stale camera row must show violated/no-data status');

  cleanup();
  FakeEventSource.reset();

  // --- CameraWall: all six topics + focus mode ---
  const CameraWall = (await import('./CameraWall')).default;
  render(<CameraWall sseUrl="/api/telemetry/r2b_telemetry" onBack={() => {}} />);
  await act(async () => { telemetryES().push(SIX_CAM_LINE); });

  assert(document.body.textContent?.includes('Cameras in dataset: 6'), 'expected 6 camera topics in dataset');

  // Switch to 3x3 so all six tiles render, select one, then focus it.
  fireEvent.click(screen.getByText('3x3'));
  const firstLabel = 'hawk 0 left rgb image';
  fireEvent.click(screen.getByText(firstLabel));
  fireEvent.click(screen.getByText('focus'));

  expect_text('Back to grid');
  const focused = screen.getAllByText(firstLabel);
  assert(focused.length >= 1, 'focused camera label must render');
  // Focus mode shows exactly one camera tile.
  const tiles = document.querySelectorAll('canvas');
  assert(tiles.length === 1, `focus mode must render exactly one camera, got ${tiles.length}`);

  cleanup();
  console.log('All component tests passed!');
}

function expect_text(t: string) {
  const els = screen.queryAllByText(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert(els.length > 0, `expected to find text: ${t}`);
}
function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

runTests().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
