export interface IncidentEvent {
  t: number | string;
  type: 'fusion_conflict' | 'state_transition' | 'operator_action' | 'evidence_snapshot';
  data: any;
}

export interface IncidentBundle {
  incident_id: string;
  mission: string;
  started_at: string;
  ended_at?: string;
  contract_version: string;
  model: { nesy_iv: string; calibration_set: string; coverage_target: number };
  known: string[];
  unknown: string[];
  violated: string[];
  events: IncidentEvent[];
  recommendation?: string;
  operator_outcome?: string;
  decision_correct?: boolean;
  source: 'synthetic' | 'replay' | 'live' | 'acoustic';
}
