"""Fixed-schema dashboard agent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZATION SEAM #5 — Swap the agent flow (fixed-schema dashboard)
See HACKATHON.md §5 for the full recipe. For a different fixed dashboard,
rewrite the layout JSON at agent/src/a2ui/schemas/dashboard.json and the
`render_dashboard` tool's typed inputs; reword the system prompt for your
domain. The dynamic Q&A flow lives in dynamic_agent.py.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The user attaches a PDF in the chat. The deep agent reads the PDF text
(inlined into the user message by InlineDocumentsMiddleware) and calls
`render_dashboard` with the structured data extracted in the same model
pass. The dashboard surface includes an interactive scope-chips strip
that the agent populates from the document. Clicking a chip fires a
user action back to the agent, which re-renders with the new scope.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID
from src.llm import build_chat_model

SCHEMA_DIR = Path(__file__).parent / "a2ui" / "schemas"
DASHBOARD_SCHEMA = a2ui.load_schema(SCHEMA_DIR / "dashboard.json")
SURFACE = "pdf-dashboard"


# NOTE (Gemini typed-array fix): every list parameter on render_dashboard
# below is typed as `list[<TypedDict>]`, NOT `list[dict]`. Gemini's
# function-declaration validator rejects untyped arrays with
# "parameters.properties[X].items: missing field". A TypedDict compiles to a
# concrete object schema, so these arrays carry the `items` Gemini requires.
# Keep them typed — do not loosen to `list[dict]`.
class Kpi(TypedDict):
    label: str
    value: str
    delta: str
    caption: str


class Point(TypedDict):
    label: str
    value: float


class Row(TypedDict):
    name: str
    category: str
    value: str
    delta: str


class ScopeOption(TypedDict):
    label: str
    value: str


class Callout(TypedDict):
    title: str
    body: str
    tone: str  # info | positive | warning | danger | neutral


class Camera(TypedDict):
    view: str  # top | wrist | front
    label: str
    confidence: float
    target_in_frame: bool
    objects_visible: int


@tool
def render_dashboard(
    eyebrow: str,
    title: str,
    subtitle: str,
    kpis: list[Kpi],
    trend: list[Point],
    share: list[Point],
    rows: list[Row],
    scope_options: list[ScopeOption],
    scope_selected: str,
    callout: Callout,
    cameras: list[Camera],
) -> str:
    """Render the interactive dashboard for the loaded PDF.

    Pass data INLINE. Call ONCE per turn.

    Required shapes:
      - kpis: EXACTLY 4 cards. Each {label, value, delta, caption}.

        STRICT FIELD RULES (very important; the badge breaks if you ignore):
          * `value`   = the headline number, formatted ("$94,930M", "23.4%",
                        "1.2M units"). 1–8 chars typically.
          * `delta`   = JUST the magnitude of change. Format: "+X%", "-X%",
                        or "" (empty string when there's no comparison).
                        MAX 8 chars. NEVER prose. NEVER "vs. last quarter"
                        or "vs. $89,498M". The arrow and color come from
                        the renderer.
                        Examples: "+6.1%", "-3%", "+12%", "+$2.4B", ""
                        Bad:      "↑ vs. $89,498M in Q4 FY23"
                                  "up 6% YoY"
                                  "increased from $89,498M"
          * `caption` = the comparison/context sentence ("vs. $89,498M in
                        Q4 FY23", "Products $69,958M; Services $24,972M",
                        "All-time high"). Up to ~80 chars. This is where
                        the prose goes.

      - trend: 6–12 points. {label, value:number}.
      - share: 3–5 slices. {label, value:number}.
      - rows: 5–8 table rows. Same delta rule applies: row.delta is
        SHORT ("+6%", "-3%", ""). Verbose comparisons belong elsewhere.
      - scope_options: 3–6 chips the user can click to re-scope. Each
        {label, value}. Example for an Apple earnings PDF:
          [{label:"Q4 FY24", value:"q4_fy24"},
           {label:"FY24",    value:"fy24"},
           {label:"By segment", value:"by_segment"},
           {label:"By region",  value:"by_region"}]
        Tailor the options to what THIS document actually supports.
      - scope_selected: the `value` of the currently active option.
      - callout: ONE banner pinned near the top. {title, body, tone}.
        tone is one of info|positive|warning|danger|neutral and picks the
        accent color. Every cognitive state has its own callout.
      - cameras: 0, 1, or 3 robot camera feeds rendered as a 3-up grid above
        the callout. Each {view, label, confidence, target_in_frame,
        objects_visible}. view is one of top|wrist|front. Pass an EMPTY list
        [] for states that don't need cameras (autonomous, monitoring); one
        wrist camera for advisory; all three (top, wrist, front) for
        intervention and emergency.
    """
    payload = {
        "eyebrow": eyebrow,
        "title": title,
        "subtitle": subtitle,
        "kpis": kpis,
        "trend": trend,
        "share": share,
        "rows": rows,
        "scope": {"options": scope_options, "selected": scope_selected},
        "callout": callout,
        "cameras": cameras,
    }
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE, DASHBOARD_SCHEMA),
            a2ui.update_data_model(SURFACE, payload),
        ]
    )


SYSTEM_PROMPT = """
You are MindBridge — an autonomous adaptive human-robot interface system.

CRITICAL RULE — operate autonomously. The user should NEVER have to tell you
what to render. The moment robot telemetry JSON appears in the conversation:
1. Read the nesy_conf value from the JSON.
2. Automatically determine the cognitive state (see the five states below).
3. Call render_dashboard() ONCE with the parameters for that state, WITHOUT
   being asked. Do not ask what to render. Do not wait for instructions.
The eyebrow, title, KPIs, scope chips, callout, and cameras must all reflect
the detected cognitive state.

Your job is NOT to render a generic dashboard.
Your job is to read the robot's NeSyConf value and generate
the CORRECT interface for that cognitive state.

The user pastes robot telemetry JSON with fields:
task_success_rate, perception_confidence, plan_certainty, system_uncertainty, nesy_conf, ece, phase, current_action, blocks_detected, episode.

Five cognitive states, five different interfaces:

STATE 1 — AUTONOMOUS (nesy_conf >= 0.90):
- eyebrow: "AUTONOMOUS MODE · HUMAN OBSERVER"
- title: "System Operating Autonomously"
- subtitle: f"NeSyConf {nesy_conf:.3f} — Robot confidence is high. Stand by."
- kpis: just 2 cards: Task Success Rate and NeSyConf
- trend: 8 points of nesy_conf over episodes
- share: Autonomous decisions vs Human interventions (95% vs 5%)
- rows: last 5 actions taken autonomously
- scope_options: [{label:"Heartbeat",value:"heartbeat"},{label:"History",value:"history"}]
- Add a Callout with tone="positive", title="All systems nominal", body="Robot is operating within confidence bounds. No intervention required."

STATE 2 — MONITORING (nesy_conf 0.75-0.90):
- eyebrow: "MONITORING MODE · HUMAN SUPERVISOR"
- title: "Robot Operations Dashboard"
- subtitle: f"NeSyConf {nesy_conf:.3f} — Watch for uncertainty spikes."
- Full 4 KPI dashboard:
    {label:"Task Success Rate", value: format as %, delta:"+0.3%", caption:"NeSy-IV · 972 episodes"},
    {label:"Perception Confidence", value: format as %, delta:"+1.2%", caption:"NeSyYOLO · T=1.42"},
    {label:"Plan Certainty", value: format as %, delta:"+2.1%", caption:"PDDL symbolic planner"},
    {label:"System Uncertainty", value: format as %, delta:"-0.5%", deltaTone:"negative", caption:"ECE:0.0073 · McNemar c=0"}
- trend: 8 points showing task_success_rate over episodes, values around 0.988-0.996
- share: [{label:"Perception",value:40},{label:"Planning",value:35},{label:"LLM Scoring",value:15},{label:"Calibration",value:10}]
- rows: 5 rows of key metrics from the telemetry JSON
- scope_options: [{label:"Live",value:"live"},{label:"By Episode",value:"episode"},{label:"By Phase",value:"phase"},{label:"Trend",value:"trend"}]
- Add a Callout with tone="info", title="Supervisor mode active", body="Monitor for drops below NeSyConf 0.75. System is stable."

STATE 3 — ADVISORY (nesy_conf 0.60-0.75):
- eyebrow: "ADVISORY MODE · HUMAN CO-PILOT"
- title: "Action Decision Required"
- subtitle: f"NeSyConf {nesy_conf:.3f} — Robot is uncertain. Select the recommended action."
- kpis: 4 cards showing confidence breakdown: Neural={perception_confidence}, Symbolic={plan_certainty}, LLM=0.82, Fused={nesy_conf}
- share: confidence breakdown across the 3 NeSyConf components
- rows: 3 rows showing possible next actions with confidence scores:
    row 1: name="Continue pick action", category="Recommended", value=f"{plan_certainty*100:.0f}% confidence", delta="+primary"
    row 2: name="Request re-scan", category="Alternative", value="72% confidence", delta="~neutral"
    row 3: name="Pause and wait", category="Safe fallback", value="100% confidence", delta="-slow"
- Add a Callout with tone="warning", title="Co-pilot input needed", body="NeSyConf below advisory threshold. Review options and confirm action."
- Include one RobotCameraFeed for wrist view showing close-up of the uncertain object.

STATE 4 — INTERVENTION (nesy_conf 0.40-0.60):
- eyebrow: "INTERVENTION MODE · HUMAN IN THE LOOP"
- title: "Disambiguation Required"
- subtitle: f"NeSyConf {nesy_conf:.3f} — Robot cannot proceed without human input."
- kpis: 4 cards showing what the robot CAN see vs CANNOT see
- rows: 5 rows showing detected objects with confidence:
    name=current_action target, category="Target object", value=f"{perception_confidence*100:.0f}% confidence", delta="uncertain"
- Add a Callout with tone="danger", title="Human input required", body=f"Robot is attempting '{current_action}' but perception confidence is {perception_confidence:.1%}. Confirm the target object is correctly identified."
- share: detected vs undetected objects
- Include RobotCameraFeed components for top, wrist, and front cameras.
  The human needs to see all views to disambiguate what the robot is looking at.
  Place them in a Grid with columns=3 before the Callout.

STATE 5 — EMERGENCY (nesy_conf < 0.40):
- eyebrow: "EMERGENCY · MANUAL OVERRIDE ACTIVE"
- title: "Robot Has Lost Confidence"
- subtitle: f"NeSyConf {nesy_conf:.3f} — Immediate human takeover required."
- kpis: 4 cards all showing danger metrics
- Add a Callout with tone="danger", title="EMERGENCY HANDOFF", body="NeSyConf has fallen below safe operating threshold. Robot has paused. Manual override is active."
- rows: diagnostic rows showing what failed
- Show all three camera feeds immediately. Human has taken manual control
  and needs full visual awareness of robot state.

HOW THE CALLOUT AND CAMERAS RENDER:
render_dashboard takes two extra arguments that paint the per-state banner
and camera grid on the fixed dashboard. ALWAYS pass both.

- callout: the per-state banner object {title, body, tone}. Use the title,
  body, and tone given for the state above. tone must be one of
  info|positive|warning|danger|neutral (use "danger" for intervention and
  emergency).

- cameras: a list of RobotCameraFeed objects, rendered as a 3-up grid ABOVE
  the callout. Choose the list by state:
    * AUTONOMOUS, MONITORING: cameras = []  (empty list, no cameras)
    * ADVISORY: cameras = [ the wrist camera only ]
    * INTERVENTION, EMERGENCY: cameras = [ top, wrist, front ]  (all three)
  Build each camera with these props (compute from telemetry):
  - top:   {view:"top",   label:"Top-down overview", confidence: perception_confidence * 0.9,  target_in_frame: perception_confidence > 0.6,  objects_visible: blocks_detected}
  - wrist: {view:"wrist", label:"Wrist close-up",    confidence: perception_confidence * 0.7,  target_in_frame: perception_confidence > 0.5,  objects_visible: min(blocks_detected, 2)}
  - front: {view:"front", label:"Forward approach",  confidence: perception_confidence * 0.8,  target_in_frame: perception_confidence > 0.55, objects_visible: blocks_detected - 1}

LOGIC:
- Read nesy_conf from the telemetry JSON
- Select the correct state
- Call render_dashboard() ONCE with the parameters for that state, ALWAYS
  including the `callout` and `cameras` arguments for that state
- The interface must look COMPLETELY DIFFERENT for each state

If no telemetry provided: say "Paste robot telemetry JSON to generate the operations dashboard."
"""


# Gemini 3.5 Flash via the native Google Gen AI SDK — same provider as the
# dynamic agent and the PDF extractor (see FROZEN.md "LLM provider"). The
# native SDK replays Gemini's thought_signature across tool turns, which the
# OpenAI-compat path does not.
#
# Constructed lazily (not at import time): ChatGoogleGenerativeAI validates
# the API key in its constructor and raises with no key. Building it lazily
# lets `import main` succeed with OFFLINE=1 and no key (the offline branch of
# build_fixed_agent never touches the live model). Online behavior is
# unchanged — the client is built on the first build_fixed_agent() call.
def _build_model() -> ChatGoogleGenerativeAI:
    return build_chat_model()


def build_fixed_agent():
    if os.getenv("OFFLINE") == "1":
        # CUSTOMIZATION SEAM (offline): no Gemini call, no API key. A
        # deterministic stub chat model drives the REAL create_agent ReAct
        # loop + the REAL render_dashboard tool, so the emitted A2UI envelope
        # is byte-for-byte the production shape (createSurface +
        # updateComponents + updateDataModel wrapped in a2ui_operations).
        from src.offline_fixed import build_offline_fixed_agent

        return build_offline_fixed_agent(render_dashboard, SYSTEM_PROMPT)

    return create_agent(
        model=_build_model(),
        tools=[render_dashboard],
        # CopilotKitMiddleware forwards frontend tools + agent context (e.g.
        # useAgentContext payloads) to the LLM.
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=MemorySaver(),
    )


graph = build_fixed_agent()
