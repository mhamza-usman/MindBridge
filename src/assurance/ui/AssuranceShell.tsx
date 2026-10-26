"use client";
import React, { useEffect, useState, useMemo } from "react";
import "./AssuranceStyles.css";
import { SyntheticSource } from "../sources/synthetic";
import { ReplaySource, ReplaySourceOptions } from "../sources/replay";
import { getDefaultContract } from "../contract/loader";
import { evaluateContract } from "../contract/evaluator";
import { AssuranceStateMachine } from "../domain/stateMachine";
import { EvidenceSnapshot, AssuranceState, NeSyMode } from "../domain/types";
import { IncidentRecorder } from "../incidents/recorder";
import { IncidentStore } from "../incidents/store";
import { IncidentBundle } from "../incidents/types";
import { evaluateFusion, FusionInput } from "../fusion/detector";
import { FleetView } from "./fleet/FleetView";
import { createSyntheticFleet } from "../fleet/syntheticFleet";
import { ReplayScrubber } from "./ReplayScrubber";
import { MonitoringPanel } from "./MonitoringPanel";
import TelemetryLayout from "../telemetry/ui/TelemetryLayout";
import DatasetImporter from "./DatasetImporter";

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

  // Source type tracking
  const [sourceType, setSourceType] = useState<'synthetic'|'replay'|'telemetry'>('synthetic');
  const [replayScenario, setReplayScenario] = useState<'r2b_nominal'|'r2b_stale'|'r2b_conflict'|'r2b_unknown' | null>(null);

  // Replay view state
  const [incidents, setIncidents] = useState<IncidentBundle[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentBundle | null>(null);

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

  const fleetAggregator = useMemo(
    () => fleetEnabled ? createSyntheticFleet() : null,
    [fleetEnabled]
  );

  const source = useMemo(() => {
    if (sourceType === 'replay' && replayScenario) {
      return new ReplaySource({ sseUrl: `/api/replay/${replayScenario}` });
    }
    return new SyntheticSource();
  }, [sourceType, replayScenario]);
  const contract = useMemo(() => getDefaultContract(), []);
  const sm = useMemo(() => new AssuranceStateMachine(), []);
  const recorder = useMemo(() => new IncidentRecorder(), []);

  useEffect(() => {
    recorder.start(contract.mission, contract.version, sourceType);
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
    });
    source.start();
    return () => source.stop();
  }, [source, scenario, sourceType]);

  // Derive NeSy mode: for replay use dataset's state field; for synthetic use scenario name
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
  let res = null;
  let checks = {};
  let fusionReport = null;

  if (evidence) {
    let modifiedEvidence = { ...evidence };

    // Inject fusion result into evidence
    // For replay: detect conflict from dataset fields
    const replayConflict = sourceType === 'replay' && (
      evidence.items['sensors_agree']?.status === 'bad' ||
      evidence.items['glare_detected']?.value === 'true'
    );
    const conflict = scenario === 'conflict' || replayConflict;
    if (conflict) {
      const mockFusionInput: FusionInput = {
        syncSkewMs: 10,
        persistenceCount: 5,
        cameraSeesObject: true,
        lidarSeesObject: false,
        exposureSaturated: true,
        brightPatchOverlaps: true,
        floorIsPolished: true,
        objectAbsentEarlier: true,
        imageSharpnessLow: false,
        lidarIntensityDropped: false,
        blurIncreasing: false,
        calibrationOld: false,
        sameOffsetOtherObjects: false,
        recentBump: false,
        objectPresentEarlier: false,
        shapeMatchesKnown: false,
        heightBelowLidar: false
      };
      fusionReport = evaluateFusion(mockFusionInput);
      modifiedEvidence.items['sensors_agree'] = {
        id: 'sensors_agree',
        label: 'Sensors agree',
        value: fusionReport.unresolved ? 'Unresolved conflict' : fusionReport.rankedCauses[0]?.name || 'Conflict detected',
        status: fusionReport.unresolved ? 'unk' : 'bad',
        source: 'synthetic',
        t: evidence.t
      };
    }

    checks = evaluateContract(contract, modifiedEvidence);
    res = sm.tick(modifiedEvidence.t, checks, conflict, nesyMode);
  }

  // Record state changes
  useEffect(() => {
    if (res && evidence) {
      recorder.recordState(res.state, res.why, res.recommendation, res.known, res.unknown, res.violated);
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
        <TelemetryLayout sseUrl="/api/telemetry/r2b_telemetry" />
      </div>
    );
  }

  return (
    <div className="v2-root">
      <div className="v2-wall" />
      <header className="v2-menubar">
        <b>MindBridge</b>
        <span>Robot RB-07, warehouse aisle B pickup</span>
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
          {sourceType === 'replay' && replayScenario
            ? `Replay: NVIDIA r2b 2023 - ${replayScenario.replace('r2b_', '')}`
            : sourceType === 'telemetry' ? 'Live Telemetry'
            : 'Synthetic demo data'}
        </span>
        {res && (
          <span className="v2-chip" data-s={res.state} style={{'--c': STATE_COLORS[res.state]} as any}>
            <i>{ICON[res.state]}</i><span>{res.state}</span>
          </span>
        )}
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
              <div className="v2-btns">
                <button className="v2-btn p" onClick={()=>logAction('Acknowledged')}>Acknowledge</button>
                <button className="v2-btn" onClick={()=>logAction('Escalated to supervisor')}>Escalate</button>
                <button className="v2-btn" onClick={()=>logAction('Operator decision logged')}>Log my decision</button>
                <button className="v2-btn" onClick={()=>logAction('Incident saved')}>Save incident</button>
              </div>
              <p style={{fontSize:'12px', color:'var(--ink2)', marginTop:'8px'}}>{logMsg || 'MindBridge only recommends. It never commands the robot.'}</p>
            </div>

            <div className="v2-panel v2-c7">
              <h2>Floor map</h2>
              {(() => {
                const isConflict = scenario === 'conflict' || (sourceType === 'replay' && (replayScenario === 'r2b_conflict' || evidence.items['glare_detected']?.value === 'true' || evidence.items['sensors_agree']?.status === 'bad'));
                const isStale = scenario === 'stale' || (sourceType === 'replay' && (replayScenario === 'r2b_stale' || evidence.items['camera_age_ms']?.status === 'bad'));
                const isUnknown = scenario === 'unknown' || (sourceType === 'replay' && (replayScenario === 'r2b_unknown' || res.state === 'Unknown'));
                const showCone = !isUnknown && !isStale;
                const showObst = isConflict;
                // Animate robot X: use t from evidence (0..90s) or conflict_at_m to set position
                const conflictAtM = parseFloat(evidence.items['uncertainty_pct'] ? '0' : '0');
                const progress = sourceType === 'replay'
                  ? Math.min(1, (evidence.t ?? 0) / 90)
                  : (scenario === 'conflict' ? 0.42 : scenario === 'stale' ? 0.25 : scenario === 'unknown' ? 0.05 : 0.1);
                const robotX = 70 + progress * 220; // 70..290 px along aisle
                const conflictX = isConflict ? Math.min(robotX + 40, 290) : 228;
                const mapNote = isConflict
                  ? `Conflict detected near position ${(progress * 5).toFixed(1)} m. Polished floor zone.`
                  : isStale
                  ? 'Camera coverage is stale. LiDAR still fresh.'
                  : isUnknown
                  ? 'No valid sensor coverage.'
                  : `Sensors agree. Robot at ${(progress * 5).toFixed(1)} m. Path clear to Bin 42.`;

                return (
                  <div>
                    <svg viewBox="0 0 420 220" width="100%" role="img" aria-label="Floor map with robot, goal and sensor coverage" style={{display:'block'}}>
                      <rect x="6" y="6" width="408" height="208" rx="10" fill="#fff" stroke="rgba(20,30,50,.12)"/>
                      <g fill="#e8edf7">
                        <rect x="30" y="30" width="150" height="34" rx="6"/>
                        <rect x="30" y="156" width="150" height="34" rx="6"/>
                        <rect x="230" y="30" width="150" height="34" rx="6"/>
                        <rect x="230" y="156" width="150" height="34" rx="6"/>
                      </g>
                      <text x="34" y="26" fontSize="11" fill="var(--ink2)" fontFamily="var(--font)">Rack A</text>
                      <text x="234" y="26" fontSize="11" fill="var(--ink2)" fontFamily="var(--font)">Rack B</text>

                      {isConflict && (
                        <g>
                          <rect x="196" y="84" width="60" height="52" rx="8" fill="#fff4d6" stroke="#e5c56b" strokeDasharray="4 3"/>
                          <text x="200" y="146" fontSize="10" fill="#a15c00" fontFamily="var(--font)">Polished floor</text>
                        </g>
                      )}

                      <path d="M60 110 H330" stroke="#0a66ff" strokeWidth="2" strokeDasharray="5 4" fill="none" opacity="0.6"/>

                      {showCone && (
                        <polygon points="120,110 190,80 190,140" fill="rgba(10,102,255,.14)" stroke="#0a66ff" strokeDasharray="3 3"/>
                      )}

                      {showObst && (
                        <g>
                          <circle cx={conflictX} cy="108" r="8" fill="none" stroke="#c4162a" strokeWidth="2" strokeDasharray="3 2"/>
                          <text x={conflictX - 14} y="96" fontSize="10" fill="#c4162a" fontFamily="var(--font)">Camera: object</text>
                          <text x={conflictX - 14} y="128" fontSize="10" fill="#1e8e4e" fontFamily="var(--font)">LiDAR: clear</text>
                        </g>
                      )}

                      {/* Robot dot — animated along the aisle */}
                      <circle cx={robotX} cy="110" r="9" fill={isUnknown ? 'var(--unk)' : isConflict ? 'var(--blk)' : isStale ? 'var(--deg)' : '#0a66ff'} style={{transition:'cx .5s ease'}} />
                      {/* Velocity trail */}
                      {[1,2,3].map(k => (
                        <circle key={k} cx={robotX - k*12} cy="110" r={9 - k*2.5}
                          fill={isUnknown ? 'var(--unk)' : isConflict ? 'var(--blk)' : isStale ? 'var(--deg)' : '#0a66ff'}
                          opacity={0.15 / k} style={{transition:'cx .5s ease'}}
                        />
                      ))}
                      <text x={robotX - 14} y="134" fontSize="11" fontWeight="600" fill="var(--ink)" fontFamily="var(--font)">RB-07</text>

                      <circle cx="332" cy="110" r="7" fill="#1e8e4e"/>
                      <text x="318" y="98" fontSize="11" fill="var(--ink2)" fontFamily="var(--font)">Bin 42</text>
                    </svg>
                    <div style={{fontSize:'12px', color:'var(--ink2)', marginTop:'8px'}}>{mapNote}</div>
                  </div>
                );
              })()}
            </div>

            <div className="v2-panel v2-c6">
              <h2>Evidence</h2>
              <div>
                {Object.values(evidence.items).map(ev => (
                  <div key={ev.id} className="v2-row">
                    <span className="n">{ev.label}</span>
                    <span className="v">{ev.value}</span>
                    <span className={`v2-st ${ev.status}`}>{ev.status === 'ok' ? 'Within limit' : ev.status === 'warn' ? 'Watch' : ev.status === 'bad' ? 'Violated' : 'No data'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="v2-panel v2-c6">
              <h2>NeSyConf (existing engine)</h2>
              {(() => {
                // Wire gauges directly from evidence — works for both synthetic and replay
                const percVal = evidence.items['perception_pct']?.value
                  ? Math.min(100, Math.max(0, Math.round(parseFloat(evidence.items['perception_pct'].value))))
                  : (scenario==='nominal'?92:scenario==='stale'?68:scenario==='conflict'?71:0);
                const uncVal = evidence.items['uncertainty_pct']?.value
                  ? Math.min(100, Math.max(0, Math.round(parseFloat(evidence.items['uncertainty_pct'].value))))
                  : (scenario==='nominal'?8:scenario==='stale'?41:scenario==='conflict'?36:100);
                // Plan certainty: derived from perception and uncertainty together
                const planVal = Math.max(0, Math.round(percVal * 0.6 + (100 - uncVal) * 0.4));

                return (
                  <div>
                    <div className="v2-row">
                       <span className="n" style={{flex:'none', width:'130px'}}>Perception</span>
                       <div className="v2-bar"><span style={{width:`${percVal}%`, background: percVal < 70 ? 'var(--deg)' : 'var(--accent)'}}></span></div>
                       <span className="v" style={{width:'40px', textAlign:'right'}}>{percVal}%</span>
                    </div>
                    <div className="v2-row">
                       <span className="n" style={{flex:'none', width:'130px'}}>Plan certainty</span>
                       <div className="v2-bar"><span style={{width:`${planVal}%`, background: planVal < 60 ? 'var(--deg)' : 'var(--accent)'}}></span></div>
                       <span className="v" style={{width:'40px', textAlign:'right'}}>{planVal}%</span>
                    </div>
                    <div className="v2-row">
                       <span className="n" style={{flex:'none', width:'130px'}}>System uncertainty</span>
                       <div className="v2-bar"><span style={{width:`${uncVal}%`, background: uncVal > 30 ? 'var(--blk)' : 'var(--sup)'}}></span></div>
                       <span className="v" style={{width:'40px', textAlign:'right'}}>{uncVal}%</span>
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
                    const status = a.check(evidence);
                    const val = evidence.items[a.id]?.value ?? 'no data';
                    return (
                      <tr key={a.id}>
                        <td>{a.label}</td><td>{a.limit}</td><td className="v">{val}</td>
                        <td><span className={`v2-st ${status}`} style={{textAlign:'left'}}>{status === 'ok' ? 'Within limit' : status === 'warn' ? 'Watch' : status === 'bad' ? 'Violated' : 'No data'}</span></td>
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
              {fusionReport ? (
                <>
                  <p style={{color:'var(--ink2)', fontSize:'13px', marginBottom:'16px'}}>
                    Camera and LiDAR disagree. Location: <b>{fusionReport.conflictLocation}</b>
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
                <p style={{color:'var(--ink2)', fontSize:'12px'}}>No sensor conflict active. Select the "Camera and LiDAR conflict" scenario.</p>
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
                </div>
                <div style={{marginTop:'12px', display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px'}}>
                  <button
                    className="v2-btn"
                    style={{background: sourceType === 'telemetry' ? 'var(--accent)' : undefined,
                            color: sourceType === 'telemetry' ? '#fff' : undefined}}
                    onClick={() => {
                      setSourceType('telemetry');
                    }}
                  >
                    Live Telemetry Dashboard
                  </button>
                </div>
                <DatasetImporter onImport={async (url) => {
                  // TODO: Implement dataset import
                  console.log('Importing dataset from:', url);
                  alert('Dataset import feature - coming soon');
                }} />
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
              {incidents.length === 0 ? (
                <p style={{color:'var(--ink2)', fontSize:'12px'}}>No incidents recorded yet. Generate some state changes or operator actions in the Live view.</p>
              ) : (
                <>
                  {/* Incident list */}
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
            </div>
          </div>
        )}

        {view === 'fleet' && (
          <div className="v2-view on">
            {fleetEnabled && fleetAggregator ? (
              <div style={{gridColumn:'span 12'}}>
                <FleetView
                  aggregator={fleetAggregator}
                  onSelectRobot={(id) => {
                    // Phase 7 spec: robot card click routes to Live view with that robot's evidence
                    setScenario('conflict'); // RB-04 uses conflict scenario data
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
        <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}><span aria-hidden="true">◉</span><span className="tip">Live</span></button>
        <button className={view === 'fusion' ? 'on' : ''} onClick={() => setView('fusion')}><span aria-hidden="true">⇄</span><span className="tip">Sensor fusion</span></button>
        <button className={view === 'contract' ? 'on' : ''} onClick={() => setView('contract')}><span aria-hidden="true">☰</span><span className="tip">Contract</span></button>
        <button className={view === 'replay' ? 'on' : ''} onClick={() => setView('replay')}><span aria-hidden="true">↺</span><span className="tip">Replay</span></button>
        <button className={view === 'sources' ? 'on' : ''} onClick={() => setView('sources')}><span aria-hidden="true">⌨</span><span className="tip">Sources</span></button>
        <button disabled={!fleetEnabled} className={view === 'fleet' ? 'on' : ''} onClick={() => fleetEnabled && setView('fleet')} title={fleetEnabled ? undefined : 'Fleet (disabled — add ?fleet=1 to enable)'}><span aria-hidden="true">▦</span><span className="tip">{fleetEnabled ? 'Fleet' : 'Fleet (disabled)'}</span></button>
      </nav>
    </div>
  );
}
