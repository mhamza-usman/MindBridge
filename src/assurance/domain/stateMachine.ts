import { AssuranceState, NeSyMode, Validity, AssuranceResult, EvidenceSnapshot } from './types';

export interface StateMachineConfig {
  escalationTimeMs: number;
  holdTimeMs: number;
  /**
   * How long a worsening candidate state must persist before it takes effect.
   * Filters single-frame sensor dropouts. 0 = immediate (legacy behaviour).
   */
  confirmMs?: number;
}

export const defaultSMConfig: StateMachineConfig = {
  escalationTimeMs: 20000,
  holdTimeMs: 10000,
  confirmMs: 1000
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
  private pendingWorsen: AssuranceState | null = null;
  private pendingSince: number | null = null;
  private lastT = -Infinity;

  constructor(private config: StateMachineConfig = defaultSMConfig) {}

  /**
   * @param t        timestamp in milliseconds (same unit as config times)
   * @param evidence optional snapshot; used to detect the sensor startup frame
   *                 (sentinel ages >= 9000 ms before sensors publish)
   */
  public tick(
    t: number,
    contractStatus: Record<string, Validity>,
    fusionConflict: boolean,
    nesyMode: NeSyMode,
    evidence?: EvidenceSnapshot
  ): AssuranceResult {
    // Replay loops and source switches can move t backwards; restart timers.
    if (t < this.lastT) {
      this.violationStartTime = null;
      this.recoveryStartTime = null;
      this.pendingWorsen = null;
      this.pendingSince = null;
    }
    this.lastT = t;

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

    // Startup grace: first frame(s) may carry sentinel ages (>= 9000 ms) before
    // sensors publish. Treat contract checks as clean and skip the NeSyConf
    // floor for that tick so the boot frame cannot latch a bad state.
    let isStartup = false;
    if (evidence && t < 1000) {
      const cameraAge = parseFloat(evidence.items['camera_age_ms']?.value ?? '0');
      const lidarAge = parseFloat(evidence.items['lidar_age_ms']?.value ?? '0');
      isStartup = cameraAge >= 9000 && lidarAge >= 9000;
    }
    if (isStartup) {
      unknownReasons = [];
      degradedReasons = [];
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

    const floor = isStartup ? null : NeSyFloorMap[nesyMode];
    if (floor && STATE_RANK[floor] > STATE_RANK[rawState]) {
      rawState = floor;
      blockReasons.push(`NeSyConf mode ${nesyMode} enforces ${floor} floor`);
    }

    // Confirmation window: a worsening candidate must persist confirmMs before
    // the state actually changes. Single-frame dropouts never confirm.
    const confirmMs = this.config.confirmMs ?? 0;
    if (STATE_RANK[rawState] > STATE_RANK[this.currentState]) {
      const persisted =
        this.pendingWorsen === rawState &&
        this.pendingSince !== null &&
        t - this.pendingSince >= confirmMs;
      if (persisted) {
        this.pendingWorsen = null;
        this.pendingSince = null;
      } else {
        if (this.pendingWorsen !== rawState || this.pendingSince === null || t < this.pendingSince) {
          this.pendingWorsen = rawState;
          this.pendingSince = t;
        }
        if (confirmMs > 0) rawState = this.currentState;
      }
    } else {
      this.pendingWorsen = null;
      this.pendingSince = null;
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
