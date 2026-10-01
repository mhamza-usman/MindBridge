import { IncidentBundle } from './types';

export class IncidentStore {
  private static KEY = 'mindbridge_incidents';

  public static save(incident: IncidentBundle) {
    if (typeof window === 'undefined') return;
    const all = this.getAll();
    const idx = all.findIndex(i => i.incident_id === incident.incident_id);
    if (idx >= 0) all[idx] = incident;
    else all.push(incident);
    localStorage.setItem(this.KEY, JSON.stringify(all));
  }

  public static getAll(): IncidentBundle[] {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch {
      return [];
    }
  }

  public static get(id: string): IncidentBundle | undefined {
    return this.getAll().find(i => i.incident_id === id);
  }
}
