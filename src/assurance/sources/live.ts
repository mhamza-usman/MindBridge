import { EvidenceSource } from './types';
import { EvidenceSnapshot } from '../domain/types';

export class LiveSource implements EvidenceSource {
  public id = 'live_source_1';
  public kind: 'live' = 'live';

  public start() {
    throw new Error('Not implemented: LiveSource');
  }

  public stop() {
    throw new Error('Not implemented: LiveSource');
  }

  public onSnapshot(cb: (s: EvidenceSnapshot) => void) {
    throw new Error('Not implemented: LiveSource');
  }
}
