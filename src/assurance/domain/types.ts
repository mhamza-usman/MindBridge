export type AssuranceState = 'Autonomous' | 'Degraded' | 'Supervised' | 'Unknown' | 'Blocked';
export type Validity = 'ok' | 'warn' | 'bad' | 'unk';

export interface EvidenceItem {
  id: string;
  label: string;
  value: string;
  unit?: string;
  status: Validity;
  source: 'synthetic' | 'replay' | 'live';
  t: number;
}

export interface EvidenceSnapshot {
  t: number;
  items: Record<string, EvidenceItem>;
}

export interface Assumption {
  id: string;
  label: string;
  limit: string;
  check: (e: EvidenceSnapshot) => Validity;
}

export interface Contract {
  mission: string;
  version: string;
  assumptions: Assumption[];
}

export type NeSyMode = 'Autonomous' | 'Monitoring' | 'Advisory' | 'Intervention' | 'Emergency';

export interface AssuranceResult {
  state: AssuranceState;
  recommendation: string;
  why: string[];
  violated: string[];
  known: string[];
  unknown: string[];
  nesyMode?: NeSyMode;
}
