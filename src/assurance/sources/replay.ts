import { EvidenceSource } from './types';
import { EvidenceSnapshot, EvidenceItem } from '../domain/types';

export class ReplaySource implements EvidenceSource {
  public id = 'replay_source_1';
  public kind: 'replay' = 'replay';
  
  private lines: any[] = [];
  private listeners: Array<(s: EvidenceSnapshot) => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private idx = 0;

  constructor(jsonlData: string) {
    this.lines = jsonlData.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }

  public start() {
    this.timer = setInterval(() => {
      if (this.idx < this.lines.length) {
        this.emit(this.lines[this.idx++]);
      } else {
        this.stop();
      }
    }, 1000);
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public onSnapshot(cb: (s: EvidenceSnapshot) => void) {
    this.listeners.push(cb);
  }

  private emit(line: any) {
    const items: Record<string, EvidenceItem> = {};
    for (const [k, v] of Object.entries(line.evidence || {})) {
      items[k] = {
        id: k,
        label: k,
        value: String(v),
        status: 'ok', 
        source: 'replay',
        t: line.t
      };
    }
    const s: EvidenceSnapshot = { t: line.t, items };
    for (const cb of this.listeners) cb(s);
  }
}
