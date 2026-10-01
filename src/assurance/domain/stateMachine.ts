import { AssuranceState, NeSyMode, Validity, AssuranceResult } from './types';

export interface StateMachineConfig {
  escalationTimeMs: number;
  holdTimeMs: number;
}

export const defaultSMConfig: StateMachineConfig = {
  escalationTimeMs: 20000,
  holdTimeMs: 10000
};

export const NeSyFloorMap: Record<NeSyMode, AssuranceState | null> = {
  Autonomous: null,
  Monitoring: null,
  Advisory: 'Degraded',
  Intervention: 'Supervised',
  Emergency: 'Blocked'
};

const STATE_RANK: Record<AssuranceState, number> = {
  'Autonomous': 0,
  'Degraded': 1,
  'Supervised': 2,
  'Unknown': 3,
  'Blocked': 4
};

export class AssuranceStateMachine {
  private currentState: AssuranceState = 'Autonomous';
  private violationStartTime: number | null = null;
  private recoveryStartTime: number | null = null;

  constructor(private config: StateMachineConfig = defaultSMConfig) {}

  public tick(
    t: number,
    contractStatus: Record<string, Validity>,
    fusionConflict: boolean,
    nesyMode: NeSyMode
  ): AssuranceResult {
    let rawState: AssuranceState = 'Autonomous';
    let unknownReasons: string[] = [];
    let blockReasons: string[] = [];
    let degradedReasons: string[] = [];

    for (const [id, status] of Object.entries(contractStatus)) {
      if (status === 'unk') {
        unknownReasons.push(`${id} is missing, stale, or invalid`);
      } else if (status === 'bad') {
        degradedReasons.push(`${id} violated limit`);
      }
    }

    if (unknownReasons.length > 0) {
      rawState = 'Unknown';
    } else if (fusionConflict) {
      rawState = 'Supervised';
      degradedReasons.push('Camera and LiDAR disagree');
    } else if (degradedReasons.length > 0) {
      rawState = 'Degraded';
    }

    if (rawState === 'Degraded') {
      if (this.violationStartTime === null) {
        this.violationStartTime = t;
      } else if (t - this.violationStartTime >= this.config.escalationTimeMs) {
        rawState = 'Supervised';
      }
    } else {
      this.violationStartTime = null;
    }

    const floor = NeSyFloorMap[nesyMode];
    if (floor && STATE_RANK[floor] > STATE_RANK[rawState]) {
      rawState = floor;
      blockReasons.push(`NeSyConf mode ${nesyMode} enforces ${floor} floor`);
    }

    if (STATE_RANK[rawState] < STATE_RANK[this.currentState]) {
      if (this.recoveryStartTime === null) {
        this.recoveryStartTime = t;
        rawState = this.currentState; 
      } else if (t - this.recoveryStartTime < this.config.holdTimeMs) {
        rawState = this.currentState; 
      } else {
        const currRank = STATE_RANK[this.currentState];
        const newRank = Math.max(STATE_RANK[rawState], currRank - 1);
        rawState = (Object.keys(STATE_RANK) as AssuranceState[]).find(k => STATE_RANK[k] === newRank)!;
        this.recoveryStartTime = t;
      }
    } else {
      this.recoveryStartTime = null; 
    }

    this.currentState = rawState;

    let rec = 'Continue';
    if (this.currentState === 'Degraded') rec = 'Slow down, watch closely';
    if (this.currentState === 'Supervised' || this.currentState === 'Unknown') rec = 'Request operator review';
    if (this.currentState === 'Blocked') rec = 'Pause mission';

    return {
      state: this.currentState,
      recommendation: rec,
      why: [...blockReasons, ...unknownReasons, ...degradedReasons],
      violated: degradedReasons,
      known: [], 
      unknown: unknownReasons,
      nesyMode
    };
  }

  public getState() {
    return this.currentState;
  }
}
