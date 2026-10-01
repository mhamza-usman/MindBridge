"use client";
import React, { useEffect, useState, useCallback } from "react";
import { FleetSnapshot, FleetEvent, RobotFleetStatus } from "../../fleet/FleetAggregator";
import { IFleetAggregator } from "../../fleet/FleetAggregator";
import { AssuranceState } from "../../domain/types";

const STATE_COLOR: Record<AssuranceState, string> = {
  Autonomous: '#1e8e4e', Degraded: '#a15c00', Supervised: '#c2410c',
  Unknown: '#5b6472', Blocked: '#c4162a',
};
const STATE_ICON: Record<AssuranceState, string> = {
  Autonomous: '✓', Degraded: '!', Supervised: '👁', Unknown: '?', Blocked: '■',
};

interface FleetViewProps {
  aggregator: IFleetAggregator;
  onSelectRobot?: (robotId: string) => void; // routes to Live view
}

export function FleetView({ aggregator, onSelectRobot }: FleetViewProps) {
  const [snap, setSnap] = useState<FleetSnapshot>(aggregator.getSnapshot());
  const [logMsg, setLogMsg] = useState('');

  useEffect(() => {
    return aggregator.subscribe(setSnap);
  }, [aggregator]);

  const logAction = useCallback((action: string, robotId?: string) => {
    aggregator.logOperatorAction(action, robotId);
    const ts = new Date().toLocaleTimeString();
    if (action.toLowerCase().includes('halt')) {
      setLogMsg(`Halt logged at ${ts}. No robot was commanded.`);
    } else if (action.toLowerCase().includes('resume')) {
      setLogMsg(`Resume logged at ${ts}. No robot was commanded.`);
    } else {
      setLogMsg(`${action} logged at ${ts}. Logged only, robot not touched.`);
    }
  }, [aggregator]);

  const alertRobots = snap.robots.filter(r =>
    r.state === 'Supervised' || r.state === 'Unknown' || r.state === 'Blocked'
  );
  const healthColor = snap.healthPct >= 75 ? '#1e8e4e' : '#a15c00';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Fleet banner */}
      <div className="v2-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 18px' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>Fleet health</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: healthColor, lineHeight: 1.1 }}>
            {snap.healthPct}%
          </div>
          <div style={{ fontSize: '11px', color: healthColor }}>
            {snap.healthPct >= 75 ? 'Within normal range' : 'Below 75% — review needed'}
          </div>
        </div>

        <div style={{ width: '1px', background: 'var(--line)', alignSelf: 'stretch' }} />

        <div style={{ flex: 1 }}>
          {alertRobots.length === 0 ? (
            <span style={{ fontSize: '13px', color: 'var(--ink2)' }}>All robots Autonomous or Degraded. No banner alerts.</span>
          ) : (
            <>
              <div style={{ fontSize: '11px', color: 'var(--ink2)', marginBottom: '6px' }}>Requires attention</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {alertRobots.map(r => (
                  <button
                    key={r.robot_id}
                    onClick={() => onSelectRobot?.(r.robot_id)}
                    className="v2-chip"
                    style={{
                      '--c': STATE_COLOR[r.state],
                      cursor: 'pointer',
                      border: 'none',
                      background: `color-mix(in srgb, ${STATE_COLOR[r.state]} 11%, #fff)`,
                    } as any}
                  >
                    <i style={{ width: '16px', height: '16px', fontSize: '10px', borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', background: STATE_COLOR[r.state] }}>
                      {STATE_ICON[r.state]}
                    </i>
                    <span>{r.name} — {r.state}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Rollout status */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>Rollout</div>
          <div style={{ fontSize: '12px', fontFamily: 'var(--mono)' }}>
            {snap.rollout.from_version} → {snap.rollout.to_version}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>
            {snap.rollout.updated.length} updated · {snap.rollout.pending.length} pending
          </div>
          {snap.rollout.anomaly_flagged && (
            <div style={{ fontSize: '11px', color: '#c4162a', marginTop: '3px' }}>
              ⚠ Rollout anomaly flagged
            </div>
          )}
          {snap.rollout.halted && (
            <div style={{ fontSize: '11px', color: '#a15c00', marginTop: '3px' }}>
              ⏸ Rollout halted (logged)
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="v2-btn" onClick={() => logAction('Halt rollout')}
            style={{ background: snap.rollout.halted ? '#f0f0f0' : undefined }}>
            Halt rollout
          </button>
          <button className="v2-btn" onClick={() => logAction('Resume rollout')}
            style={{ background: !snap.rollout.halted ? '#f0f0f0' : undefined }}>
            Resume
          </button>
        </div>
      </div>

      {/* Anomaly flag detail */}
      {snap.rollout.anomaly_flagged && snap.rollout.flag_reason && (
        <div className="v2-panel" style={{ background: 'rgba(196,22,42,.06)', border: '1px solid rgba(196,22,42,.20)', padding: '10px 16px' }}>
          <b style={{ color: '#c4162a', fontSize: '12px' }}>⚠ Rollout anomaly</b>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ink)' }}>{snap.rollout.flag_reason}</p>
          <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--ink2)' }}>MindBridge flagged this automatically. No robot has been halted. Use the Halt rollout button above to log a halt decision.</p>
        </div>
      )}

      {/* Log message */}
      {logMsg && (
        <div style={{ fontSize: '12px', color: 'var(--ink2)', padding: '6px 4px' }}>{logMsg}</div>
      )}

      {/* Robot cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
        {snap.robots.map(r => (
          <RobotCard
            key={r.robot_id}
            robot={r}
            rolloutTarget={snap.rollout.to_version}
            onClick={() => onSelectRobot?.(r.robot_id)}
          />
        ))}
      </div>

      {/* Fleet event log */}
      <div className="v2-panel">
        <h2>Fleet event log</h2>
        <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
          {snap.events.length === 0 ? (
            <p style={{ color: 'var(--ink2)', fontSize: '12px' }}>No fleet events yet.</p>
          ) : (
            snap.events.slice(0, 40).map((ev, i) => (
              <FleetEventRow key={i} ev={ev} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RobotCard({
  robot, rolloutTarget, onClick,
}: { robot: RobotFleetStatus; rolloutTarget: string; onClick: () => void }) {
  const c = STATE_COLOR[robot.state];
  const isOnTarget = robot.firmwareVersion === rolloutTarget;
  const isDashed = robot.state === 'Unknown';

  return (
    <button
      onClick={onClick}
      className="v2-panel"
      style={{
        textAlign: 'left', cursor: 'pointer', padding: '14px',
        border: isDashed ? `1.5px dashed ${c}` : `1px solid rgba(255,255,255,.85)`,
        outline: isDashed ? 'none' : undefined,
        transition: 'transform .14s ease, box-shadow .14s ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-3px)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '14px' }}>{robot.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>{robot.robot_id}</div>
        </div>
        <span
          style={{
            fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '99px',
            color: c,
            background: `color-mix(in srgb, ${c} 11%, #fff)`,
            border: isDashed ? `1px dashed ${c}` : `1px solid color-mix(in srgb, ${c} 30%, #fff)`,
          }}
        >
          {isDashed ? '○ ' : `${STATE_ICON[robot.state]} `}{robot.state}
        </span>
      </div>

      {/* Firmware badge */}
      <div style={{
        fontSize: '10px', padding: '2px 7px', borderRadius: '6px', display: 'inline-block',
        background: isOnTarget ? 'rgba(10,102,255,.08)' : 'rgba(196,22,42,.08)',
        color: isOnTarget ? 'var(--accent)' : '#c4162a',
        border: `1px solid ${isOnTarget ? 'rgba(10,102,255,.2)' : 'rgba(196,22,42,.2)'}`,
        marginBottom: '8px',
      }}>
        {robot.firmwareVersion}{!isOnTarget ? ' ← needs update' : ''}
      </div>

      {/* Last event */}
      {robot.recentEvents[0] && (
        <div style={{ fontSize: '10px', color: 'var(--ink2)', fontFamily: 'var(--mono)' }}>
          {new Date(robot.recentEvents[0].t).toLocaleTimeString()} {robot.recentEvents[0].type}
        </div>
      )}
    </button>
  );
}

function FleetEventRow({ ev }: { ev: FleetEvent }) {
  const typeColor: Record<string, string> = {
    rollout_anomaly: '#c4162a', halt_logged: '#a15c00',
    resume_logged: '#1e8e4e', state_change: 'var(--accent)',
    operator_action: 'var(--ink2)',
  };
  return (
    <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid var(--line)', display: 'flex', gap: '10px' }}>
      <span style={{ color: 'var(--ink2)', flexShrink: 0 }}>{new Date(ev.t).toLocaleTimeString()}</span>
      {ev.robot_id && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{ev.robot_id}</span>}
      <span style={{ color: typeColor[ev.type] ?? 'var(--ink)' }}>{ev.type}</span>
      <span style={{ color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {JSON.stringify(ev.data)}
      </span>
    </div>
  );
}
