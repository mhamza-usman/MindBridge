import { EvidenceSnapshot } from '../domain/types';

export interface EvidenceSource {
  id: string;
  kind: 'synthetic' | 'replay' | 'live' | 'acoustic';
  start(): void;
  stop(): void;
  onSnapshot(cb: (s: EvidenceSnapshot) => void): void;
}
