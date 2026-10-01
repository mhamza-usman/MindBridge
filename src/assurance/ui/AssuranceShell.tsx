"use client";
import React, { useEffect, useState, useMemo } from "react";
import "./AssuranceStyles.css";
import { SyntheticSource } from "../sources/synthetic";
import { getDefaultContract } from "../contract/loader";
import { evaluateContract } from "../contract/evaluator";
import { AssuranceStateMachine } from "../domain/stateMachine";
import { EvidenceSnapshot, AssuranceState, NeSyMode } from "../domain/types";
import { IncidentRecorder } from "../incidents/recorder";
import { IncidentStore } from "../incidents/store";
import { IncidentBundle } from "../incidents/types";

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
  
  // Replay view state
  const [incidents, setIncidents] = useState<IncidentBundle[]>([]);

  const source = useMemo(() => new SyntheticSource(), []);
  const contract = useMemo(() => getDefaultContract(), []);
  const sm = useMemo(() => new AssuranceStateMachine(), []);
  const recorder = useMemo(() => new IncidentRecorder(), []);

  useEffect(() => {
    recorder.start(contract.mission, contract.version, 'synthetic');
    return () => recorder.stop();
  }, [recorder, contract]);

  useEffect(() => {
    source.setScenario(scenario);
    source.onSnapshot((s) => setEvidence(s));
    source.start();
    return () => source.stop();
  }, [source, scenario]);

  const nesyMode: NeSyMode = scenario === 'stale' || scenario === 'conflict' ? 'Advisory' : scenario === 'unknown' ? 'Emergency' : 'Autonomous';
  let res = null;
  let checks = {};
  if (evidence) {
    checks = evaluateContract(contract, evidence);
    const conflict = scenario === 'conflict';
    res = sm.tick(evidence.t, checks, conflict, nesyMode);
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

  return (
    <div className="v2-root">
      <div className="v2-wall" />
      <header className="v2-menubar">
        <b>MindBridge</b>
        <span>Robot RB-07, warehouse aisle B pickup</span>
        <span style={{flex:1}} />
        <span style={{fontSize:'12px', color:'var(--ink2)'}}>Scenario</span>
        <select value={scenario} onChange={e => setScenario(e.target.value as any)} style={{padding:'3px 8px', borderRadius:'7px', border:'1px solid var(--line)', background:'rgba(255,255,255,.8)', color:'var(--ink)'}}>
          <option value="nominal">Nominal run</option>
          <option value="stale">Stale camera</option>
          <option value="conflict">Camera and LiDAR conflict</option>
          <option value="unknown">Evidence missing</option>
        </select>
        <span style={{fontSize:'11px', padding:'2px 8px', borderRadius:'99px', border:'1px solid var(--line)', background:'#fff', color:'var(--ink2)'}}>Synthetic demo data</span>
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
              <div style={{background:'rgba(255,255,255,.5)', border:'1px solid var(--line)', borderRadius:'12px', padding:'10px', height:'200px', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ink2)'}}>
                (Floor map SVG placeholder - matches layout)
              </div>
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
              <div className="v2-row">
                 <span className="n" style={{flex:'none', width:'130px'}}>Perception</span>
                 <div className="v2-bar"><span style={{width:`${scenario==='nominal'?92:scenario==='stale'?68:scenario==='conflict'?71:0}%`}}></span></div>
                 <span className="v" style={{width:'40px', textAlign:'right'}}>{scenario==='nominal'?92:scenario==='stale'?68:scenario==='conflict'?71:0}%</span>
              </div>
              <div className="v2-row">
                 <span className="n" style={{flex:'none', width:'130px'}}>Plan certainty</span>
                 <div className="v2-bar"><span style={{width:`${scenario==='nominal'?90:scenario==='stale'?61:scenario==='conflict'?66:0}%`}}></span></div>
                 <span className="v" style={{width:'40px', textAlign:'right'}}>{scenario==='nominal'?90:scenario==='stale'?61:scenario==='conflict'?66:0}%</span>
              </div>
              <h3 style={{fontSize:'12px', fontWeight:600, color:'var(--ink2)', margin:'10px 0 4px'}}>Current NeSyConf mode</h3>
              <div className="v2-modes">
                {ALL_MODES.map(m => <span key={m} className={m === nesyMode ? 'on' : ''}>{m}</span>)}
              </div>
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
              <p style={{color:'var(--ink2)', fontSize:'12px'}}>Phase 5 fusion detector component placeholder.</p>
            </div>
          </div>
        )}

        {view === 'sources' && (
          <div className="v2-view on">
            <div className="v2-panel v2-c12">
              <h2>Evidence sources</h2>
              <div className="v2-row"><span className="n">Synthetic scenarios</span><span className="v2-st">Connected</span></div>
              <div className="v2-row"><span className="n">Recorded ROS2 bag (MCAP replay)</span><span className="v2-st unk">Not connected</span></div>
              <div className="v2-row"><span className="n">Live ROS2 monitor</span><span className="v2-st unk">Not connected</span></div>
              <div className="v2-row"><span className="n">CASSANDRA acoustic plugin</span><span className="v2-st unk">Later</span></div>
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
                incidents.map(inc => (
                  <div key={inc.incident_id} style={{borderBottom:'1px solid var(--line)', padding:'10px 0'}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <b>{inc.incident_id}</b>
                      <button className="v2-btn" onClick={() => exportJSON(inc)}>Export JSON</button>
                    </div>
                    <p style={{fontSize:'12px', color:'var(--ink2)', margin:'4px 0'}}>Mission: {inc.mission} | Started: {new Date(inc.started_at).toLocaleTimeString()}</p>
                    <div style={{background:'rgba(255,255,255,.5)', borderRadius:'8px', padding:'10px', marginTop:'8px', maxHeight:'200px', overflowY:'auto'}}>
                      {inc.events.map((e, idx) => (
                        <div key={idx} style={{fontFamily:'var(--mono)', fontSize:'11px', marginBottom:'4px'}}>
                          <span style={{color:'var(--accent)'}}>{new Date(e.t).toLocaleTimeString()}</span>{' '}
                          <b>{e.type}</b>: {JSON.stringify(e.data)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      <nav className="v2-dock" aria-label="Views">
        <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}><span aria-hidden="true">◉</span><span className="tip">Live</span></button>
        <button className={view === 'fusion' ? 'on' : ''} onClick={() => setView('fusion')}><span aria-hidden="true">⇄</span><span className="tip">Sensor fusion</span></button>
        <button className={view === 'contract' ? 'on' : ''} onClick={() => setView('contract')}><span aria-hidden="true">☰</span><span className="tip">Contract</span></button>
        <button className={view === 'replay' ? 'on' : ''} onClick={() => setView('replay')}><span aria-hidden="true">↺</span><span className="tip">Replay</span></button>
        <button className={view === 'sources' ? 'on' : ''} onClick={() => setView('sources')}><span aria-hidden="true">⌨</span><span className="tip">Sources</span></button>
        <button disabled><span aria-hidden="true">▦</span><span className="tip">Fleet (later)</span></button>
      </nav>
    </div>
  );
}
