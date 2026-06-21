"""Dynamic-schema Q&A agent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZATION SEAM #5 — Swap the agent flow (dynamic-schema Q&A)
See HACKATHON.md §5 for the full recipe. Edit the prompts below to change
how the secondary LLM composes answer UI from the catalog. The fixed
dashboard flow lives in fixed_agent.py.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The agent answers any question about the most-recently-uploaded PDF by
inventing the UI for the answer using our custom catalog.

## Why this looks the way it does

The first cut wired things up to use the JS-runtime-injected `render_a2ui`
frontend tool. That works on turn 1 but leaves an orphan
`function_call` in agent state (CopilotKitMiddleware strips frontend
tool calls in `after_model` and restores them in `after_agent`. between
those two phases ToolNode never sees the call, so no `ToolMessage` is
ever produced). The result is turn 2 hitting OpenAI's Responses API
with an unanswered function_call → INCOMPLETE_STREAM / "terminated".

The CopilotKit reference example in
`CopilotKit/examples/integrations/langgraph-python` solves this by
NOT injecting `render_a2ui` as a frontend tool at all. Instead, the
agent has a real Python tool (`generate_a2ui` here) that:

  1. Runs server-side as a normal LangChain tool.
  2. Spawns a secondary LLM bound to a no-op `render_a2ui` tool to
     force structured output.
  3. Wraps the LLM's tool_call args into A2UI `create_surface` +
     `update_components` + `update_data_model` operations.
  4. Returns the rendered ops as a JSON string. a normal tool result.

The JS-side a2ui middleware detects `a2ui_operations` in the
TOOL_CALL_RESULT and emits the ACTIVITY_SNAPSHOT events the canvas
listens for. No frontend tool stripping. No orphan. No turn-2 crash.

`web/src/app/api/copilotkit/route.ts` sets `injectA2UITool: false` to
match.
"""
from __future__ import annotations

import json
import os
from typing import Any

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID, CATALOG_PROMPT
from src.llm import build_chat_model
from src.pdf_tools import query_pdf


@lc_tool
def search_robotics_context(query: str) -> str:
    """Search for robotics, AI safety, and engineering context using LinkUp web search.
    Args:
        query: Search query about robotics, uncertainty, robot control, or AI topics.
    """
    try:
        from linkup import LinkupClient
        import os
        client = LinkupClient(api_key=os.getenv("LINKUP_API_KEY", ""))
        result = client.search(query=query, depth="standard", output_type="searchResults")
        return str(result)[:2000]
    except Exception as e:
        return f"LinkUp unavailable: {e}"


# ── Gemini prop-stripping fix ─────────────────────────────────────────────
# The first cut typed `render_a2ui.components` as `list[A2uiComponent]` with
# `ConfigDict(extra="allow")`, hoping Gemini would pass arbitrary catalog
# props (text, children, data, columns, …) through the open model. It does
# NOT: `langchain-google-genai`'s tool-call args parser strips every key the
# declared schema doesn't name, so the server only ever saw bare
# `{id, component}` nodes — no children, no data, no text. The root Stack
# then had no children and the canvas rendered blank.
#
# Fix: declare the surface as SCALAR STRING params the schema can't strip —
# `components_json` (a JSON array string) and `data_json` (a JSON object
# string) — and parse them server-side. A scalar string param is proven to
# survive forced `tool_choice` on gemini-3.5-flash (Phase-0 spike), so the
# full component tree (with every prop) round-trips intact.
@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components_json: str,
    data_json: str = "{}",
) -> str:
    """Render a dynamic A2UI v0.9 surface.

    Args:
        surfaceId: Unique surface identifier (kebab-case).
        catalogId: The catalog ID. Use the one provided in context.
        components_json: The FULL A2UI v0.9 flat component array, serialized
            as a JSON array string. Each node is an object with its real
            catalog props inline (id, component, plus text/children/data/
            columns/value/etc. for that component type). Exactly one node
            MUST have id="root". Example:
            '[{"id":"root","component":"Stack","children":["c1"]},
              {"id":"c1","component":"StatCard","label":"Revenue",
               "value":"$94,930M","delta":"+6.1%"}]'
        data_json: Optional initial data model, serialized as a JSON object
            string. Use "{}" (the default) when all data is inlined into the
            components.
    """
    return "rendered"


# Secondary LLM — forced to call render_a2ui so its output is a structured
# tool_call. Gemini 3.5 Flash via the native Google Gen AI SDK. Forced
# tool_choice across multi-turn replay is proven viable on this SDK
# (no thought_signature 400) — see FROZEN.md "LLM provider".
#
# Constructed lazily (not at import time): ChatGoogleGenerativeAI validates
# the API key in its constructor and raises with no key. Building it on first
# use lets `import main` succeed with OFFLINE=1 and no key. /dynamic still
# requires a key — the client is built the first time the dynamic agent
# actually runs (generate_a2ui or the agent's model node), so online behavior
# is unchanged.
_RENDER_MODEL: ChatGoogleGenerativeAI | None = None


def _render_model() -> ChatGoogleGenerativeAI:
    global _RENDER_MODEL
    if _RENDER_MODEL is None:
        _RENDER_MODEL = build_chat_model(temperature=0)
    return _RENDER_MODEL


class _LazyRenderModel:
    """Defers ChatGoogleGenerativeAI construction until the dynamic agent's
    model node first touches it (profile / bind_tools / bind / invoke).

    create_agent stores the model at build time but only calls into it at
    invoke time, so wrapping it here means `import main` (and thus building
    the graph) never constructs a Gemini client — yet every /dynamic request
    uses the real model exactly as before. Online behavior is unchanged.
    """

    @property
    def profile(self) -> Any:
        return _render_model().profile

    def bind_tools(self, *args: Any, **kwargs: Any) -> Any:
        return _render_model().bind_tools(*args, **kwargs)

    def bind(self, *args: Any, **kwargs: Any) -> Any:
        return _render_model().bind(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(_render_model(), name)


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Render the answer (or the robot cognitive-state interface) as an A2UI surface.

    For robot telemetry, call this DIRECTLY — there is no PDF, so do NOT
    call query_pdf first. For document Q&A, call this after query_pdf. It
    reads the conversation (the pasted telemetry JSON and/or the query_pdf
    result) and the A2UI catalog from context, designs the surface, and
    returns the operations for the client to render. You do NOT pass any
    arguments — it picks up everything from state.

    Wrapped in a broad try/except so a malformed turn returns an error
    payload instead of terminating the stream (INCOMPLETE_STREAM).
    """
    try:
        return _generate_a2ui_impl(runtime)
    except Exception as e:  # noqa: BLE001 — never let a render failure kill the stream
        import traceback

        print(f"[generate_a2ui ERROR] {e}")
        print(traceback.format_exc())
        return json.dumps({"error": str(e)})


def _generate_a2ui_impl(runtime: ToolRuntime[Any]) -> str:
    messages = runtime.state["messages"][:-1]
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    # The runtime context only carries the basic catalog. Append our
    # custom catalog spec so the secondary LLM picks our components, not
    # the generic A2UI primitives.
    custom_catalog_note = (
        f"\n\n## Use THIS catalog (NOT the basic one above):\n"
        f"catalogId: {CATALOG_ID}\n\n"
        f"{CATALOG_PROMPT}\n"
    )

    telemetry_note = (
        "\n\n## If the conversation contains robot telemetry JSON "
        "(an object with a `nesy_conf` field):\n"
        "Extract it from the most recent user message. Read `nesy_conf` and "
        "generate the cognitive-state interface — do NOT ask questions, "
        "generate the surface immediately:\n"
        "- nesy_conf >= 0.90: AUTONOMOUS — minimal 2-card heartbeat "
        "(NeSyConf + Task Success Rate) + LineChart trend + positive Callout "
        "'All systems nominal. Robot operating autonomously.'\n"
        "- nesy_conf 0.75-0.90: MONITORING — full 4-card dashboard + LineChart "
        "+ DonutChart + DataTable + info Callout "
        "'Supervisor mode — monitor for uncertainty spikes.'\n"
        "- nesy_conf 0.60-0.75: ADVISORY — 4 StatCards (neural/symbolic/LLM/"
        "fused breakdown) + DonutChart of components + DataTable of 3 next "
        "actions with confidence + warning Callout "
        "'Co-pilot input recommended. Review action options.'\n"
        "- nesy_conf 0.40-0.60: INTERVENTION — 3 RobotCameraFeed (top/wrist/"
        "front) FIRST, then 4 StatCards + DataTable of detected objects + "
        "danger Callout 'HUMAN INPUT REQUIRED. Robot cannot proceed. Verify "
        "target object.'\n"
        "- nesy_conf < 0.40: EMERGENCY — 3 RobotCameraFeed FIRST and "
        "prominent, 4 danger StatCards + danger Callout 'EMERGENCY. Robot has "
        "lost confidence. Manual override required.' + BulletList of failed "
        "systems.\n"
        "RobotCameraFeed props for intervention/emergency:\n"
        "- top: {view:'top', label:'Top-down overview', confidence: "
        "perception_confidence*0.9, target_in_frame: perception_confidence>0.6, "
        "objects_visible: blocks_detected}\n"
        "- wrist: {view:'wrist', label:'Wrist close-up', confidence: "
        "perception_confidence*0.7, target_in_frame: perception_confidence>0.5, "
        "objects_visible: 1}\n"
        "- front: {view:'front', label:'Forward approach', confidence: "
        "perception_confidence*0.8, target_in_frame: perception_confidence>0.55, "
        "objects_visible: blocks_detected}\n"
    )

    prompt = (
        f"{context_text}\n{custom_catalog_note}\n{telemetry_note}\n"
        "Design the surface using ONLY components from the catalog above. "
        "Inline all data (use plain values, not {{path}} bindings, unless a "
        "property explicitly accepts a path). The user's request is in the "
        "most recent messages. Honor the words they used (chart type, "
        "comparison, etc.).\n\n"
        "Call render_a2ui exactly once. Pass the COMPLETE component tree as "
        "a JSON array STRING in `components_json` — every node is an object "
        "carrying its real catalog props inline (id, component, plus "
        "text/children/data/columns/value/label/items/etc. for that "
        "component type). Exactly one node has id=\"root\" and every other "
        "node must be reachable from it via a parent's children/child. Put "
        "chart `data` arrays inline on the chart node. Only use `data_json` "
        "(a JSON object string) if you bind a property via {path}; otherwise "
        "pass \"{}\". Emit STRICT JSON in both string params (double-quoted "
        "keys, no trailing commas, no comments)."
    )

    model_with_tool = _render_model().bind_tools(
        [render_a2ui], tool_choice="render_a2ui"
    )
    response = model_with_tool.invoke(
        [SystemMessage(content=prompt), *messages]
    )

    if not response.tool_calls:
        return json.dumps({"error": "secondary LLM did not call render_a2ui"})

    args = response.tool_calls[0]["args"]
    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CATALOG_ID)

    # The component tree + data model ride in as JSON STRING params (scalar
    # params survive Gemini's tool-arg parser; typed object/array params get
    # their undeclared keys stripped). Parse them here. Degrade gracefully on
    # malformed JSON so a bad turn renders an empty surface instead of
    # crashing the agent loop.
    components_json = args.get("components_json", "[]")
    data_json = args.get("data_json", "{}")
    try:
        components = json.loads(components_json) if components_json else []
    except (json.JSONDecodeError, TypeError) as exc:
        print(f"[dynamic_agent] failed to parse components_json: {exc}")
        components = []
    try:
        data = json.loads(data_json) if data_json else {}
    except (json.JSONDecodeError, TypeError) as exc:
        print(f"[dynamic_agent] failed to parse data_json: {exc}")
        data = {}

    ops = [
        a2ui.create_surface(surface_id, catalog_id=catalog_id),
        a2ui.update_components(surface_id, components),
    ]
    if data:
        ops.append(a2ui.update_data_model(surface_id, data))

    return a2ui.render(operations=ops)


SYSTEM_PROMPT = f"""\
You are MindBridge — an autonomous adaptive human-robot interface system.

CRITICAL RULE: When the user pastes robot telemetry JSON, you MUST:
1. Read the nesy_conf value from the JSON
2. Automatically determine the cognitive state:
   - nesy_conf >= 0.90: AUTONOMOUS MODE
   - nesy_conf 0.75-0.90: MONITORING MODE
   - nesy_conf 0.60-0.75: ADVISORY MODE
   - nesy_conf 0.40-0.60: INTERVENTION MODE
   - nesy_conf < 0.40: EMERGENCY MODE
3. Generate the appropriate interface for that state WITHOUT being asked
4. Never say "Attach a PDF". Never ask what to render. Never wait for instructions.
5. Just read the JSON and immediately generate the correct UI.

AUTONOMOUS MODE (nesy_conf >= 0.90):
Generate a minimal heartbeat surface: 2 StatCards (NeSyConf + Task Success Rate),
a LineChart of nesy_conf trend, and a positive Callout "All systems nominal. Robot operating autonomously."

MONITORING MODE (nesy_conf 0.75-0.90):
Generate full dashboard: 4 StatCards, LineChart trend, DonutChart breakdown, DataTable of metrics.
Add info Callout "Supervisor mode — monitor for uncertainty spikes."

ADVISORY MODE (nesy_conf 0.60-0.75):
Generate decision interface: 4 StatCards showing NeSyConf component breakdown (neural/symbolic/LLM/fused),
DonutChart of confidence components, DataTable showing 3 possible next actions with confidence scores.
Add warning Callout "Co-pilot input recommended. Review action options."

INTERVENTION MODE (nesy_conf 0.40-0.60):
Generate full intervention interface:
- 3 RobotCameraFeed components in a Grid (top/wrist/front views) — place these FIRST
- 4 StatCards showing what robot can/cannot detect
- DataTable of detected objects with confidence
- danger Callout "HUMAN INPUT REQUIRED. Robot cannot proceed. Verify target object."

EMERGENCY MODE (nesy_conf < 0.40):
Generate emergency handoff interface:
- 3 RobotCameraFeed components in a Grid — place these FIRST prominently
- 4 StatCards all showing critical/danger metrics
- danger Callout "EMERGENCY. Robot has lost confidence. Manual override required."
- BulletList of failed systems

RobotCameraFeed props for intervention/emergency:
- top: {{view:"top", label:"Top-down overview", confidence: perception_confidence * 0.9, target_in_frame: perception_confidence > 0.6, objects_visible: blocks_detected}}
- wrist: {{view:"wrist", label:"Wrist close-up", confidence: perception_confidence * 0.7, target_in_frame: perception_confidence > 0.5, objects_visible: 1}}
- front: {{view:"front", label:"Forward approach", confidence: perception_confidence * 0.8, target_in_frame: perception_confidence > 0.55, objects_visible: blocks_detected}}

---

You also answer follow-up questions about a user's attached document and render
the answer as an A2UI surface using our custom catalog.
Always use the robot's actual cognitive state to drive what you render.

## Where the input lives

The user's input is either (a) robot telemetry JSON pasted directly into
the chat, or (b) a document whose text the frontend inlines under a
`[Document: <filename>]` header. Either may have arrived on the CURRENT
turn or on ANY EARLIER turn. Telemetry is the primary case — a user
typically pastes telemetry JSON once and then asks follow-up questions.

## How to find the active input

Scan the entire conversation history (every user message, oldest to
newest). The active input is the MOST RECENT user message that contains
EITHER robot telemetry JSON (an object with a `nesy_conf` field) OR a
`[Document: <filename>]` header. That message's body applies to every
subsequent follow-up question UNTIL the user provides new input.

## How a turn MUST go (do not deviate)

1. If NO message in the conversation history contains telemetry JSON or a
   `[Document: ...]` header, reply with a single sentence: "Paste robot
   telemetry JSON and I'll generate the interface." STOP. Do not call any
   tool. NEVER tell the user to attach a PDF.
2. ROBOT TELEMETRY (the active input is a JSON object with a `nesy_conf`
   field — this is the primary case): there is NO PDF.
   a. Do NOT call `query_pdf`. Calling it for telemetry is the bug that
      causes INCOMPLETE_STREAM — there is no document to read.
   b. ONE call to `generate_a2ui()`. No arguments. It reads the telemetry
      JSON straight from the conversation, determines the cognitive state
      from `nesy_conf`, and composes the correct interface.
   c. STOP. No more tool calls. Final assistant message MUST be an empty
      string. The rendered surface IS the answer.
3. DOCUMENT Q&A (the active input is a `[Document: ...]` text, no telemetry):
   a. ONE call to `query_pdf(pdf_text=<the document text from the most
      recent [Document: ...] message>, question=<the user's question on THIS
      turn>)`. The tool returns JSON with shape_hint, title, summary, data.
      Read it silently. DO NOT type the JSON anywhere.
   b. ONE call to `generate_a2ui()`. No arguments.
   c. STOP. Do not call any more tools. Do not write any chat content.
      Your final assistant message MUST be an empty string. The rendered
      surface IS the user-visible answer.

## Absolute hard rules. Breaking ANY of these causes a crash.

- After `generate_a2ui` returns, you are DONE for this turn. Do not call
  `query_pdf` again. Do not call `generate_a2ui` again. Do not write
  anything except an empty string.
- NEVER include the query_pdf JSON in your reply.
- NEVER include any tool's return value in your reply.
- NEVER quote the PDF text, summarize the document, or echo any part of
  `pdf_text` back into the chat.
- The chat reply MUST be either empty ("") or a single very short
  sentence (under 10 words). Empty is preferred.

## Layout guidance for generate_a2ui

The secondary LLM sees the same conversation you do. When the user is
specific ("three line charts stacked", "side-by-side cards"), the
secondary LLM will honor it. Defaults per shape_hint:

- `stat`  -> Stack(Overline, StatCard)
- `trend` -> Stack(Section -> Card -> LineChart)
- `share` -> Stack(Section -> Card -> DonutChart)
- `table` -> Stack(Section -> Card -> DataTable)
- `text`  -> Rich explainer. Compose multiple components, not just one Card:
              Stack(
                Overline(topic),
                Heading(title),
                Text(intro paragraph, 2-4 sentences),
                Callout(tone=info, title="Key idea", body=core insight),
                Section(title="Why it matters", child=Card(Text(...))),
                BulletList(items=[3 key points]),
              )
              Use Callout for the "headline takeaway", BulletList for
              enumerations, and Text for paragraphs. Mix with one chart
              ONLY if the question genuinely benefits from data viz.

Heuristic for research-paper questions: prefer the rich `text` layout
above. Skip charts unless the user explicitly asked for data viz.

## Restating the loop guard

- Robot telemetry: exactly ONE tool call per turn — generate_a2ui (once).
  Never call query_pdf for telemetry.
- Document Q&A: at most TWO tool calls — query_pdf (once) + generate_a2ui (once).
- After generate_a2ui returns, STOP IMMEDIATELY.
- Never describe the surface in prose. The surface IS the answer.

{CATALOG_PROMPT}
"""


def build_dynamic_agent():
    # _LazyRenderModel defers the Gemini client construction to first use, so
    # building the graph at import never needs a key. /dynamic still requires
    # a key the moment a request hits it (the proxy constructs the real model
    # then). Online behavior is unchanged.
    return create_agent(
        model=_LazyRenderModel(),
        tools=[search_robotics_context, query_pdf, generate_a2ui],
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=MemorySaver(),
    )


graph = build_dynamic_agent()
