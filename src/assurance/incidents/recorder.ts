import { IncidentBundle, IncidentEvent } from './types';
import { IncidentStore } from './store';
import { AssuranceState } from '../domain/types';

export class IncidentRecorder {
  private bundle: IncidentBundle | null = null;
  private lastState: AssuranceState | null = null;

  public start(mission: string, contractVersion: string, source: 'synthetic' | 'replay' | 'live' | 'acoustic') {
    this.bundle = {
      incident_id: `inc_${Date.now()}`,
      mission,
      started_at: new Date().toISOString(),
      contract_version: contractVersion,
      model: { nesy_iv: "v0.x", calibration_set: "cal_2026_09_17", coverage_target: 0.90 },
      known: [],
      unknown: [],
      violated: [],
      events: [{
        t: new Date().toISOString(),
        type: 'state_transition',
        data: { from: null, to: 'Started' }
      }],
      source
    };
    IncidentStore.save(this.bundle);
  }

  public recordState(state: AssuranceState, why: string[], recommendation: string, known: string[], unknown: string[], violated: string[]) {
    if (!this.bundle) return;
    if (this.lastState !== state) {
      this.bundle.events.push({
        t: new Date().toISOString(),
        type: 'state_transition',
        data: { from: this.lastState, to: state, why }
      });
      this.lastState = state;
    }
    this.bundle.recommendation = recommendation;
    this.bundle.known = Array.from(new Set([...this.bundle.known, ...known]));
    this.bundle.unknown = Array.from(new Set([...this.bundle.unknown, ...unknown]));
    this.bundle.violated = Array.from(new Set([...this.bundle.violated, ...violated]));
    IncidentStore.save(this.bundle);
  }

  public recordOperatorAction(action: string, operator: string = 'op_local') {
    if (!this.bundle) return;
    this.bundle.events.push({
      t: new Date().toISOString(),
      type: 'operator_action',
      data: { action, operator }
    });
    this.bundle.operator_outcome = action;
    IncidentStore.save(this.bundle);
  }

  public getBundle() { return this.bundle; }

  public stop() {
    if (!this.bundle) return;
    this.bundle.ended_at = new Date().toISOString();
    IncidentStore.save(this.bundle);
    this.bundle = null;
    this.lastState = null;
  }
}
