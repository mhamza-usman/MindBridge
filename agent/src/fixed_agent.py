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
from typing import TypedDict, Any

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import tool

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
what to render. The moment ANY JSON data appears in the conversation:
1. Analyze the JSON structure and contents.
2. Automatically map the data to the fixed dashboard layout.
3. Call render_dashboard() ONCE with the parameters, WITHOUT
   being asked. Do not ask what to render. Do not wait for instructions.

The user may paste robot telemetry, financial data, logistics data, or anything else.
Your job is to read the JSON and generate the CORRECT interface for that data.

Fill the fixed dashboard fields creatively to fit the data:
- eyebrow, title, subtitle: describe the data context
- kpis: EXACTLY 4 cards summarizing the most important metrics
- trend: 6-12 points of time-series or sequential data
- share: 3-5 slices showing a breakdown of categorical data
- rows: 5-8 table rows showing detailed records
- scope_options: provide sensible filtering options
- callout: highlight the most critical anomaly or insight from the data
- cameras: pass an empty list [] unless the data explicitly describes robot camera feeds

HOW THE CALLOUT AND CAMERAS RENDER:
render_dashboard takes two extra arguments that paint the per-state banner
and camera grid on the fixed dashboard. ALWAYS pass both.

- callout: the per-state banner object {title, body, tone}.
  tone must be one of info|positive|warning|danger|neutral.

- cameras: a list of RobotCameraFeed objects, rendered as a 3-up grid ABOVE
  the callout. Pass [] if the JSON does not contain camera data.

LOGIC:
- Read the JSON data
- Determine the best way to visualize it
- Call render_dashboard() ONCE with the parameters
- Ensure the interface looks appropriate for the context

If no JSON data is provided: say "Paste any JSON data to generate the operations dashboard."
"""


# Gemini 3.5 Flash via the native Google Gen AI SDK — same provider as the
# dynamic agent and the PDF extractor (see FROZEN.md "LLM provider"). The
# native SDK replays Gemini's thought_signature across tool turns, which the
# OpenAI-compat path does not.
#
# Constructed lazily (not at import time): Any validates
# the API key in its constructor and raises with no key. Building it lazily
# lets `import main` succeed with OFFLINE=1 and no key (the offline branch of
# build_fixed_agent never touches the live model). Online behavior is
# unchanged — the client is built on the first build_fixed_agent() call.
def _build_model() -> Any:
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
