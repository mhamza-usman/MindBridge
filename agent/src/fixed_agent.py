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


class Location(TypedDict):
    x: float
    y: float
    z: float


class Sensors(TypedDict):
    internal_temp_c: float
    lidar_status: str
    obstacle_proximity_m: float


@tool
def render_dashboard(
    robot_id: str,
    timestamp: str,
    status: str,
    battery_percentage: float,
    location: Location,
    speed_mps: float,
    sensors: Sensors,
    current_task: str,
) -> str:
    """Render the interactive dashboard for the robot telemetry.

    Pass data INLINE. Call ONCE per turn.

    Required shapes match the robot telemetry JSON format directly.
    """
    payload = {
        "robot_id": robot_id,
        "timestamp": timestamp,
        "status": status,
        "battery_percentage": battery_percentage,
        "location": location,
        "speed_mps": speed_mps,
        "sensors": sensors,
        "current_task": current_task,
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

The user will paste robot telemetry JSON (like robot_id, battery_percentage, sensors).
Your job is to read the JSON and call `render_dashboard` with those exact parameters.

LOGIC:
- Read the JSON data
- Extract the robot_id, timestamp, status, battery_percentage, location, speed_mps, sensors, and current_task.
- Call render_dashboard() ONCE with the parameters

If no JSON data is provided: say "Paste the robot telemetry JSON data to generate the operations dashboard."
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
