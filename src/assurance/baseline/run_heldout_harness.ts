/**
 * Runner: held-out baseline validation -> docs/results/phase6_heldout.md
 * Usage: pnpm exec tsx src/assurance/baseline/run_heldout_harness.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadReplayLines } from './real_data';
import { HELDOUT_START, runHeldoutHarness, formatHeldoutResults } from './heldout';

const file = path.resolve(process.cwd(), 'public/replay/r2b_nominal.jsonl');
if (!fs.existsSync(file)) {
  console.error(`Missing ${file} — run tools/generate_replay.sh first.`);
  process.exit(1);
}

const lines = loadReplayLines(file);
const slice = lines.slice(HELDOUT_START);
const results = runHeldoutHarness(slice);
const md = formatHeldoutResults(results);

const out = path.resolve(process.cwd(), 'docs/results/phase6_heldout.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`Wrote ${out}`);
console.log(md);
