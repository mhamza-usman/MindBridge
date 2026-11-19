import { IncidentBundle, IncidentEvent } from './types';
import { AssuranceState, EvidenceSnapshot } from '../domain/types';

/**
 * Incident replay: reconstructs a playable timeline purely from the bundle's
 * own recorded events. No dependency on any live or replay evidence source —
 * every step's evidence comes from EvidenceSnapshots stored in the bundle.
 */

export interface ReplayStep {
  index: number;
  /** Event timestamp in ms (parsed from ISO string or numeric t). */
  tMs: number;
  type: IncidentEvent['type'];
  /** Assurance state after this step, if known at this point. */
  state: AssuranceState | null;
  /** Latest evidence snapshot held at this step (nulls preserved). */
  evidence: EvidenceSnapshot | null;
  why: string[];
  recommendation: string | null;
  /** operator_action payload */
  action: string | null;
  operator: string | null;
  /** fusion_conflict payload summary */
  conflict: unknown;
  raw: IncidentEvent;
}

function toMs(t: number | string): number {
  if (typeof t === 'number') return t;
  const p = Date.parse(t);
  return Number.isFinite(p) ? p : 0;
}

function snapshotFrom(data: any): EvidenceSnapshot | null {
  const s = data?.snapshot ?? data?.evidence ?? null;
  return s && typeof s === 'object' && s.items ? (s as EvidenceSnapshot) : null;
}

const KNOWN_STATES = new Set<AssuranceState>(['Autonomous', 'Degraded', 'Supervised', 'Unknown', 'Blocked']);

/**
 * Walk the bundle's events in recorded order and produce replay steps.
 * Evidence "holds": each step carries the most recent snapshot recorded at or
 * before it, so gaps between transitions still show the last known evidence.
 */
export function incidentSteps(bundle: IncidentBundle): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let state: AssuranceState | null = null;
  let evidence: EvidenceSnapshot | null = null;
  let why: string[] = [];
  let recommendation: string | null = null;

  const sorted = [...bundle.events].sort((a, b) => toMs(a.t) - toMs(b.t));

  sorted.forEach((ev, index) => {
    const snap = snapshotFrom(ev.data);
    if (snap) evidence = snap;

    if (ev.type === 'state_transition') {
      const to = (ev.data as any)?.to;
      if (typeof to === 'string' && KNOWN_STATES.has(to as AssuranceState)) {
        state = to as AssuranceState;
      } else if (to === 'Started') {
        state = null;
      }
      if (Array.isArray((ev.data as any)?.why)) why = (ev.data as any).why;
      if (typeof (ev.data as any)?.recommendation === 'string') {
        recommendation = (ev.data as any).recommendation;
      }
    }

    steps.push({
      index,
      tMs: toMs(ev.t),
      type: ev.type,
      state,
      evidence,
      why,
      recommendation,
      action: ev.type === 'operator_action' ? String((ev.data as any)?.action ?? '') : null,
      operator: ev.type === 'operator_action' ? String((ev.data as any)?.operator ?? '') : null,
      conflict: ev.type === 'fusion_conflict' ? ev.data : null,
      raw: ev
    });
  });

  return steps;
}

/** The assurance-state sequence recorded in the bundle, in order. */
export function replayStates(bundle: IncidentBundle): AssuranceState[] {
  return incidentSteps(bundle)
    .filter((s) => s.raw.type === 'state_transition' && s.state !== null)
    .map((s) => s.state as AssuranceState);
}

/** Minimal validation for an imported incident JSON. */
export function isIncidentBundle(x: unknown): x is IncidentBundle {
  const b = x as IncidentBundle;
  return !!b && typeof b === 'object'
    && typeof b.incident_id === 'string'
    && Array.isArray(b.events);
}
