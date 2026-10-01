import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runHarness, formatResultsTable } from './harness';

function runTests() {
  console.log('Running Phase 6 harness...');
  const results = runHarness();

  // --- Structural assertions ---
  assert.strictEqual(results.length, 4, 'Should have 4 scenarios');
  
  const nominal = results.find(r => !r.isFault)!;
  assert.ok(nominal, 'Nominal scenario present');

  // Nominal: no monitor should fire (no false alarms)
  for (const m of nominal.monitors) {
    assert.strictEqual(m.falseAlarm, false, `${m.monitor} should not false-alarm on nominal`);
    assert.strictEqual(m.missed, false, `${m.monitor} should not flag 'missed' on nominal`);
  }

  // Fault scenarios: no monitor should miss
  const faultScenarios = results.filter(r => r.isFault);
  for (const s of faultScenarios) {
    for (const m of s.monitors) {
      assert.strictEqual(m.missed, false, `${m.monitor} missed fault in: ${s.scenario}`);
    }
  }

  // Contract monitors should detect no later than simple thresholds (or same frame)
  for (const s of faultScenarios) {
    const simpleTtd   = s.monitors[0].ttdMs ?? Infinity;
    const contractTtd = s.monitors[1].ttdMs ?? Infinity;
    assert.ok(
      contractTtd <= simpleTtd + 100, // allow 1 frame slack
      `Contract monitor should detect within 1 frame of threshold in: ${s.scenario}`
    );
  }

  // Write results table to docs/results/
  const table = formatResultsTable(results);
  const outDir = path.join(process.cwd(), 'docs', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'phase6_baseline.md');
  fs.writeFileSync(outPath, table, 'utf8');

  console.log(`Results written to docs/results/phase6_baseline.md`);
  console.log('\n' + table);
  console.log('\nAll Phase 6 harness assertions passed!');
}

runTests();
