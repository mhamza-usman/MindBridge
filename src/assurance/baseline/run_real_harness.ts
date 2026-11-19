/**
 * Runner: real-data baseline harness -> docs/results/phase6_real_data.md
 * Usage: pnpm exec tsx src/assurance/baseline/run_real_harness.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadReplayLines, runRealDataHarness, formatRealDataResults } from './real_data';

const file = path.resolve(process.cwd(), 'public/replay/r2b_nominal.jsonl');
if (!fs.existsSync(file)) {
  console.error(`Missing ${file} — run tools/generate_replay.sh first.`);
  process.exit(1);
}

const lines = loadReplayLines(file);
const results = runRealDataHarness(lines);
const md = formatRealDataResults(results);

const out = path.resolve(process.cwd(), 'docs/results/phase6_real_data.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`Wrote ${out}`);
console.log(md);
