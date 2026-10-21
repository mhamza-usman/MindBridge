"use client";
import React, { useEffect, useRef } from "react";
import { EvidenceSnapshot } from "../domain/types";

interface MonitoringPanelProps {
  history: EvidenceSnapshot[];
  sourceType: 'synthetic' | 'replay';
  replayScenario: string | null;
}

interface SparkProps {
  values: number[];
  color: string;
  label: string;
  unit: string;
  current: string;
  status: 'ok' | 'warn' | 'bad' | 'unk';
  limitLine?: number;   // 0-1 fraction of maxVal
  maxVal?: number;
}

function Sparkline({ values, color, label, unit, current, status, limitLine, maxVal }: SparkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || values.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const max = maxVal ?? Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;

    const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;

    // Limit line
    if (limitLine !== undefined) {
      const ly = H - limitLine * (H - 4) - 2;
      ctx.strokeStyle = 'rgba(196,22,42,.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(W, ly);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '44');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dot at end
    const lastX = W;
    const lastY = toY(values[values.length - 1]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lastX - 1, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [values, color, limitLine, maxVal]);

  const statusColor = status === 'ok' ? '#1e8e4e' : status === 'warn' ? '#a15c00' : status === 'bad' ? '#c4162a' : '#5b6472';

  return (
    <div style={{
      background: 'rgba(255,255,255,.6)',
      borderRadius: '14px',
      border: '1px solid rgba(20,30,50,.08)',
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '11px', color: '#5f6470', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: statusColor, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
          {current}{unit ? ' ' + unit : ''}
        </span>
      </div>
      <canvas ref={canvasRef} width={160} height={40} style={{ width: '100%', height: '40px', display: 'block', borderRadius: '6px' }} />
    </div>
  );
}

export function MonitoringPanel({ history, sourceType, replayScenario }: MonitoringPanelProps) {
  const N = 80; // keep last N samples
  const slice = history.slice(-N);

  function series(key: string): number[] {
    return slice.map(s => {
      const v = s.items[key]?.value;
      if (v === undefined || v === null) return 0;
      if (v === 'true') return 1;
      if (v === 'false') return 0;
      return parseFloat(v) || 0;
    });
  }

  function currentStatus(key: string): 'ok' | 'warn' | 'bad' | 'unk' {
    const last = history[history.length - 1];
    return (last?.items[key]?.status as any) ?? 'unk';
  }

  function currentVal(key: string): string {
    const last = history[history.length - 1];
    const v = last?.items[key]?.value;
    if (v === undefined) return '—';
    const n = parseFloat(v);
    if (!isNaN(n)) return n % 1 === 0 ? String(n) : n.toFixed(1);
    return v;
  }

  const elapsed = slice.length > 0 ? (slice[slice.length - 1].t - slice[0].t).toFixed(1) : '0';

  const charts: Array<{ key: string; label: string; unit: string; color: string; limit?: number; maxV?: number }> = [
    { key: 'perception_pct',    label: 'Perception',       unit: '%',  color: '#0a66ff', limit: 0.7,  maxV: 100 },
    { key: 'uncertainty_pct',   label: 'Uncertainty',      unit: '%',  color: '#c2410c', limit: 0.3,  maxV: 100 },
    { key: 'camera_age_ms',     label: 'Camera age',       unit: 'ms', color: '#7c3aed', limit: 0.2/2, maxV: 2000 },
    { key: 'lidar_age_ms',      label: 'LiDAR age',        unit: 'ms', color: '#0891b2', limit: 0.1, maxV: 200 },
    { key: 'battery_reserve_pct', label: 'Battery',        unit: '%',  color: '#1e8e4e', limit: 0.2,  maxV: 100 },
    { key: 'cam_rate_hz',       label: 'Camera rate',      unit: 'Hz', color: '#d97706',              maxV: 30 },
  ];

  return (
    <div style={{ padding: '0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 650 }}>Live monitoring feed</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{
            fontSize: '10px', padding: '2px 8px', borderRadius: '99px',
            background: sourceType === 'replay' ? 'rgba(10,102,255,.12)' : 'rgba(30,50,90,.06)',
            color: sourceType === 'replay' ? '#0a66ff' : '#5f6470',
            border: '1px solid ' + (sourceType === 'replay' ? 'rgba(10,102,255,.3)' : 'rgba(20,30,50,.10)'),
            fontWeight: 600,
          }}>
            {sourceType === 'replay' && replayScenario
              ? `Replay · NVIDIA r2b 2023 · ${replayScenario.replace('r2b_', '')}`
              : 'Synthetic'}
          </span>
          <span style={{ fontSize: '10px', color: '#5f6470', fontFamily: 'ui-monospace, SF Mono, monospace' }}>
            {slice.length} frames · {elapsed}s
          </span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '10px',
      }}>
        {charts.map(c => (
          <Sparkline
            key={c.key}
            values={series(c.key)}
            color={c.color}
            label={c.label}
            unit={c.unit}
            current={currentVal(c.key)}
            status={currentStatus(c.key)}
            limitLine={c.limit}
            maxVal={c.maxV}
          />
        ))}
      </div>

      {/* Event stream — last 6 raw state transitions visible in dataset */}
      {history.length > 0 && (() => {
        const stateHistory: Array<{ t: number; state: string; perception: string; uncertainty: string }> = [];
        let lastState = '';
        for (const snap of history) {
          const camAge = parseFloat(snap.items['camera_age_ms']?.value ?? '0');
          const unc = parseFloat(snap.items['uncertainty_pct']?.value ?? '0');
          const perc = parseFloat(snap.items['perception_pct']?.value ?? '0');
          const state = camAge > 200 ? 'Stale' : unc > 30 ? 'Uncertain' : perc < 70 ? 'Low perception' : 'Normal';
          if (state !== lastState) {
            stateHistory.push({ t: snap.t, state, perception: perc.toFixed(0), uncertainty: unc.toFixed(0) });
            lastState = state;
          }
        }
        if (stateHistory.length === 0) return null;
        return (
          <div style={{ marginTop: '14px', borderTop: '1px solid rgba(20,30,50,.08)', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#5f6470', marginBottom: '6px' }}>Signal transitions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '100px', overflowY: 'auto' }}>
              {stateHistory.slice(-8).reverse().map((ev, i) => (
                <div key={i} style={{
                  display: 'flex', gap: '8px', alignItems: 'center',
                  fontSize: '11px', fontFamily: 'ui-monospace, SF Mono, monospace',
                  color: ev.state === 'Normal' ? '#1e8e4e' : ev.state === 'Stale' ? '#7c3aed' : '#a15c00',
                }}>
                  <span style={{ color: '#5f6470', minWidth: '40px' }}>t={ev.t.toFixed(1)}s</span>
                  <span style={{ fontWeight: 600 }}>{ev.state}</span>
                  <span style={{ color: '#5f6470' }}>perc={ev.perception}% unc={ev.uncertainty}%</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
