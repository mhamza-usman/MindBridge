import { AssuranceState } from '../domain/types';
import { EvidenceSnapshot } from '../domain/types';

// ---------------------------------------------------------------------------
// Fleet data schema (AGENTS.md §5, Phase 7 + architecture doc §7)
// ---------------------------------------------------------------------------

export interface RobotFleetStatus {
  robot_id: string;
  name: string;
  state: AssuranceState;
  latestEvidence: EvidenceSnapshot | null;
  firmwareVersion: string;
  lastUpdated: number; // epoch ms
  recentEvents: FleetEvent[]; // last 50
}

export interface RolloutInfo {
  from_version: string;
  to_version: string;
  updated: string[];   // robot_ids already on to_version
  pending: string[];   // robot_ids still on from_version
  halted: boolean;
  anomaly_flagged: boolean;
  flag_reason: string | null;
}

export interface FleetSnapshot {
  fleet_id: string;
  robots: RobotFleetStatus[];
  rollout: RolloutInfo;
  events: FleetEvent[];   // fleet-level events, most recent first
  healthPct: number;      // Autonomous count / total * 100
  updatedAt: number;
}

export interface FleetEvent {
  t: number;
  type: 'state_change' | 'operator_action' | 'rollout_anomaly' | 'halt_logged' | 'resume_logged';
  robot_id?: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// FleetAggregator interface
// ---------------------------------------------------------------------------

export interface IFleetAggregator {
  /** Returns the current fleet snapshot. */
  getSnapshot(): FleetSnapshot;

  /** Update a robot's assurance state (called by per-robot monitors). */
  updateRobotState(
    robotId: string,
    state: AssuranceState,
    evidence: EvidenceSnapshot,
    firmwareVersion: string,
  ): void;

  /** Log an operator action (Halt, Resume, Acknowledge, etc). Read-only — never commands a robot. */
  logOperatorAction(action: string, robotId?: string): void;

  /** Subscribe to snapshot updates. Returns an unsubscribe function. */
  subscribe(cb: (snapshot: FleetSnapshot) => void): () => void;
}

// ---------------------------------------------------------------------------
// InMemoryFleetAggregator — concrete implementation used by the fleet UI
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_ROBOT = 50;
const MAX_FLEET_EVENTS     = 200;
const ROLLOUT_ANOMALY_WINDOW_MS = 60_000; // 60 s per spec

export class InMemoryFleetAggregator implements IFleetAggregator {
  private robots: Map<string, RobotFleetStatus> = new Map();
  private fleetEvents: FleetEvent[] = [];
  private rollout: RolloutInfo;
  private listeners: Set<(s: FleetSnapshot) => void> = new Set();
  private fleetId: string;

  constructor(fleetId: string, rollout: RolloutInfo) {
    this.fleetId = fleetId;
    this.rollout = { ...rollout };
  }

  // ---- IFleetAggregator --------------------------------------------------

  getSnapshot(): FleetSnapshot {
    const robots = Array.from(this.robots.values());
    const autonomousCount = robots.filter(r => r.state === 'Autonomous').length;
    const healthPct = robots.length > 0
      ? Math.round((autonomousCount / robots.length) * 100)
      : 100;

    return {
      fleet_id: this.fleetId,
      robots,
      rollout: { ...this.rollout },
      events: [...this.fleetEvents],
      healthPct,
      updatedAt: Date.now(),
    };
  }

  updateRobotState(
    robotId: string,
    state: AssuranceState,
    evidence: EvidenceSnapshot,
    firmwareVersion: string,
  ): void {
    const now = Date.now();
    const existing = this.robots.get(robotId);

    // Check rollout anomaly: did this robot degrade within 60 s of a firmware update?
    if (existing && state !== 'Autonomous' && state !== existing.state) {
      const justUpdated = this.rollout.updated.includes(robotId);
      const timeSinceUpdate = existing.lastUpdated
        ? now - existing.lastUpdated
        : Infinity;

      if (justUpdated && timeSinceUpdate <= ROLLOUT_ANOMALY_WINDOW_MS) {
        const reason = `Robot ${robotId} degraded to ${state} within ${Math.round(timeSinceUpdate / 1000)}s of firmware update`;
        if (!this.rollout.anomaly_flagged) {
          this.rollout.anomaly_flagged = true;
          this.rollout.flag_reason = reason;
          this._addFleetEvent({
            t: now,
            type: 'rollout_anomaly',
            robot_id: robotId,
            data: { state, reason, firmwareVersion },
          });
        }
      }
    }

    // Upsert robot record
    const recentEvents: FleetEvent[] = existing?.recentEvents ?? [];
    if (existing?.state !== state) {
      const ev: FleetEvent = {
        t: now,
        type: 'state_change',
        robot_id: robotId,
        data: { from: existing?.state ?? null, to: state },
      };
      recentEvents.unshift(ev);
      if (recentEvents.length > MAX_EVENTS_PER_ROBOT) recentEvents.pop();
    }

    this.robots.set(robotId, {
      robot_id: robotId,
      name: existing?.name ?? robotId,
      state,
      latestEvidence: evidence,
      firmwareVersion,
      lastUpdated: now,
      recentEvents,
    });

    this._notify();
  }

  logOperatorAction(action: string, robotId?: string): void {
    const ev: FleetEvent = {
      t: Date.now(),
      type: action.toLowerCase().includes('halt') ? 'halt_logged'
           : action.toLowerCase().includes('resume') ? 'resume_logged'
           : 'operator_action',
      robot_id: robotId,
      data: { action },
    };

    if (action.toLowerCase().includes('halt')) {
      this.rollout.halted = true;
    } else if (action.toLowerCase().includes('resume')) {
      this.rollout.halted = false;
    }

    this._addFleetEvent(ev);

    if (robotId) {
      const robot = this.robots.get(robotId);
      if (robot) {
        robot.recentEvents.unshift(ev);
        if (robot.recentEvents.length > MAX_EVENTS_PER_ROBOT) robot.recentEvents.pop();
      }
    }

    this._notify();
  }

  subscribe(cb: (snapshot: FleetSnapshot) => void): () => void {
    this.listeners.add(cb);
    // Immediately emit current snapshot to new subscriber
    cb(this.getSnapshot());
    return () => this.listeners.delete(cb);
  }

  /** Convenience: register a named robot (before it starts sending updates). */
  registerRobot(robotId: string, name: string, firmwareVersion: string): void {
    if (!this.robots.has(robotId)) {
      this.robots.set(robotId, {
        robot_id: robotId,
        name,
        state: 'Unknown',
        latestEvidence: null,
        firmwareVersion,
        lastUpdated: Date.now(),
        recentEvents: [],
      });
    }
  }

  // ---- Private -----------------------------------------------------------

  private _addFleetEvent(ev: FleetEvent): void {
    this.fleetEvents.unshift(ev);
    if (this.fleetEvents.length > MAX_FLEET_EVENTS) this.fleetEvents.pop();
  }

  private _notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach(cb => cb(snap));
  }
}
