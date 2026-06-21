from fastapi import APIRouter, Body
from fastapi.responses import StreamingResponse
import asyncio, base64, io, json, random, time, math

from src.robot_render import build_payload, classify, surface_ops

router = APIRouter()

def generate_nesy_state():
    t = time.time()
    return {
        "episode": int(t / 30) % 100,
        "task_success_rate": round(0.993 + random.gauss(0, 0.002), 3),
        "perception_confidence": round(0.85 + 0.08 * math.sin(t * 0.3), 3),
        "plan_certainty": round(0.78 + random.gauss(0, 0.025), 3),
        "system_uncertainty": round(abs(0.11 + random.gauss(0, 0.015)), 3),
        "nesy_conf": round(0.934 + random.gauss(0, 0.01), 3),
        "ece": 0.0073,
        "phase": "EXECUTING" if random.random() > 0.15 else "PLANNING",
        "current_action": random.choice(["pick","place","navigate","grasp","verify"]),
        "blocks_detected": random.randint(2, 5),
        "mcnemar_c": 0,
    }

@router.get("/robot/state")
def get_robot_state():
    return generate_nesy_state()

@router.get("/robot/history")
def get_robot_history():
    t = time.time()
    return [
        {"label": f"Ep {i}", "value": round(0.988 + math.sin(i * 0.4) * 0.006, 3)}
        for i in range(10)
    ]


@router.get("/robot/demo/{state}")
def get_demo_state(state: str):
    states = {
        "autonomous": {"nesy_conf": 0.945, "task_success_rate": 0.993, "perception_confidence": 0.921, "plan_certainty": 0.889, "system_uncertainty": 0.08, "ece": 0.0073, "phase": "EXECUTING", "current_action": "pick", "blocks_detected": 4, "episode": 47},
        "monitoring": {"nesy_conf": 0.821, "task_success_rate": 0.981, "perception_confidence": 0.834, "plan_certainty": 0.798, "system_uncertainty": 0.14, "ece": 0.0073, "phase": "EXECUTING", "current_action": "navigate", "blocks_detected": 3, "episode": 48},
        "advisory": {"nesy_conf": 0.712, "task_success_rate": 0.954, "perception_confidence": 0.701, "plan_certainty": 0.698, "system_uncertainty": 0.22, "ece": 0.0073, "phase": "PLANNING", "current_action": "grasp", "blocks_detected": 2, "episode": 49},
        "intervention": {"nesy_conf": 0.521, "task_success_rate": 0.921, "perception_confidence": 0.498, "plan_certainty": 0.534, "system_uncertainty": 0.38, "ece": 0.0073, "phase": "PLANNING", "current_action": "place", "blocks_detected": 1, "episode": 50},
        "emergency": {"nesy_conf": 0.312, "task_success_rate": 0.887, "perception_confidence": 0.298, "plan_certainty": 0.334, "system_uncertainty": 0.61, "ece": 0.0073, "phase": "PLANNING", "current_action": "verify", "blocks_detected": 0, "episode": 51},
    }
    return states.get(state, states["monitoring"])


# ── Live, LLM-free render path ────────────────────────────────────────────
# /robot/render turns a telemetry frame into the A2UI dashboard surface
# deterministically (see robot_render.py). The live page polls /robot/stream
# for an evolving frame and POSTs it here to re-render instantly — no Gemini
# in the hot path, so it is fast and never hits the chat agent's multi-turn
# INCOMPLETE_STREAM crash.
@router.post("/robot/render")
def render_telemetry(telemetry: dict = Body(...)):
    """Deterministically render a telemetry frame to A2UI operations.

    Returns {"state", "nesy_conf", "a2ui_operations"}. The a2ui_operations
    array is exactly what the frontend surface bus consumes.
    """
    nesy_conf = float(telemetry.get("nesy_conf", 0.0))
    return {
        "state": classify(nesy_conf),
        "nesy_conf": nesy_conf,
        "a2ui_operations": surface_ops(telemetry),
    }


# A continuous telemetry generator. nesy_conf follows a slow triangle wave so
# the live feed sweeps the full 0.30–0.97 range and visits every cognitive
# state; perception/plan track it with a little noise. Stateless (time-based)
# so every client sees a coherent, ever-changing stream.
_STREAM_PERIOD_S = 48.0  # one full low->high->low sweep


def generate_stream_frame():
    t = time.time()
    phase = (t % _STREAM_PERIOD_S) / _STREAM_PERIOD_S  # 0..1
    triangle = 1 - abs(2 * phase - 1)  # 0..1..0
    nesy = round(0.30 + 0.66 * triangle + random.gauss(0, 0.008), 3)
    nesy = max(0.05, min(0.99, nesy))
    perception = round(max(0.05, min(0.99, nesy - 0.02 + random.gauss(0, 0.02))), 3)
    plan = round(max(0.05, min(0.99, nesy - 0.03 + random.gauss(0, 0.02))), 3)
    su = round(max(0.02, min(0.95, 1 - nesy + random.gauss(0, 0.02))), 3)
    blocks = max(0, round(1 + triangle * 4))
    return {
        "episode": int(t / 6) % 1000,
        "task_success_rate": round(max(0.80, min(0.999, 0.86 + 0.13 * triangle)), 3),
        "perception_confidence": perception,
        "plan_certainty": plan,
        "system_uncertainty": su,
        "nesy_conf": nesy,
        "ece": 0.0073,
        "phase": "EXECUTING" if nesy >= 0.6 else "PLANNING",
        "current_action": random.choice(["pick", "place", "navigate", "grasp", "verify"]),
        "blocks_detected": blocks,
    }


@router.get("/robot/frame")
def get_stream_frame():
    """Single evolving telemetry frame (the /live page polls this)."""
    return generate_stream_frame()


@router.get("/robot/stream")
async def stream_robot_state():
    """Server-Sent Events stream of continuous telemetry.

    For a robot that streams data continuously: open this once and receive a
    telemetry frame every second (text/event-stream). Uses the state-sweeping
    generator so consumers see all five cognitive states over time. For a
    one-shot poll, use /robot/frame instead.
    """

    async def generate():
        while True:
            frame = generate_stream_frame()
            yield f"data: {json.dumps(frame)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/robot/camera/{view}")
def get_camera_feed(view: str):
    """
    Returns a simulated robot camera view as base64 PNG.
    In production this would be the actual PyBullet render.
    For demo: returns metadata about what the camera sees.
    """
    views = {
        "top": {
            "view": "top",
            "label": "Top-down overview camera",
            "description": "Overhead view showing full workspace",
            "feed_url": "http://localhost:8123/robot/camera/top/frame",
            "confidence": round(random.uniform(0.6, 0.95), 3),
            "objects_visible": random.randint(2, 5),
            "target_in_frame": random.choice([True, True, True, False]),
        },
        "wrist": {
            "view": "wrist",
            "label": "Wrist-mounted camera",
            "description": "Close-up view from robot end-effector",
            "feed_url": "http://localhost:8123/robot/camera/wrist/frame",
            "confidence": round(random.uniform(0.4, 0.85), 3),
            "objects_visible": random.randint(0, 2),
            "target_in_frame": random.choice([True, False, False]),
        },
        "front": {
            "view": "front",
            "label": "Front-facing camera",
            "description": "Forward view showing approach vector",
            "feed_url": "http://localhost:8123/robot/camera/front/frame",
            "confidence": round(random.uniform(0.5, 0.9), 3),
            "objects_visible": random.randint(1, 4),
            "target_in_frame": random.choice([True, True, False]),
        }
    }
    return views.get(view, views["front"])
