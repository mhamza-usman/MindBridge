"""Deterministic telemetry -> A2UI dashboard renderer (no LLM).

The chat agents (fixed_agent / dynamic_agent) ask Gemini to read `nesy_conf`
and call `render_dashboard`. That is great for one-off questions but too slow
(~tens of seconds, two model calls on /dynamic) and fragile across rapid
multi-turn input for a LIVE robot feed that streams telemetry continuously.

This module maps telemetry -> the SAME `dashboard.json` surface the fixed
agent renders, but PURELY deterministically: classify the cognitive state from
`nesy_conf`, build the per-state data model, and emit the A2UI operations. No
model in the loop, so a live page can re-render every frame instantly and never
hit the INCOMPLETE_STREAM multi-turn replay crash.

The five cognitive states and their per-state content mirror the SYSTEM_PROMPT
in fixed_agent.py — keep the two in sync if you change one.
"""
from __future__ import annotations

import math
from typing import Any

from copilotkit import a2ui

from src.catalog import CATALOG_ID
from src.fixed_agent import DASHBOARD_SCHEMA, SURFACE


def classify(nesy_conf: float) -> str:
    """Map a fused NeSyConf value to a cognitive state."""
    if nesy_conf >= 0.90:
        return "autonomous"
    if nesy_conf >= 0.75:
        return "monitoring"
    if nesy_conf >= 0.60:
        return "advisory"
    if nesy_conf >= 0.40:
        return "intervention"
    return "emergency"


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def _trend(nesy_conf: float, episode: int) -> list[dict[str, Any]]:
    """8 NeSyConf points leading up to the current episode."""
    pts: list[dict[str, Any]] = []
    for i in range(8):
        v = nesy_conf - (7 - i) * 0.012 + 0.015 * math.sin(i * 1.1)
        v = max(0.05, min(0.99, v))
        pts.append({"label": f"Ep {episode - 7 + i}", "value": round(v, 3)})
    return pts


def _cameras(perception: float, blocks: int, views: list[str]) -> list[dict[str, Any]]:
    """Build RobotCameraFeed props for the requested views (per spec)."""
    specs = {
        "top": {
            "view": "top",
            "label": "Top-down overview",
            "confidence": round(perception * 0.9, 3),
            "target_in_frame": perception > 0.6,
            "objects_visible": blocks,
        },
        "wrist": {
            "view": "wrist",
            "label": "Wrist close-up",
            "confidence": round(perception * 0.7, 3),
            "target_in_frame": perception > 0.5,
            "objects_visible": min(blocks, 2),
        },
        "front": {
            "view": "front",
            "label": "Forward approach",
            "confidence": round(perception * 0.8, 3),
            "target_in_frame": perception > 0.55,
            "objects_visible": max(blocks - 1, 0),
        },
    }
    return [specs[v] for v in views]


def build_payload(t: dict[str, Any]) -> dict[str, Any]:
    """Telemetry dict -> the dashboard data model for its cognitive state."""
    c = float(t.get("nesy_conf", 0.0))
    p = float(t.get("perception_confidence", 0.0))
    pc = float(t.get("plan_certainty", 0.0))
    su = float(t.get("system_uncertainty", 0.0))
    tsr = float(t.get("task_success_rate", 0.0))
    ep = int(t.get("episode", 0))
    action = str(t.get("current_action", "idle"))
    blocks = int(t.get("blocks_detected", 0))
    state = classify(c)

    eyebrow_phase = f"EPISODE {ep} · PHASE {t.get('phase', '—')}"
    trend = _trend(c, ep)
    scope = {
        "options": [
            {"label": "Heartbeat", "value": "heartbeat"},
            {"label": "History", "value": "history"},
        ],
        "selected": "heartbeat",
    }

    if state == "autonomous":
        return {
            "eyebrow": "AUTONOMOUS MODE · HUMAN OBSERVER",
            "title": "System Operating Autonomously",
            "subtitle": f"NeSyConf {c:.3f} — Robot confidence is high. Stand by.",
            "kpis": [
                {"label": "Task Success Rate", "value": _pct(tsr), "delta": "+0.5%", "caption": "Excellent performance"},
                {"label": "NeSyConf", "value": _pct(c), "delta": "+2.4%", "caption": "High confidence threshold met"},
                {"label": "Perception", "value": _pct(p), "delta": "+1.1%", "caption": "Vision stable"},
                {"label": "Plan Certainty", "value": _pct(pc), "delta": "+0.8%", "caption": "Planner converged"},
            ],
            "trend": trend,
            "share": [
                {"label": "Autonomous decisions", "value": 95},
                {"label": "Human interventions", "value": 5},
            ],
            "rows": [
                {"name": action, "category": "Autonomous", "value": _pct(c), "delta": ""},
                {"name": "navigate", "category": "Autonomous", "value": "97.0%", "delta": "+1%"},
                {"name": "pick", "category": "Autonomous", "value": "96.2%", "delta": "+2%"},
                {"name": "place", "category": "Autonomous", "value": "95.8%", "delta": ""},
                {"name": "verify", "category": "Autonomous", "value": "98.1%", "delta": "+1%"},
            ],
            "scope": scope,
            "callout": {
                "tone": "positive",
                "title": "All systems nominal",
                "body": "Robot is operating within confidence bounds. No intervention required.",
            },
            "cameras": [],
        }

    if state == "monitoring":
        return {
            "eyebrow": "MONITORING MODE · HUMAN SUPERVISOR",
            "title": "Robot Operations Dashboard",
            "subtitle": f"NeSyConf {c:.3f} — Watch for uncertainty spikes.",
            "kpis": [
                {"label": "NeSyConf", "value": _pct(c), "delta": "-1.2%", "caption": "Above supervisor threshold"},
                {"label": "Task Success Rate", "value": _pct(tsr), "delta": "+0.2%", "caption": "Nominal"},
                {"label": "Perception", "value": _pct(p), "delta": "-0.6%", "caption": "Minor variance"},
                {"label": "System Uncertainty", "value": _pct(su), "delta": "+0.4%", "caption": "Within tolerance"},
            ],
            "trend": trend,
            "share": [
                {"label": "Stable", "value": 82},
                {"label": "Watch", "value": 14},
                {"label": "Alert", "value": 4},
            ],
            "rows": [
                {"name": action, "category": "Monitored", "value": _pct(c), "delta": ""},
                {"name": "perception", "category": "Subsystem", "value": _pct(p), "delta": "-1%"},
                {"name": "planner", "category": "Subsystem", "value": _pct(pc), "delta": ""},
                {"name": "uncertainty", "category": "Risk", "value": _pct(su), "delta": "+0%"},
                {"name": "success rate", "category": "Outcome", "value": _pct(tsr), "delta": "+0%"},
            ],
            "scope": scope,
            "callout": {
                "tone": "info",
                "title": "Supervisor mode active",
                "body": "Monitor for drops below NeSyConf 0.75. System is stable.",
            },
            "cameras": [],
        }

    if state == "advisory":
        return {
            "eyebrow": "ADVISORY MODE · HUMAN CO-PILOT",
            "title": "Action Decision Required",
            "subtitle": f"NeSyConf {c:.3f} — Robot is uncertain. Select the recommended action.",
            "kpis": [
                {"label": "Neural", "value": _pct(p), "delta": "", "caption": "Perception confidence"},
                {"label": "Symbolic", "value": _pct(pc), "delta": "", "caption": "Plan certainty"},
                {"label": "LLM", "value": "82.0%", "delta": "", "caption": "Language reasoning"},
                {"label": "Fused", "value": _pct(c), "delta": "-3%", "caption": "NeSyConf (fused)"},
            ],
            "trend": trend,
            "share": [
                {"label": "Neural", "value": round(p * 100)},
                {"label": "Symbolic", "value": round(pc * 100)},
                {"label": "LLM", "value": 82},
            ],
            "rows": [
                {"name": f"Continue {action} action", "category": "Recommended", "value": f"{pc * 100:.0f}% confidence", "delta": "+primary"},
                {"name": "Request re-scan", "category": "Alternative", "value": "72% confidence", "delta": ""},
                {"name": "Pause and wait", "category": "Safe fallback", "value": "100% confidence", "delta": "-slow"},
            ],
            "scope": scope,
            "callout": {
                "tone": "warning",
                "title": "Co-pilot input needed",
                "body": "NeSyConf below advisory threshold. Review options and confirm action.",
            },
            "cameras": _cameras(p, blocks, ["wrist"]),
        }

    if state == "intervention":
        return {
            "eyebrow": "INTERVENTION MODE · HUMAN IN THE LOOP",
            "title": "Disambiguation Required",
            "subtitle": f"NeSyConf {c:.3f} — Robot cannot proceed without human input.",
            "kpis": [
                {"label": "Perception", "value": _pct(p), "delta": "-12%", "caption": "Below safe threshold"},
                {"label": "Plan Certainty", "value": _pct(pc), "delta": "-9%", "caption": "Planner unsure"},
                {"label": "System Uncertainty", "value": _pct(su), "delta": "+18%", "caption": "Rising"},
                {"label": "Blocks Detected", "value": str(blocks), "delta": "", "caption": "Objects in workspace"},
            ],
            "trend": trend,
            "share": [
                {"label": "Detected", "value": max(blocks, 1)},
                {"label": "Uncertain", "value": 3},
            ],
            "rows": [
                {"name": f"{action} target", "category": "Target object", "value": f"{p * 100:.0f}% confidence", "delta": "uncertain"},
                {"name": "object A", "category": "Detected", "value": "61% confidence", "delta": ""},
                {"name": "object B", "category": "Detected", "value": "54% confidence", "delta": ""},
                {"name": "object C", "category": "Ambiguous", "value": "38% confidence", "delta": "-low"},
                {"name": "occluded region", "category": "Unknown", "value": "—", "delta": ""},
            ],
            "scope": scope,
            "callout": {
                "tone": "danger",
                "title": "Human input required",
                "body": f"Robot is attempting '{action}' but perception confidence is {p:.1%}. Confirm the target object is correctly identified.",
            },
            "cameras": _cameras(p, blocks, ["top", "wrist", "front"]),
        }

    # emergency
    return {
        "eyebrow": "EMERGENCY · MANUAL OVERRIDE ACTIVE",
        "title": "Robot Has Lost Confidence",
        "subtitle": f"NeSyConf {c:.3f} — Immediate human takeover required.",
        "kpis": [
            {"label": "NeSyConf", "value": _pct(c), "delta": "-31%", "caption": "Below safe operating threshold"},
            {"label": "Perception", "value": _pct(p), "delta": "-28%", "caption": "Vision unreliable"},
            {"label": "Plan Certainty", "value": _pct(pc), "delta": "-25%", "caption": "Planner failed"},
            {"label": "System Uncertainty", "value": _pct(su), "delta": "+44%", "caption": "Critical"},
        ],
        "trend": trend,
        "share": [
            {"label": "Failed", "value": 61},
            {"label": "Degraded", "value": 27},
            {"label": "OK", "value": 12},
        ],
        "rows": [
            {"name": "perception module", "category": "Diagnostic", "value": "FAULT", "delta": "-fail"},
            {"name": "planner", "category": "Diagnostic", "value": "STALLED", "delta": "-fail"},
            {"name": f"{action} action", "category": "Aborted", "value": "HALTED", "delta": "-fail"},
            {"name": "confidence fusion", "category": "Diagnostic", "value": _pct(c), "delta": "-crit"},
            {"name": "manual override", "category": "Status", "value": "ACTIVE", "delta": ""},
        ],
        "scope": scope,
        "callout": {
            "tone": "danger",
            "title": "EMERGENCY HANDOFF",
            "body": "NeSyConf has fallen below safe operating threshold. Robot has paused. Manual override is active.",
        },
        "cameras": _cameras(p, blocks, ["top", "wrist", "front"]),
    }


def surface_ops(t: dict[str, Any]) -> list[dict[str, Any]]:
    """Telemetry -> A2UI v0.9 operations for the dashboard surface."""
    return [
        a2ui.create_surface(SURFACE, catalog_id=CATALOG_ID),
        a2ui.update_components(SURFACE, DASHBOARD_SCHEMA),
        a2ui.update_data_model(SURFACE, build_payload(t)),
    ]
