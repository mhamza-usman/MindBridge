"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { IncidentBundle } from "../../incidents/types";

interface ReplayScrubberProps {
  incident: IncidentBundle;
  onClose: () => void;
}

export function ReplayScrubber({ incident, onClose }: ReplayScrubberProps) {
  const events = incident.events.filter(e => e.t);
  const times  = events.map(e => typeof e.t === 'string' ? new Date(e.t).getTime() : Number(e.t));
  const minT   = times[0]  ?? 0;
  const maxT   = times[times.length - 1] ?? 0;
  const span   = maxT - minT || 1;

  const [cursor, setCursor]   = useState(0);     // index into events
  const [playing, setPlaying] = useState(false);
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (cursor >= events.length - 1) setCursor(0);
    setPlaying(true);
  }, [cursor, events.length]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCursor(prev => {
          if (prev >= events.length - 1) { stop(); return prev; }
          return prev + 1;
        });
      }, 600);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, events.length, stop]);

  const pct = events.length > 1 ? (cursor / (events.length - 1)) * 100 : 0;
  const ev  = events[cursor];
  const evT = ev ? (typeof ev.t === 'string' ? new Date(ev.t).toLocaleTimeString() : new Date(Number(ev.t)).toLocaleTimeString()) : '';

  const stateNow: string | null = (() => {
    for (let i = cursor; i >= 0; i--) {
      if (events[i].type === 'state_transition') return (events[i].data as any).to ?? null;
    }
    return null;
  })();

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: '14px', padding: '14px', background: 'rgba(255,255,255,.6)', marginBottom: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <b style={{ fontSize: '13px' }}>{incident.incident_id}</b>
          <span style={{ fontSize: '11px', color: 'var(--ink2)', marginLeft: '8px' }}>
            {incident.mission} · {events.length} events
          </span>
        </div>
        <button onClick={onClose} style={{ fontSize: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink2)' }}>✕</button>
      </div>

      {/* Scrubber */}
      <div style={{ marginBottom: '10px' }}>
        <input
          type="range" min={0} max={Math.max(0, events.length - 1)} value={cursor}
          onChange={e => { stop(); setCursor(Number(e.target.value)); }}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
          aria-label="Replay scrubber"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink2)', marginTop: '2px' }}>
          <span>{events.length > 0 ? new Date(minT).toLocaleTimeString() : '—'}</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{evT}</span>
          <span>{events.length > 0 ? new Date(maxT).toLocaleTimeString() : '—'}</span>
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
        <button className="v2-btn" onClick={() => { stop(); setCursor(c => Math.min(events.length - 1, c + 1)); }}>▶</button>
        <button className="v2-btn" onClick={() => { stop(); setCursor(events.length - 1); }}>⏭</button>
        <span style={{ fontSize: '11px', color: 'var(--ink2)', marginLeft: 'auto' }}>
          {cursor + 1} / {events.length}
          {stateNow && <> · State: <b>{stateNow}</b></>}
        </span>
      </div>

      {/* Current event detail */}
      {ev && (
        <div style={{ background: 'rgba(10,102,255,.06)', border: '1px solid rgba(10,102,255,.15)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{evT}</span>
          {' '}<b>{ev.type}</b>{' '}
          <span style={{ color: 'var(--ink2)', fontFamily: 'var(--mono)', fontSize: '11px' }}>{JSON.stringify(ev.data)}</span>
        </div>
      )}

      {/* Mini event list — all events, current highlighted */}
      <div style={{ maxHeight: '130px', overflowY: 'auto', marginTop: '10px', fontSize: '11px', fontFamily: 'var(--mono)' }}>
        {events.map((e, i) => {
          const t = typeof e.t === 'string' ? new Date(e.t).toLocaleTimeString() : new Date(Number(e.t)).toLocaleTimeString();
          return (
            <div key={i} onClick={() => { stop(); setCursor(i); }}
              style={{ padding: '3px 6px', borderRadius: '5px', cursor: 'pointer', marginBottom: '2px',
                background: i === cursor ? 'rgba(10,102,255,.10)' : 'transparent',
                borderLeft: i === cursor ? '2px solid var(--accent)' : '2px solid transparent' }}>
              <span style={{ color: 'var(--ink2)' }}>{t}</span>{' '}
              <span style={{ color: i === cursor ? 'var(--accent)' : 'var(--ink)' }}>{e.type}</span>{' '}
              <span style={{ color: 'var(--ink2)' }}>{JSON.stringify(e.data).slice(0, 60)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
