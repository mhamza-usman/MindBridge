import { EvidenceSource } from './types';
import { EvidenceSnapshot } from '../domain/types';

export class AcousticSource implements EvidenceSource {
  public id = 'acoustic_source_1';
  public kind: 'acoustic' = 'acoustic';

  public start() {
    throw new Error('Not implemented: AcousticSource (CASSANDRA plugin)');
  }

  public stop() {
    throw new Error('Not implemented: AcousticSource (CASSANDRA plugin)');
  }

  public onSnapshot(cb: (s: EvidenceSnapshot) => void) {
    throw new Error('Not implemented: AcousticSource (CASSANDRA plugin)');
  }
}
