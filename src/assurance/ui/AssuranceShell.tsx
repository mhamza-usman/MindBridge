"use client";
import React, { useEffect, useState, useMemo, useRef } from "react";
import "./AssuranceStyles.css";
import { SyntheticSource } from "../sources/synthetic";
import { ReplaySource, ReplaySourceOptions } from "../sources/replay";
import { getDefaultContract } from "../contract/loader";
import { evaluateContract } from "../contract/evaluator";
import { AssuranceStateMachine } from "../domain/stateMachine";
import { EvidenceSnapshot, AssuranceState, NeSyMode, ContractCheckResult } from "../domain/types";
import { DiagnosisReport } from "../fusion/detector";
import { IncidentRecorder } from "../incidents/recorder";
import { IncidentStore } from "../incidents/store";
import { IncidentBundle } from "../incidents/types";
import { isIncidentBundle } from "../incidents/replay";
import { evaluateFusion } from "../fusion/detector";
import { buildFusionInput, FusionMetrics } from "../fusion/inputBuilder";
import { FusionMetricsBuffer } from "../fusion/telemetryMetrics";
import { TelemetrySource } from "../telemetry/TelemetrySource";
import { FleetView } from "./fleet/FleetView";
import { createReplayFleet, REPLAY_ROBOT_ID } from "../fleet/replayFleet";
import { ReplayScrubber } from "./ReplayScrubber";
import { MonitoringPanel } from "./MonitoringPanel";
import TelemetryLayout from "../telemetry/ui/TelemetryLayout";
import CameraWall from "./CameraWall";
import { checkAlerts, Alert, ALERT_TO_ASSUMPTION, ALERT_RULES } from "../alerts/AlertRule";
import { InterfaceSwitch } from "@/components/InterfaceSwitch";

const STATE_COLORS: Record<AssuranceState, string> = {
  Autonomous: 'var(--auto)', Degraded: 'var(--deg)', Supervised: 'var(--sup)', Unknown: 'var(--unk)', Blocked: 'var(--blk)'
};
const ICON: Record<AssuranceState, string> = {
  Autonomous: '✓', Degraded: '!', Supervised: '👁', Unknown: '?', Blocked: '■'
};
const ALL_MODES: NeSyMode[] = ['Autonomous', 'Monitoring', 'Advisory', 'Intervention', 'Emergency'];

export default function AssuranceShell() {
  const [view, setView] = useState('live');
  const [scenario, setScenario] = useState<'nominal'|'stale'|'conflict'|'unknown'>('nominal');
  const [evidence, setEvidence] = useState<EvidenceSnapshot | null>(null);
  const [logMsg, setLogMsg] = useState("");
  // Accumulate evidence snapshots for the monitoring panel
  const [evidenceHistory, setEvidenceHistory] = useState<EvidenceSnapshot[]>([]);

  // Source type tracking - default to replay (synthetic behind ?synthetic=1 flag)
  const [sourceType, setSourceType] = useState<'synthetic'|'replay'|'telemetry'>('replay');
  const [replayScenario, setReplayScenario] = useState<'r2b_nominal'|'r2b_stale'|'r2b_conflict'|'r2b_unknown' | null>('r2b_nominal');

  // Replay view state
  const [incidents, setIncidents] = useState<IncidentBundle[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentBundle | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Fleet flag — read from env or query string
  const fleetEnabled =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('fleet') === '1'
        || process.env.NEXT_PUBLIC_FLEET_VIEW === 'true'
      : process.env.NEXT_PUBLIC_FLEET_VIEW === 'true';

  const syntheticEnabled =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('synthetic') === '1'
        || process.env.NEXT_PUBLIC_SYNTHETIC === 'true'
      : process.env.NEXT_PUBLIC_SYNTHETIC === 'true';

  // Fleet aggregator backed by the single real robot in the r2b dataset.
  const fleetAggregator = useMemo(
    () => fleetEnabled ? createReplayFleet() : null,
    [fleetEnabled]
  );

  // Fusion metrics measured from the real telemetry stream (sharpness,
  // LiDAR intensity). Null fields = not enough data yet.
  const [fusionMetrics, setFusionMetrics] = useState<FusionMetrics>({
    sharpnessLow: null, blurTrendUp: null, intensityDropped: null, calibrationStale: null
  });
  const metricsBufferRef = useRef<FusionMetricsBuffer | null>(null);
  const [disagreeStreak, setDisagreeStreak] = useState(0);
  const disagreeStreakRef = useRef(0);
  const lastEvidenceTRef = useRef(-Infinity);
  const [alertFocus, setAlertFocus] = useState<string | null>(null);

  const source = useMemo(() => {
    if (sourceType === 'replay' && replayScenario) {
      return new ReplaySource({ sseUrl: `/api/replay/${replayScenario}` });
    }
    if (sourceType === 'synthetic') {
      return new SyntheticSource();
    }
    return new ReplaySource({ sseUrl: `/api/replay/r2b_nominal` });
  }, [sourceType, replayScenario]);
  const contract = useMemo(() => getDefaultContract(), []);
  const sm = useMemo(() => new AssuranceStateMachine(), [sourceType, replayScenario, scenario]);
  const recorder = useMemo(() => new IncidentRecorder(), []);

  useEffect(() => {
    recorder.start(contract.mission, contract.version, sourceType === 'telemetry' ? 'live' : sourceType);
    return () => recorder.stop();
  }, [recorder, contract, sourceType]);

  useEffect(() => {
    if (sourceType === 'synthetic') {
      (source as SyntheticSource).setScenario(scenario);
    }
    // Reset history when source changes
    setEvidenceHistory([]);
    source.onSnapshot((s) => {
      setEvidence(s);
      setEvidenceHistory(prev => {
        const next = [...prev, s];
        return next.length > 300 ? next.slice(-300) : next;
      });
      
      // Check for new alerts
      const newAlerts = checkAlerts(s, alerts);
      if (newAlerts.length > 0) {
        setAlerts(prev => [...prev, ...newAlerts]);
      }
    });
    source.start();
    return () => source.stop();
  }, [source, scenario, sourceType]);

  // Measure fusion inputs from the real telemetry stream (same r2b bag).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const buf = new FusionMetricsBuffer();
    metricsBufferRef.current = buf;
    const ts = new TelemetrySource({ sseUrl: '/api/telemetry/r2b_telemetry' });
    let frameCount = 0;
    ts.onSnapshot((d) => {
      buf.push(d);
      frameCount += 1;
      // Update React state ~2x/sec; metrics are DERIVED from real frames.
      if (frameCount % 5 === 0) setFusionMetrics(buf.metrics());
    });
    ts.start();
    return () => { ts.stop(); metricsBufferRef.current = null; };
  }, []);

  // Track consecutive frames of camera/LiDAR disagreement for fusion persistence.
  useEffect(() => {
    if (!evidence) return;
    // Replay loops: reset streak when t moves backwards.
    if (evidence.t < lastEvidenceTRef.current) disagreeStreakRef.current = 0;
    lastEvidenceTRef.current = evidence.t;
    const disagree =
      evidence.items['sensors_agree']?.status === 'bad' ||
      evidence.items['glare_detected']?.value === 'true';
    disagreeStreakRef.current = disagree ? disagreeStreakRef.current + 1 : 0;
    setDisagreeStreak(disagreeStreakRef.current);
  }, [evidence]);

  // Derive NeSy mode: for replay use dataset's state field
  const nesyMode: NeSyMode = (() => {
    if (sourceType === 'replay' && evidence) {
      const percPct = parseFloat(evidence.items['perception_pct']?.value ?? '100');
      const uncPct = parseFloat(evidence.items['uncertainty_pct']?.value ?? '0');
      const camBad = evidence.items['camera_age_ms']?.status === 'bad';
      const sensorsBad = evidence.items['sensors_agree']?.status === 'bad';
      if (uncPct > 60 || (!evidence.items['perception_pct'])) return 'Emergency';
      if (sensorsBad || uncPct > 30) return 'Advisory';
      if (camBad || percPct < 70) return 'Monitoring';
      return 'Autonomous';
    }
    return scenario === 'stale' || scenario === 'conflict' ? 'Advisory' : scenario === 'unknown' ? 'Emergency' : 'Autonomous';
  })();
  let res: import("../domain/types").AssuranceResult | null = null;
  let checks: Record<string, ContractCheckResult> = {};
  let fusionReport: DiagnosisReport | null = null;

  if (evidence) {
    const modifiedEvidence = evidence;

    // Real fusion input: disagreement signal from evidence, cause checks from
    // measured telemetry (sharpness, LiDAR intensity) and calibration file.
    const fusionInput = buildFusionInput(modifiedEvidence, disagreeStreak, fusionMetrics);
    fusionReport = evaluateFusion(fusionInput);
    const conflict = fusionInput.sensorsDisagree && disagreeStreak >= 5;

    checks = evaluateContract(contract, modifiedEvidence);
    // State machine config times are in ms; replay t is in seconds, synthetic t is Date.now() ms
    const tickT = sourceType === 'replay' ? modifiedEvidence.t * 1000 : modifiedEvidence.t;
    res = sm.tick(tickT, checks, conflict, nesyMode, modifiedEvidence);
  }

  // Feed the single real robot's state into the fleet aggregator (throttled).
  const lastFleetPushRef = useRef(0);
  useEffect(() => {
    if (!fleetAggregator || !res || !evidence) return;
    const now = Date.now();
    if (res.state !== fleetAggregator.getSnapshot().robots[0]?.state || now - lastFleetPushRef.current > 1000) {
      lastFleetPushRef.current = now;
      fleetAggregator.updateRobotState(REPLAY_ROBOT_ID, res.state, evidence, 'Not in dataset');
    }
  }, [fleetAggregator, res?.state, evidence]);

  // Record state changes and periodic evidence snapshots (recorder throttles to 2s)
  useEffect(() => {
    if (res && evidence) {
      recorder.recordState(res.state, res.why, res.recommendation, res.known, res.unknown, res.violated, evidence);
      recorder.recordEvidence(evidence);
    }
  }, [res?.state, res?.why.join(','), recorder, evidence]); // trigger when state or why changes

  // Fetch incidents when entering replay view
  useEffect(() => {
    if (view === 'replay') {
      setIncidents(IncidentStore.getAll());
    }
  }, [view]);

  const logAction = (act: string) => {
    setLogMsg(`${act} at ${new Date().toLocaleTimeString()}. Logged only, robot not touched.`);
    recorder.recordOperatorAction(act);
  };

  const exportJSON = (bundle: IncidentBundle) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bundle, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `${bundle.incident_id}.json`);
    dlAnchorElem.click();
  };

  // Show telemetry layout when in telemetry mode
  if (sourceType === 'telemetry') {
    return (
      <div className="v2-root">
        <TelemetryLayout
          sseUrl="/api/telemetry/r2b_telemetry"
          onBack={() => setSourceType('replay')}
        />
      </div>
    );
  }

  // Show camera wall when in camera mode
  if (view === 'camera') {
    return (
      <div className="v2-root">
        <CameraWall
          sseUrl="/api/telemetry/r2b_telemetry"
          onBack={() => setView('live')}
        />
      </div>
    );
  }

  return (
    <div className="v2-root">
      <div className="v2-wall" />
      <header className="v2-menubar">
        <b>MindBridge</b>
        <span>Robot r2b-01 — NVIDIA r2b datacenter replay</span>
        <span style={{flex:1}} />
        {syntheticEnabled && (
          <>
            <span style={{fontSize:'12px', color:'var(--ink2)'}}>Scenario</span>
            <select value={scenario} onChange={e => {
              setScenario(e.target.value as any);
              setSourceType('synthetic');
              setReplayScenario(null);
            }} style={{padding:'3px 8px', borderRadius:'7px', border:'1px solid var(--line)', background:'rgba(255,255,255,.8)', color:'var(--ink)'}}>
              <option value="nominal">Nominal run</option>
              <option value="stale">Stale camera</option>
              <option value="conflict">Camera and LiDAR conflict</option>
              <option value="unknown">Evidence missing</option>
            </select>
          </>
        )}
        <span style={{fontSize:'11px', padding:'2px 8px', borderRadius:'99px', border:'1px solid var(--line)', background:'#fff', color:'var(--ink2)'}}>
          {sourceType === 'replay'
            ? `Replay: NVIDIA r2b 2023 - ${(replayScenario || 'r2b_nominal').replace('r2b_', '')}`
            : 'Synthetic demo data'}
        </span>
        {res && (
          <span className="v2-chip" data-s={res.state} style={{'--c': STATE_COLORS[res.state]} as any}>
            <i>{ICON[res.state]}</i><span>{res.state}</span>
          </span>
        )}
        <InterfaceSwitch target="classic" />
      </header>

      <main className="v2-stage">
        {view === 'live' && res && evidence && (
          <div className="v2-view on">
            <div className="v2-panel v2-c5">
              <h2>Assurance state</h2>
              <div style={{marginBottom:'8px'}}>
                <span className="v2-chip" data-s={res.state} style={{'--c': STATE_COLORS[res.state], fontSize:'20px', padding:'6px 16px 6px 6px'} as any}>
                  <i style={{width:'30px', height:'30px', fontSize:'16px'}}>{ICON[res.state]}</i><span>{res.state}</span>
                </span>
              </div>
              <div className="v2-rec" style={{'--c': STATE_COLORS[res.state]} as any}>{res.recommendation}</div>
              <h3 style={{fontSize:'12px', fontWeight:600, color:'var(--ink2)', margin:'10px 0 4px'}}>Why</h3>
              <ul className="v2-why" style={{'--c': STATE_COLORS[res.state]} as any}>
                {res.why.length > 0 ? res.why.map((w,i) => <li key={i}>{w}</li>) : <li>All contract checks pass</li>}
              </ul>
              {alerts.length > 0 && (
                <>
                  <h3 style={{fontSize:'12px', fontWeight:600, color:'var(--ink2)', margin:'10px 0 4px'}}>Active Alerts</h3>
                  <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                    {alerts.slice(-3).map((alert, i) => {
                      const target = ALERT_TO_ASSUMPTION[alert.ruleId];
                      return (
                        <div key={i}
                          onClick={() => {
                            if (target) { setAlertFocus(target); setView('contract'); }
                            else setView('live');
                          }}
                          style={{padding:'8px', background:'rgba(196,22,42,0.06)', borderRadius:'6px', border:'1px solid rgba(196,22,42,0.2)', fontSize:'11px', cursor:'pointer'}}
                          title={target ? 'Click to see the failing contract check' : 'Click to view live evidence'}
                        >
                          <div style={{fontWeight:600, color: alert.kind === 'unknown_evidence' ? 'var(--ink2)' : '#c4162a'}}>{alert.ruleName} →</div>
                          <div style={{color:'var(--ink2)', marginTop:'2px'}}>{alert.description}</div>
                          {alert.kind === 'unknown_evidence' ? (
                            <div style={{color:'var(--ink2)'}}>Missing: {alert.missingFields?.join(', ') || 'unknown'}</div>
                          ) : (
                            <div style={{color:'var(--ink2)'}}>Value: {evidence.items[ALERT_RULES.find(r => r.id === alert.ruleId)?.fields[0] ?? '']?.value || 'no data'}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="v2-btns">
                <button className="v2-btn p" onClick={()=>logAction('Acknowledged')}>Acknowledge</button>
                <button className="v2-btn" onClick={()=>logAction('Escalated to supervisor')}>Escalate</button>
                <button className="v2-btn" onClick={()=>logAction('Override logged')}>Override</button>
                <button className="v2-btn" onClick={()=>logAction('Operator decision logged')}>Log my decision</button>
                <button className="v2-btn" onClick={()=>logAction('Incident saved')}>Save incident</button>
              </div>
              <p style={{fontSize:'12px', color:'var(--ink2)', marginTop:'8px'}}>{logMsg || 'MindBridge only recommends. It never commands the robot.'}</p>
            </div>

            <div className="v2-panel v2-c7">
              <h2>Floor map</h2>
              <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'180px', gap:'8px'}}>
                <span style={{fontSize:'28px'}} aria-hidden="true">🗺️</span>
                <p style={{fontSize:'13px', color:'var(--ink2)', textAlign:'center', margin:0}}>
                  No pose or map in dataset
                </p>
                <p style={{fontSize:'11px', color:'var(--ink2)', textAlign:'center', margin:0}}>
                  The r2b bag contains no odometry, SLAM pose, or map topics, so robot position cannot be shown.
                </p>
              </div>
            </div>

            <div className="v2-panel v2-c6">
              <h2>Evidence</h2>
              <div>
                {Object.values(evidence.items).map(ev => (
                  <div key={ev.id} className="v2-row" title={ev.derived ? `DERIVED: ${ev.derived}` : undefined}>
                    <span className="n">{ev.label}{ev.derived ? ' · DERIVED' : ''}</span>
                    <span className="v">{ev.value}</span>
                    <span className={`v2-st ${ev.status}`}>{ev.status === 'ok' ? 'Within limit' : ev.status === 'warn' ? 'Watch' : ev.status === 'bad' ? 'Violated' : 'No data'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="v2-panel v2-c6">
              <h2>NeSyConf (existing engine)</h2>
              {(() => {
                // Only show gauges for values actually present in the evidence.
                // perception_pct / uncertainty_pct are DERIVED (formula on hover
                // in the Evidence panel). Plan certainty is not in the dataset.
                const percItem = evidence.items['perception_pct'];
                const uncItem = evidence.items['uncertainty_pct'];
                const percVal = percItem ? Math.min(100, Math.max(0, Math.round(parseFloat(percItem.value)))) : null;
                const uncVal = uncItem ? Math.min(100, Math.max(0, Math.round(parseFloat(uncItem.value)))) : null;

                return (
                  <div>
                    <div className="v2-row">
                       <span className="n" style={{flex:'none', width:'130px'}}>Perception{percItem?.derived ? ' · DERIVED' : ''}</span>
                       {percVal !== null ? (
                         <>
                           <div className="v2-bar"><span style={{width:`${percVal}%`, background: percVal < 70 ? 'var(--deg)' : 'var(--accent)'}}></span></div>
                           <span className="v" style={{width:'40px', textAlign:'right'}}>{percVal}%</span>
                         </>
                       ) : <span className="v">Not in dataset</span>}
                    </div>
                    <div className="v2-row">
                       <span className="n" style={{flex:'none', width:'130px'}}>Plan certainty</span>
                       <span className="v">Not in dataset</span>
                    </div>
                    <div className="v2-row">
                       <span className="n" style={{flex:'none', width:'130px'}}>System uncertainty{uncItem?.derived ? ' · DERIVED' : ''}</span>
                       {uncVal !== null ? (
                         <>
                           <div className="v2-bar"><span style={{width:`${uncVal}%`, background: uncVal > 30 ? 'var(--blk)' : 'var(--sup)'}}></span></div>
                           <span className="v" style={{width:'40px', textAlign:'right'}}>{uncVal}%</span>
                         </>
                       ) : <span className="v">Not in dataset</span>}
                    </div>
                  </div>
                );
              })()}
              <h3 style={{fontSize:'12px', fontWeight:600, color:'var(--ink2)', margin:'10px 0 4px'}}>Current NeSyConf mode</h3>
              <div className="v2-modes">
                {ALL_MODES.map(m => <span key={m} className={m === nesyMode ? 'on' : ''}>{m}</span>)}
              </div>
            </div>

            {/* Live monitoring panel — full width below the two right panels */}
            <div className="v2-panel v2-c12">
              <MonitoringPanel
                history={evidenceHistory}
                sourceType={sourceType}
                replayScenario={replayScenario}
              />
            </div>
          </div>
        )}

        {view === 'contract' && evidence && (
          <div className="v2-view on">
            <div className="v2-panel v2-c12">
              <h2>Autonomy contract: {contract.mission}</h2>
              <table className="v2-table">
                <thead><tr><th>Assumption</th><th>Limit</th><th>Now</th><th>Status</th></tr></thead>
                <tbody>
                  {contract.assumptions.map(a => {
                    const result = checks[a.id];
                    const inDataset = a.inDataset !== false;
                    const status = inDataset ? (result?.status ?? 'unk') : 'unk';
                    const val = inDataset ? (result?.value ?? 'Not in dataset') : 'Not in dataset';
                    const focused = alertFocus === a.id;
                    return (
                      <tr key={a.id} style={focused ? {background:'rgba(196,22,42,0.08)'} : undefined}>
                        <td>{a.label}</td><td>{a.limit}</td><td className="v">{val}</td>
                        <td><span className={`v2-st ${status}`} style={{textAlign:'left'}}>{!inDataset ? 'Not in dataset' : status === 'ok' ? 'Within limit' : status === 'warn' ? 'Watch' : status === 'bad' ? 'Violated' : 'No data'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'fusion' && (
          <div className="v2-view on">
            <div className="v2-panel v2-c12">
              <h2>Sensor fusion check</h2>
              {fusionReport && fusionReport.rankedCauses.length > 0 ? (
                <>
                  <p style={{color:'var(--ink2)', fontSize:'13px', marginBottom:'16px'}}>
                    Camera and LiDAR disagree. Location: <b>{fusionReport.conflictLocation ?? 'Not enough evidence'}</b>
                    {fusionReport.unresolved && <span style={{color:'#a15c00'}}> — unresolved, cause not confirmed</span>}
                  </p>
                  {fusionReport.syncFault ? (
                    <div className="v2-rec" style={{'--c': 'var(--blk)'} as any}>Sync fault: cannot align sensors.</div>
                  ) : (
                    <div style={{display:'flex', gap:'20px'}}>
                      <div style={{flex:1}}>
                        <h3 style={{fontSize:'12px', fontWeight:600, color:'var(--ink2)'}}>Ranked causes</h3>
                        {fusionReport.rankedCauses.map((c, i) => (
                          <div key={i} style={{border:'1px solid var(--line)', borderRadius:'12px', padding:'12px', marginBottom:'10px', background: i === 0 && !fusionReport.unresolved ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.4)'}}>
                            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                              <b>{i+1}. {c.name}</b>
                              <span style={{fontSize:'11px', color:'var(--ink2)'}}>{c.checksMet} of {c.checksTotal} checks</span>
                            </div>
                            <div style={{display:'flex', gap:'6px', flexWrap:'wrap'}}>
                              {c.evidence.map((ev, j) => (
                                <span key={j} style={{fontSize:'10px', padding:'2px 8px', borderRadius:'6px', background: ev.met ? 'var(--auto)' : '#fff', color: ev.met ? '#fff' : 'var(--ink2)', border: '1px solid ' + (ev.met ? 'var(--auto)' : 'var(--line)')}}>
                                  {ev.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{width:'260px'}}>
                        <h3 style={{fontSize:'12px', fontWeight:600, color:'var(--ink2)'}}>Suggested checks</h3>
                        <ul className="v2-why" style={{'--c': 'var(--ink)'} as any}>
                          {fusionReport.suggestedChecks.map((sc, i) => <li key={i}>{sc}</li>)}
                        </ul>
                        <div style={{marginTop:'20px', padding:'10px', borderRadius:'8px', background:'rgba(20,30,50,.04)', fontSize:'12px'}}>
                          <b>MindBridge cannot tell:</b><br/>{fusionReport.cannotTell}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p style={{color:'var(--ink2)', fontSize:'12px'}}>No sustained sensor conflict in the current replay. Conflict signals must persist for 5 frames before a report is produced.</p>
              )}
            </div>
          </div>
        )}

        {view === 'sources' && (
          <div className="v2-view on">
            <div className="v2-panel v2-c12">
              <h2>Evidence sources</h2>
              {syntheticEnabled && (
                <div
                  className="v2-row"
                  style={{cursor: 'pointer'}}
                  onClick={() => {
                    setSourceType('synthetic');
                    setReplayScenario(null);
                  }}
                >
                  <span className="n">Synthetic scenarios</span>
                  <span className={`v2-st ${sourceType === 'synthetic' ? '' : 'unk'}`}>
                    {sourceType === 'synthetic' ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              )}
              <div
                className="v2-row"
                style={{cursor: 'pointer'}}
                onClick={() => {
                  setSourceType('replay');
                  if (!replayScenario) setReplayScenario('r2b_nominal');
                }}
              >
                <span className="n">Recorded ROS2 bag (MCAP replay)</span>
                <span className={`v2-st ${sourceType === 'replay' ? '' : 'unk'}`}>
                  {sourceType === 'replay' ? `Connected (${replayScenario || 'r2b_nominal'})` : 'Not connected'}
                </span>
              </div>
              <div className="v2-row"><span className="n">Live ROS2 monitor</span><span className="v2-st unk">Not connected</span></div>
              <div className="v2-row"><span className="n">CASSANDRA acoustic plugin</span><span className="v2-st unk">Later</span></div>

              <div style={{marginTop:'32px', paddingTop:'20px', borderTop:'1px solid var(--line)'}}>
                <h3 style={{fontSize:'14px', fontWeight:600, color:'var(--ink)', marginBottom:'12px'}}>Real data replay (NVIDIA r2b 2023)</h3>
                <div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px'}}>
                  <button
                    className="v2-btn"
                    style={{background: sourceType === 'replay' && replayScenario === 'r2b_nominal' ? 'var(--accent)' : undefined,
                            color: sourceType === 'replay' && replayScenario === 'r2b_nominal' ? '#fff' : undefined}}
                    onClick={() => {
                      setSourceType('replay');
                      setReplayScenario('r2b_nominal');
                    }}
                  >
                    Nominal run
                  </button>
                  <button
                    className="v2-btn"
                    style={{background: sourceType === 'replay' && replayScenario === 'r2b_stale' ? 'var(--accent)' : undefined,
                            color: sourceType === 'replay' && replayScenario === 'r2b_stale' ? '#fff' : undefined}}
                    onClick={() => {
                      setSourceType('replay');
                      setReplayScenario('r2b_stale');
                    }}
                  >
                    Stale camera
                  </button>
                  <button
                    className="v2-btn"
                    style={{background: sourceType === 'replay' && replayScenario === 'r2b_conflict' ? 'var(--accent)' : undefined,
                            color: sourceType === 'replay' && replayScenario === 'r2b_conflict' ? '#fff' : undefined}}
                    onClick={() => {
                      setSourceType('replay');
                      setReplayScenario('r2b_conflict');
                    }}
                  >
                    Conflict: glare
                  </button>
                  <button
                    className="v2-btn"
                    style={{background: sourceType === 'replay' && replayScenario === 'r2b_unknown' ? 'var(--accent)' : undefined,
                            color: sourceType === 'replay' && replayScenario === 'r2b_unknown' ? '#fff' : undefined}}
                    onClick={() => {
                      setSourceType('replay');
                      setReplayScenario('r2b_unknown');
                    }}
                  >
                    Evidence missing
                  </button>
                  <button
                    className="v2-btn"
                    onClick={() => setView('camera')}
                  >
                    Camera Wall
                  </button>
                </div>
                <div style={{marginTop:'12px', display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px'}}>
                  <button
                    className="v2-btn"
                    onClick={() => {
                      setSourceType('telemetry');
                    }}
                  >
                    Replay Telemetry Dashboard
                  </button>
                </div>
                <p style={{fontSize:'11px', color:'var(--ink2)', margin:0}}>
                  Attribution: NVIDIA r2b Dataset 2023 (CC BY 4.0). Faults injected by converter.
                </p>
              </div>
            </div>
          </div>
        )}

        {view === 'replay' && (
          <div className="v2-view on">
            <div className="v2-panel v2-c12">
              <h2>Incident replay</h2>
              {incidents.length === 0 && !selectedIncident ? (
                <p style={{color:'var(--ink2)', fontSize:'12px'}}>No incidents recorded yet. Generate some state changes or operator actions in the Evidence view, or load an exported bundle below.</p>
              ) : (
                <>
                  {/* Incident list */}
                  {incidents.length > 0 && (
                  <div style={{marginBottom:'12px', display:'flex', flexWrap:'wrap', gap:'8px'}}>
                    {incidents.map(inc => (
                      <button key={inc.incident_id} className="v2-btn"
                        style={{background: selectedIncident?.incident_id === inc.incident_id ? 'var(--accent)' : undefined,
                                color: selectedIncident?.incident_id === inc.incident_id ? '#fff' : undefined}}
                        onClick={() => setSelectedIncident(inc)}>
                        {inc.incident_id.slice(-8)} · {inc.events.length} events
                      </button>
                    ))}
                  </div>
                  )}

                  {/* Scrubber for selected incident */}
                  {selectedIncident ? (
                    <ReplayScrubber
                      incident={selectedIncident}
                      onClose={() => setSelectedIncident(null)}
                    />
                  ) : (
                    <p style={{fontSize:'12px', color:'var(--ink2)'}}>Select an incident above to replay it.</p>
                  )}

                  {/* Export */}
                  {selectedIncident && (
                    <button className="v2-btn" style={{marginTop:'8px'}} onClick={() => exportJSON(selectedIncident)}>
                      Export JSON
                    </button>
                  )}
                </>
              )}

              {/* Load an exported incident bundle — replays from its own snapshots only.
                  Always reachable, even with zero locally recorded incidents. */}
              <label className="v2-btn" style={{display:'inline-block', marginTop:'12px', cursor:'pointer'}}>
                Load exported incident JSON…
                <input type="file" accept="application/json,.json" style={{display:'none'}}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const parsed = JSON.parse(String(reader.result));
                        if (!isIncidentBundle(parsed)) {
                          setLogMsg('That file is not a valid incident bundle.');
                          return;
                        }
                        setSelectedIncident(parsed);
                        setLogMsg(`Loaded incident ${parsed.incident_id} — replaying from its own recorded evidence.`);
                      } catch {
                        setLogMsg('Could not parse that file as JSON.');
                      }
                    };
                    reader.readAsText(f);
                    e.target.value = '';
                  }} />
              </label>
            </div>
          </div>
        )}

        {view === 'fleet' && (
          <div className="v2-view on">
            {fleetEnabled && fleetAggregator ? (
              <div style={{gridColumn:'span 12'}}>
                <FleetView
                  aggregator={fleetAggregator}
                  onSelectRobot={() => {
                    // Single-robot dataset: the fleet card opens the Evidence view,
                    // which already shows this robot's real evidence.
                    setView('live');
                  }}
                />
              </div>
            ) : (
              <div className="v2-panel v2-c12">
                <p style={{color:'var(--ink2)', fontSize:'12px'}}>Fleet view is disabled. Add <code>?fleet=1</code> to the URL or set <code>NEXT_PUBLIC_FLEET_VIEW=true</code>.</p>
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="v2-dock" aria-label="Views">
        <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}><span aria-hidden="true">◉</span><span className="tip">Evidence</span></button>
        <button className={view === 'fusion' ? 'on' : ''} onClick={() => setView('fusion')}><span aria-hidden="true">⇄</span><span className="tip">Sensor fusion</span></button>
        <button className={view === 'contract' ? 'on' : ''} onClick={() => setView('contract')}><span aria-hidden="true">☰</span><span className="tip">Contract</span></button>
        <button className={view === 'replay' ? 'on' : ''} onClick={() => setView('replay')}><span aria-hidden="true">↺</span><span className="tip">Replay</span></button>
        <button className={view === 'sources' ? 'on' : ''} onClick={() => setView('sources')}><span aria-hidden="true">⌨</span><span className="tip">Sources</span></button>
        <button disabled={!fleetEnabled} className={view === 'fleet' ? 'on' : ''} onClick={() => fleetEnabled && setView('fleet')} title={fleetEnabled ? undefined : 'Fleet (disabled — add ?fleet=1 to enable)'}><span aria-hidden="true">▦</span><span className="tip">{fleetEnabled ? 'Fleet' : 'Fleet (disabled)'}</span></button>
      </nav>
    </div>
  );
}
