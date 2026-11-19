"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { IncidentBundle } from "../incidents/types";
import { incidentSteps, ReplayStep } from "../incidents/replay";
import { AssuranceState } from "../domain/types";

const STATE_COLORS: Record<AssuranceState, string> = {
  Autonomous: '#1a7f37', Degraded: '#bf8700', Supervised: '#bc4c00',
  Unknown: '#57606a', Blocked: '#cf222e'
};

interface ReplayScrubberProps {
  incident: IncidentBundle;
  onClose: () => void;
}

function fmtT(tMs: number): string {
  return Number.isFinite(tMs) && tMs > 0 ? new Date(tMs).toLocaleTimeString() : '—';
}

export function ReplayScrubber({ incident, onClose }: ReplayScrubberProps) {
  // Steps are derived purely from the bundle's own events and EvidenceSnapshots.
  const steps = incidentSteps(incident);
  const times = steps.map((s) => s.tMs);
  const minT = times[0] ?? 0;
  const maxT = times[times.length - 1] ?? 0;

  const [cursor, setCursor]   = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (cursor >= steps.length - 1) setCursor(0);
    setPlaying(true);
  }, [cursor, steps.length]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCursor(prev => {
          if (prev >= steps.length - 1) { stop(); return prev; }
          return prev + 1;
        });
      }, 600);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, steps.length, stop]);

  const step: ReplayStep | undefined = steps[cursor];
  const evidenceItems = step?.evidence ? Object.values(step.evidence.items) : [];

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: '14px', padding: '14px', background: 'rgba(255,255,255,.6)', marginBottom: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <b style={{ fontSize: '13px' }}>{incident.incident_id}</b>
          <span style={{ fontSize: '11px', color: 'var(--ink2)', marginLeft: '8px' }}>
            {incident.mission} · {steps.length} steps · source: {incident.source}
          </span>
        </div>
        <button onClick={onClose} style={{ fontSize: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink2)' }}>✕</button>
      </div>

      {/* Scrubber */}
      <div style={{ marginBottom: '10px' }}>
        <input
          type="range" min={0} max={Math.max(0, steps.length - 1)} value={cursor}
          onChange={e => { stop(); setCursor(Number(e.target.value)); }}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
          aria-label="Replay scrubber"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink2)', marginTop: '2px' }}>
          <span>{steps.length > 0 ? fmtT(minT) : '—'}</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{step ? fmtT(step.tMs) : '—'}</span>
          <span>{steps.length > 0 ? fmtT(maxT) : '—'}</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
        <button className="v2-btn" onClick={() => { stop(); setCursor(0); }}>⏮</button>
        <button className="v2-btn" onClick={() => { stop(); setCursor(c => Math.max(0, c - 1)); }}>◀</button>
        {playing
          ? <button className="v2-btn p" onClick={stop}>⏸ Pause</button>
          : <button className="v2-btn p" onClick={play}>▶ Play</button>
        }
        <button className="v2-btn" onClick={() => { stop(); setCursor(c => Math.min(steps.length - 1, c + 1)); }}>▶</button>
        <button className="v2-btn" onClick={() => { stop(); setCursor(steps.length - 1); }}>⏭</button>
        <span style={{ fontSize: '11px', color: 'var(--ink2)', marginLeft: 'auto' }}>
          {cursor + 1} / {steps.length}
          {step?.state && <> · State: <b style={{ color: STATE_COLORS[step.state] }}>{step.state}</b></>}
        </span>
      </div>

      {/* Current step detail — state, why, and the evidence held at this moment */}
      {step && (
        <div style={{ background: 'rgba(10,102,255,.06)', border: '1px solid rgba(10,102,255,.15)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{fmtT(step.tMs)}</span>
            {' '}<b>{step.type}</b>
            {step.action && <> · action: <b>{step.action}</b>{step.operator ? ` by ${step.operator}` : ''}</>}
          </div>
          {step.why.length > 0 && (
            <ul style={{ margin: '4px 0', paddingLeft: '18px', color: 'var(--ink2)' }}>
              {step.why.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {step.recommendation && (
            <div style={{ color: 'var(--ink2)' }}>Recommendation: {step.recommendation}</div>
          )}
          {evidenceItems.length > 0 && (
            <table style={{ marginTop: '6px', fontSize: '11px', borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {evidenceItems.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: '1px 8px 1px 0', color: 'var(--ink2)' }}>{it.label}</td>
                    <td style={{ padding: '1px 8px', fontFamily: 'var(--mono)' }}>
                      {it.value || 'No data'}{it.unit ? ` ${it.unit}` : ''}
                      {it.derived ? <span title={`DERIVED: ${it.derived}`}> ⁽ᵈᵉʳ⁾</span> : null}
                    </td>
                    <td style={{ padding: '1px 0', color: it.status === 'ok' ? 'var(--ink2)' : '#c4162a' }}>{it.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {step.type === 'fusion_conflict' && step.conflict != null && (
            <div style={{ marginTop: '4px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink2)' }}>
              {JSON.stringify(step.conflict).slice(0, 300)}
            </div>
          )}
        </div>
      )}

      {/* Mini event list — all steps, current highlighted */}
      <div style={{ maxHeight: '130px', overflowY: 'auto', marginTop: '10px', fontSize: '11px', fontFamily: 'var(--mono)' }}>
        {steps.map((s, i) => (
          <div key={i} onClick={() => { stop(); setCursor(i); }}
            style={{ padding: '3px 6px', borderRadius: '5px', cursor: 'pointer', marginBottom: '2px',
              background: i === cursor ? 'rgba(10,102,255,.10)' : 'transparent',
              borderLeft: i === cursor ? '2px solid var(--accent)' : '2px solid transparent' }}>
            <span style={{ color: 'var(--ink2)' }}>{fmtT(s.tMs)}</span>{' '}
            <span style={{ color: i === cursor ? 'var(--accent)' : 'var(--ink)' }}>{s.type}</span>{' '}
            {s.state && <span style={{ color: 'var(--ink2)' }}>[{s.state}] </span>}
            <span style={{ color: 'var(--ink2)' }}>{s.action ?? s.why[0] ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
