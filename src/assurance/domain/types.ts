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
  /** Present when `value` is computed, not measured. Shown as DERIVED with this formula on hover. */
  derived?: string;
}

export interface EvidenceSnapshot {
  t: number;
  items: Record<string, EvidenceItem>;
  source?: 'synthetic' | 'replay' | 'live' | 'acoustic';
}

export interface Assumption {
  id: string;
  label: string;
  limit: string;
  check: (e: EvidenceSnapshot) => Validity;
  /** false = the dataset does not contain this signal; UI shows "Not in dataset" and it is not evaluated. */
  inDataset?: boolean;
}

/** Result of one contract check: actual value vs limit, for evidence-backed explanations. */
export interface ContractCheckResult {
  status: Validity;
  value: string;
  limit: string;
  label: string;
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
