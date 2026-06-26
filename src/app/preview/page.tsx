"use client";

import { useState } from "react";
import {
  Layers, GitBranch, Radio, Map, FileText, Target, Server, PenTool,
  FlaskConical, TrendingUp, Sparkles, ShieldCheck, Check, ArrowUp,
  Scale, ChevronRight, MessageSquare, Search, Dot, LayoutGrid,
  ArrowUpRight, Filter, Circle
} from "lucide-react";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;450;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root{
  --paper:#F6F7F9; --surface:#FFFFFF; --ink:#15171C; --muted:#646B75; --faint:#9aa1ab;
  --line:#E7E9EE; --line-2:#EFF1F4;
  --thread:#C7CCD5; --thread-dot:#3A3F49;
  --accent:oklch(69.6% 0.17 162.48); --accent-soft:oklch(88% 0.07 162.48); --accent-bg:oklch(97% 0.024 162.48); --accent-deep:oklch(60% 0.15 162.48);
  --ok:#2F855A; --ok-soft:#E3EFE9;
  --disp:'Space Grotesk',-apple-system,system-ui,sans-serif;
  --body:'Inter',-apple-system,system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;
}
*{box-sizing:border-box}
.an-root{font-family:var(--body);background:var(--paper);color:var(--ink);height:780px;
  display:flex;border-radius:14px;overflow:hidden;border:1px solid var(--line);
  font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased;letter-spacing:-0.005em}

/* sidebar — light */
.an-side{width:206px;background:var(--surface);border-right:1px solid var(--line);flex:0 0 auto;
  display:flex;flex-direction:column;padding:16px 12px;gap:2px}
.an-brand{font-family:var(--disp);font-weight:700;font-size:18px;color:var(--ink);
  letter-spacing:-0.02em;padding:6px 8px 16px;display:flex;align-items:center;gap:9px}
.an-brand .tt{width:7px;height:7px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 0 3px var(--accent-soft)}
.an-navlbl{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--faint);padding:12px 8px 6px}
.an-nav{display:flex;align-items:center;gap:10px;padding:8px 8px;border-radius:8px;
  color:var(--muted);cursor:pointer;font-size:12.5px}
.an-nav:hover{background:var(--paper);color:var(--ink)}
.an-nav.on{background:var(--accent-bg);color:var(--accent);font-weight:500}
.an-side-foot{margin-top:auto;border-top:1px solid var(--line);padding-top:12px;
  display:flex;align-items:center;gap:9px;color:var(--muted);font-size:11.5px}
.an-av{width:25px;height:25px;border-radius:50%;background:var(--ink);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:10.5px;font-weight:600;font-family:var(--disp)}

/* main */
.an-main{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--paper)}
.an-top{padding:18px 24px 0;border-bottom:1px solid var(--line);background:var(--surface)}
.an-crumb{font-family:var(--mono);font-size:10.5px;color:var(--faint);display:flex;align-items:center;gap:6px;margin-bottom:9px}
.an-h1{font-family:var(--disp);font-weight:600;font-size:22px;letter-spacing:-0.025em;display:flex;align-items:center;gap:12px}
.an-sub{color:var(--muted);font-size:12.5px;margin-top:5px}

/* progress stepper — deliberately NOT a thread */
.an-step{margin-top:16px;padding-bottom:14px}
.an-steprow{display:flex;gap:0;align-items:baseline;flex-wrap:wrap;margin-bottom:9px}
.an-sp{font-family:var(--mono);font-size:10.5px;color:var(--faint);padding-right:16px;white-space:nowrap}
.an-sp.done{color:var(--muted)}
.an-sp.cur{color:var(--ink);font-weight:600}
.an-sp.next{color:var(--accent)}
.an-track{height:3px;background:var(--line);border-radius:3px;position:relative;overflow:visible}
.an-fill{position:absolute;left:0;top:0;height:100%;background:var(--ink);border-radius:3px;transition:width .35s ease}
.an-gatemark{position:absolute;top:50%;width:11px;height:11px;border-radius:50%;background:var(--surface);
  border:2px solid var(--accent);transform:translate(-50%,-50%);transition:left .35s ease}

/* scroll body */
.an-scroll{flex:1;overflow:auto;padding:20px 24px 40px}
.an-eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--faint);margin:0 0 12px;display:flex;align-items:center;gap:8px}

/* thread (the only thread) */
.an-row{display:flex;gap:14px;align-items:stretch}
.an-spine{flex:0 0 16px;position:relative}
.an-line{position:absolute;left:50%;top:0;bottom:0;width:1.5px;transform:translateX(-50%);background:var(--thread)}
.an-row:first-child .an-line{top:20px}
.an-row:last-child .an-line{bottom:auto;height:20px}
.an-dot{position:absolute;left:50%;top:18px;width:9px;height:9px;border-radius:50%;
  transform:translate(-50%,-50%);background:var(--surface);border:2px solid var(--thread-dot);z-index:1}
.an-dot.accent{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}

/* action card (EDP, first) */
.an-card{flex:1;background:var(--surface);border:1px solid var(--line);border-radius:12px;
  padding:16px 18px;margin-bottom:12px;min-width:0}
.an-card.action{border-color:var(--accent-soft);box-shadow:0 8px 26px -18px rgba(75,87,224,.55)}
.an-nodehd{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.an-kind{font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--muted);background:var(--line-2);padding:3px 7px;border-radius:5px;font-weight:500}
.an-kind.accent{color:var(--accent);background:var(--accent-bg)}
.an-nodettl{font-family:var(--disp);font-weight:600;font-size:15px;letter-spacing:-0.01em}
.an-nodebody{color:var(--muted);font-size:12.5px}
.an-mark{display:inline-flex;align-items:center;gap:7px;background:var(--paper);border:1px solid var(--line);
  border-radius:8px;padding:7px 10px;margin-top:11px;font-size:12px;color:#3a3e46}
.an-mark .mk{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--accent);background:var(--surface);border:1px solid var(--accent-soft);padding:1px 5px;border-radius:4px}
.an-gatebox{margin-top:13px;border-top:1px solid var(--line);padding-top:13px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.an-gatetxt{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;max-width:60%}
.an-gatetxt .ag{color:var(--accent);font-weight:500}
.an-btns{display:flex;gap:8px}
.an-btn{font-family:var(--body);font-size:12.5px;font-weight:500;padding:8px 14px;border-radius:8px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.an-btn:hover{border-color:#d0d4dc;background:var(--paper)}
.an-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.an-btn.primary:hover{background:var(--accent-deep)}
.an-approved{display:inline-flex;align-items:center;gap:7px;color:var(--ok);font-size:12.5px;font-weight:500}

/* compact artifact-link rows */
.an-link{flex:1;display:flex;align-items:center;gap:13px;background:var(--surface);border:1px solid var(--line);
  border-radius:10px;padding:11px 14px;margin-bottom:10px;cursor:pointer;min-width:0}
.an-link:hover{border-color:#d3d7df;background:#fcfcfd}
.an-link .ic{flex:0 0 auto;width:30px;height:30px;border-radius:8px;background:var(--paper);
  display:flex;align-items:center;justify-content:center;color:var(--muted)}
.an-link .mid{flex:1;min-width:0}
.an-link .lk{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
.an-link .lt{font-family:var(--disp);font-weight:600;font-size:13.5px;letter-spacing:-0.01em;margin:1px 0}
.an-link .ls{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.an-link .rt{flex:0 0 auto;display:flex;align-items:center;gap:12px}
.an-why{font-family:var(--mono);font-size:10.5px;color:var(--muted);display:inline-flex;align-items:center;gap:4px}
.an-why:hover{color:var(--accent)}
.an-open{color:var(--faint)}
.an-status{font-family:var(--mono);font-size:10px;display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:5px}
.an-status.ok{color:var(--ok);background:var(--ok-soft)}
.an-status.wait{color:var(--accent);background:var(--accent-bg)}
.an-status.draft{color:var(--muted);background:var(--line-2)}
.an-asg{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--accent)}

/* right panel */
.an-right{width:336px;flex:0 0 auto;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column}
.an-tabs{display:flex;border-bottom:1px solid var(--line);padding:0 8px}
.an-tab{flex:1;text-align:center;padding:14px 8px;font-size:12.5px;color:var(--muted);cursor:pointer;
  border-bottom:2px solid transparent;display:flex;align-items:center;justify-content:center;gap:7px}
.an-tab.on{color:var(--ink);border-bottom-color:var(--ink);font-weight:500}
.an-tab .bdg{font-family:var(--mono);font-size:9.5px;background:var(--accent);color:#fff;border-radius:20px;
  padding:0 5px;min-width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center}
.an-rbody{flex:1;overflow:auto;padding:16px}
.an-msg{margin-bottom:15px}
.an-mhd{display:flex;align-items:center;gap:7px;margin-bottom:4px}
.an-who{font-size:12px;font-weight:600;font-family:var(--disp)}
.an-when{font-family:var(--mono);font-size:10px;color:var(--faint)}
.an-avs{width:21px;height:21px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:600;font-family:var(--disp);color:#fff}
.an-aned{background:var(--accent-bg);border:1px solid var(--accent-soft);border-radius:10px;padding:11px 12px}
.an-aned .an-who{color:var(--accent)}
.an-sys{font-family:var(--mono);font-size:10.5px;color:var(--muted);background:var(--paper);border:1px solid var(--line);
  border-radius:7px;padding:8px 10px;display:flex;align-items:center;gap:8px;margin-bottom:12px}
.an-sys .gl{color:var(--accent)}
.an-cap{margin-top:9px}
.an-q{display:flex;align-items:center;gap:8px;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:9px 11px;margin-bottom:14px}
.an-q input{border:none;background:none;outline:none;font-family:var(--body);font-size:12.5px;color:var(--ink);width:100%}
.an-qfilter{font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:12px}
.an-qfilter b{color:var(--accent)}
.an-drec{border:1px solid var(--line);border-radius:10px;padding:13px;margin-bottom:11px}
.an-drec .dt{font-size:13px;font-weight:500;margin-bottom:8px;color:var(--ink)}
.an-tagrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px}
.an-tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent-soft)}
.an-tag.sub{background:var(--paper);color:var(--muted);border-color:var(--line)}
.an-dmeta{font-family:var(--mono);font-size:10.5px;color:var(--faint);display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line-2);padding-top:9px}
.an-empty{text-align:center;color:var(--faint);font-size:12.5px;padding:40px 16px}
.an-empty .ic{margin-bottom:10px;opacity:.5}

/* roadmap */
.an-rmtop{padding:18px 24px 16px;border-bottom:1px solid var(--line);background:var(--surface)}
.an-rmhd{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.an-seg{display:inline-flex;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:2px}
.an-segb{font-size:12px;color:var(--muted);padding:6px 12px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.an-segb.on{background:var(--surface);color:var(--ink);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.an-chips{display:flex;gap:7px;margin-top:14px;flex-wrap:wrap;align-items:center}
.an-chip{font-size:11.5px;color:var(--muted);background:var(--paper);border:1px solid var(--line);padding:5px 11px;border-radius:20px;cursor:pointer}
.an-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.an-board{flex:1;overflow:auto;padding:18px 24px;display:flex;gap:14px}
.an-col{flex:0 0 230px;display:flex;flex-direction:column}
.an-colhd{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;padding:0 2px}
.an-coltt{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:7px}
.an-coltt .cd{width:7px;height:7px;border-radius:50%}
.an-colct{font-family:var(--mono);font-size:11px;color:var(--faint)}
.an-cc{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:13px;margin-bottom:10px;cursor:pointer}
.an-cc:hover{border-color:#d3d7df;box-shadow:0 6px 18px -14px rgba(0,0,0,.3)}
.an-cc.live{border-color:var(--accent-soft);box-shadow:0 0 0 1px var(--accent-soft)}
.an-cctt{font-family:var(--disp);font-weight:600;font-size:13.5px;letter-spacing:-0.01em;margin-bottom:9px}
.an-ccmeta{display:flex;align-items:center;justify-content:space-between;gap:8px}
.an-team{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--paper);border:1px solid var(--line);padding:2px 6px;border-radius:4px}
.an-dep{font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:9px;display:flex;align-items:center;gap:5px;border-top:1px solid var(--line-2);padding-top:8px}
.an-mini{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;font-family:var(--disp);color:#fff;background:var(--muted)}

.an-toast{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;
  font-size:12.5px;padding:10px 16px;border-radius:9px;display:flex;align-items:center;gap:9px;
  box-shadow:0 12px 30px -10px rgba(0,0,0,.4);z-index:9}
.an-toast .gl{color:oklch(85% 0.13 162.48)}
`;

const PHASES = ["Discover","Define","Design","Validate","Build","Verify","Live","Measure"];

const LINKS = [
  {kind:"PRD", icon:<FileText size={15}/>, title:"New users don't reach first value", sum:"Activation drops before the aha moment", why:"Signals", status:["ok","approved"]},
  {kind:"Success metrics", icon:<Target size={15}/>, title:"Activation 38% → 55%", sum:"+ time-to-first-value under 5 min", why:"PRD", status:["ok","set"]},
  {kind:"Design / prototype", icon:<PenTool size={15}/>, title:"Checklist + first-value moment", sum:"On your design system · validated with 5 users", why:"EDP", status:["ok","validated"]},
  {kind:"Tests & evals", icon:<FlaskConical size={15}/>, title:"Reaches-first-value eval", sum:"Proves it behaves, and keeps behaving", why:"Success metrics", status:["draft","queued"]},
  {kind:"Impact", icon:<TrendingUp size={15}/>, title:"Measured in production", sum:"Checked back against the target, then fed forward", why:"Success metrics", status:["draft","pending"]},
];

type Card = { t: string; team: string; who: string; live?: boolean; dep?: string };
const COLS: { name: string; color: string; cards: Card[] }[] = [
  {name:"Discover", color:"#9aa1ab", cards:[
    {t:"Bulk export", team:"Platform", who:"Ro"},
    {t:"SAML / SCIM", team:"Platform", who:"Vi"}]},
  {name:"Define", color:"#7e8590", cards:[
    {t:"In-app referrals", team:"Growth", who:"Le"}]},
  {name:"Design", color:"oklch(69.6% 0.17 162.48)", cards:[
    {t:"Guided onboarding", team:"Activation", who:"Ma", live:true, dep:"feeds Activation metrics"}]},
  {name:"Validate", color:"#6a7079", cards:[
    {t:"Usage-based billing", team:"Billing", who:"Jo", dep:"depends on Audit log"}]},
  {name:"Build", color:"#565d66", cards:[
    {t:"Comment mentions", team:"Core", who:"Sa"},
    {t:"Audit log v2", team:"Platform", who:"Ne"}]},
  {name:"Live", color:"#3a3f49", cards:[
    {t:"Dark mode", team:"Core", who:"Ki"},
    {t:"API keys", team:"Platform", who:"Pa"}]},
];

export default function AnedaiApp() {
  const [view, setView] = useState("workspace");
  const [approved, setApproved] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [tab, setTab] = useState("chat");
  const [rmView, setRmView] = useState("Board");
  const [toast, setToast] = useState<string | null>(null);
  const [log, setLog] = useState<{ who: string; txt: string }[]>([]);

  const curIdx = approved ? 3 : 2;
  const fillPct = ((curIdx + 0.5) / PHASES.length) * 100;

  function flash(t: string){ setToast(t); setTimeout(()=>setToast(null), 2600); }
  function approve(){ if(approved) return; setApproved(true);
    setLog(l=>[{who:"You", txt:"Approved the EDP. Committed — advanced to Validate."},...l]);
    flash("EDP approved — committed to the graph"); }
  function capture(){ if(captured) return; setCaptured(true);
    setLog(l=>[{who:"@aned", txt:"Captured a decision in the PRD: persistent checklist over a wizard."},...l]);
    flash("Decision captured"); setTab("decisions"); }

  return (
    <div>
      <style>{CSS}</style>
      <div className="an-root" style={{position:"relative"}}>
        <aside className="an-side">
          <div className="an-brand"><span className="tt"/>anedai</div>
          <div className="an-navlbl">Workspace</div>
          <div className="an-nav"><Layers size={16}/>State of everything</div>
          <div className={"an-nav"+(view==="workspace"?" on":"")} onClick={()=>setView("workspace")}><GitBranch size={16}/>Capabilities</div>
          <div className="an-nav"><Radio size={16}/>Signals</div>
          <div className={"an-nav"+(view==="roadmap"?" on":"")} onClick={()=>setView("roadmap")}><Map size={16}/>Roadmap</div>
          <div className="an-side-foot"><span className="an-av">DK</span>
            <div><div style={{color:"var(--ink)",fontWeight:500}}>kinetic</div>
            <div style={{fontSize:10.5}}>Product workspace</div></div></div>
        </aside>

        {view==="workspace" ? (
          <>
            <main className="an-main">
              <div className="an-top">
                <div className="an-crumb">Capabilities <ChevronRight size={11}/> Activation <ChevronRight size={11}/> CAP-104</div>
                <div className="an-h1">Guided onboarding</div>
                <div className="an-sub">Help new users reach first value. Threaded back to the signals that asked for it.</div>
                <div className="an-step">
                  <div className="an-steprow">
                    {PHASES.map((p,i)=>(
                      <span key={p} className={"an-sp "+(i<curIdx?"done":i===curIdx?"cur":i===curIdx+1?"next":"")}>{p}</span>
                    ))}
                  </div>
                  <div className="an-track">
                    <div className="an-fill" style={{width:fillPct+"%"}}/>
                    {!approved && <div className="an-gatemark" style={{left:fillPct+"%"}}/>}
                  </div>
                </div>
              </div>

              <div className="an-scroll">
                <div className="an-eyebrow"><Circle size={8} fill="var(--accent)" stroke="none"/> next action · awaiting you</div>

                {/* EDP — action card, first */}
                <div className="an-row">
                  <div className="an-spine"><div className="an-line"/><div className="an-dot accent"/></div>
                  <div className={"an-card"+(approved?"":" action")}>
                    <div className="an-nodehd">
                      <span className="an-kind accent">EDP</span>
                      <span className="an-nodettl">Engineering Development Plan</span>
                    </div>
                    <div className="an-nodebody">Onboarding state machine, persisted checklist, instrumentation, A/B harness — drawn from your living architecture.</div>
                    <div className="an-gatebox">
                      {approved ? (
                        <span className="an-approved"><Check size={15}/> Approved by you · committed to the graph</span>
                      ) : (<>
                        <span className="an-gatetxt"><Sparkles size={14} style={{color:"var(--accent)"}}/>
                          <span><span className="ag">Architect</span> drafted this. Propose-only — it waits for you.</span></span>
                        <span className="an-btns">
                          <button className="an-btn">Request changes</button>
                          <button className="an-btn primary" onClick={approve}><Check size={14}/>Approve &amp; commit</button>
                        </span></>)}
                    </div>
                  </div>
                </div>

                <div className="an-eyebrow" style={{marginTop:20}}><span style={{color:"var(--thread-dot)"}}>—</span> the thread · {LINKS.length} linked artifacts, each one hop from its why</div>

                {LINKS.map((n,i)=>(
                  <div className="an-row" key={n.kind}>
                    <div className="an-spine"><div className="an-line"/><div className="an-dot"/></div>
                    <div className="an-link">
                      <span className="ic">{n.icon}</span>
                      <span className="mid">
                        <div className="lk">{n.kind}</div>
                        <div className="lt">{n.title}</div>
                        <div className="ls">{n.sum}</div>
                        {n.kind==="PRD" && captured && (
                          <div className="an-mark"><Scale size={13} style={{color:"var(--accent)"}}/>
                            <span className="mk">product/ux</span>Persistent checklist over a wizard</div>
                        )}
                      </span>
                      <span className="rt">
                        <span className={"an-status "+n.status[0]}>{n.status[1]}</span>
                        <span className="an-why"><ArrowUp size={11}/>{n.why}</span>
                        <ArrowUpRight size={15} className="an-open"/>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </main>

            <aside className="an-right">
              <div className="an-tabs">
                <div className={"an-tab "+(tab==="chat"?"on":"")} onClick={()=>setTab("chat")}><MessageSquare size={14}/> Chat &amp; activity</div>
                <div className={"an-tab "+(tab==="decisions"?"on":"")} onClick={()=>setTab("decisions")}><Scale size={14}/> Decisions {captured && <span className="bdg">1</span>}</div>
              </div>
              <div className="an-rbody">
                {tab==="chat" ? (<>
                  {log.map((l,i)=>(<div className="an-sys" key={i}><Dot size={14} className="gl"/>
                    <span><b style={{color:"var(--ink)",fontWeight:600}}>{l.who}</b> {l.txt}</span></div>))}
                  <div className="an-msg"><div className="an-mhd"><span className="an-avs" style={{background:"#3f7a52"}}>JP</span>
                    <span className="an-who">Jordan</span><span className="an-when">11:02</span></div>
                    <div className="an-mtxt">For first-run — a 3-step wizard, or an always-visible checklist?</div></div>
                  <div className="an-msg"><div className="an-mhd"><span className="an-avs" style={{background:"#5b6470"}}>MA</span>
                    <span className="an-who">Mara</span><span className="an-when">11:03</span></div>
                    <div className="an-mtxt">Checklist. People want to explore, not be railroaded — and it doubles as re-engagement.</div></div>
                  <div className="an-aned"><div className="an-mhd"><span className="an-avs" style={{background:"var(--accent)"}}>ae</span>
                    <span className="an-who">@aned</span><span className="an-when">11:03</span></div>
                    <div className="an-mtxt">Sounds like a decision. Want me to record it on the graph so it's not lost?</div>
                    {!captured ? (<div className="an-cap"><button className="an-btn primary" onClick={capture}><Scale size={13}/>Capture decision</button></div>)
                      : (<div className="an-cap" style={{color:"var(--ok)",fontSize:12,display:"flex",alignItems:"center",gap:6}}><Check size={14}/> Captured in the PRD — and now queryable.</div>)}
                  </div>
                </>) : (<>
                  <div className="an-q"><Search size={14} style={{color:"var(--faint)"}}/><input defaultValue="every onboarding decision" readOnly/></div>
                  <div className="an-qfilter">filtered · kind <b>any</b> · subject <b>onboarding</b></div>
                  {captured ? (
                    <div className="an-drec"><div className="dt">Persistent checklist over a 3-step wizard</div>
                      <div className="an-tagrow"><span className="an-tag">product/ux</span><span className="an-tag sub">onboarding</span><span className="an-tag sub">activation</span></div>
                      <div className="an-dmeta"><span>in: PRD</span><span>by: Mara</span><span>status: active</span></div></div>
                  ) : (<div className="an-empty"><Scale size={26} className="ic"/><div>No decisions recorded yet.</div>
                    <div style={{fontSize:11.5,marginTop:5}}>Make a call in chat and let @aned capture it — it'll show up here, queryable across every artifact.</div></div>)}
                </>)}
              </div>
            </aside>
          </>
        ) : (
          <main className="an-main">
            <div className="an-rmtop">
              <div className="an-rmhd">
                <div><div className="an-h1" style={{fontSize:22}}>Roadmap</div>
                  <div className="an-sub">One graph, three views. Every card drills into its capability.</div></div>
                <div className="an-seg">
                  {[["Roadmap",<Map size={14}/>],["Board",<LayoutGrid size={14}/>],["Dependencies",<GitBranch size={14}/>]].map(([n,ic])=>(
                    <span key={n as string} className={"an-segb"+(rmView===n?" on":"")} onClick={()=>setRmView(n as string)}>{ic}{n}</span>
                  ))}
                </div>
              </div>
              <div className="an-chips"><Filter size={13} style={{color:"var(--faint)"}}/>
                <span className="an-chip on">All teams</span><span className="an-chip">Activation</span>
                <span className="an-chip">Platform</span><span className="an-chip">Billing</span><span className="an-chip">Growth</span></div>
            </div>
            <div className="an-board">
              {COLS.map(col=>(
                <div className="an-col" key={col.name}>
                  <div className="an-colhd">
                    <span className="an-coltt"><span className="cd" style={{background:col.color}}/>{col.name}</span>
                    <span className="an-colct">{col.cards.length}</span>
                  </div>
                  {col.cards.map(c=>(
                    <div className={"an-cc"+(c.live?" live":"")} key={c.t} onClick={()=>c.live && setView("workspace")}>
                      <div className="an-cctt">{c.t}</div>
                      <div className="an-ccmeta"><span className="an-team">{c.team}</span><span className="an-mini">{c.who}</span></div>
                      {c.dep && <div className="an-dep"><GitBranch size={11}/>{c.dep}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </main>
        )}

        {toast && <div className="an-toast"><Check size={15} className="gl"/>{toast}</div>}
      </div>
    </div>
  );
}
