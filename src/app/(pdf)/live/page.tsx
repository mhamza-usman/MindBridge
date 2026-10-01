"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
} from "@copilotkit/a2ui-renderer";
import { catalog } from "@/a2ui/catalog";
import { SiteNav } from "@/components/pdf-analyst/Brand";
import { Split } from "@/components/pdf-analyst/Split";

/* Live robot operations feed.
 *
 * Unlike /fixed and /dynamic (which route every telemetry frame through a
 * Gemini chat turn — slow, and a second frame mid-run aborts the stream with
 * INCOMPLETE_STREAM), this page polls a continuous telemetry stream and
 * renders each frame DETERMINISTICALLY via the agent's /robot/render endpoint.
 * No LLM in the hot path: each frame re-renders in ~100ms and the surface
 * updates in place forever as the robot's NeSyConf sweeps cognitive states. */

const ROBOT_API =
  process.env.NEXT_PUBLIC_ROBOT_API ?? "/api";

const SPEEDS = [
  { label: "0.5×", ms: 3000 },
  { label: "1×", ms: 1500 },
  { label: "2×", ms: 750 },
];

type Telemetry = {
  nesy_conf: number;
  perception_confidence: number;
  plan_certainty: number;
  system_uncertainty: number;
  task_success_rate: number;
  current_action: string;
  blocks_detected: number;
  episode: number;
  phase: string;
};

type A2UIOp = Record<string, unknown>;

const STATE_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  autonomous: { label: "AUTONOMOUS", color: "#0d6b4f", bg: "#d9f5e9" },
  monitoring: { label: "MONITORING", color: "#1d4ed8", bg: "#dbeafe" },
  advisory: { label: "ADVISORY", color: "#b45309", bg: "#fef3c7" },
  intervention: { label: "INTERVENTION", color: "#b91c1c", bg: "#fee2e2" },
  emergency: { label: "EMERGENCY", color: "#7f1d1d", bg: "#fecaca" },
};

import { useSearchParams } from "next/navigation";
import AssuranceShell from "../../../../assurance/ui/AssuranceShell";

export default function Page() {
  const searchParams = useSearchParams();
  const isV2 = searchParams.get("ui") === "v2" || process.env.NEXT_PUBLIC_UI_V2 === "true";
  
  if (isV2) return <AssuranceShell />;
  return <LivePage />;
}

function LivePage() {
  const [running, setRunning] = useState(true);
  const [speedMs, setSpeedMs] = useState(1500);
  const [frame, setFrame] = useState<(Telemetry & { state: string }) | null>(
    null,
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav active="live" />
      <div className="flex-1 min-h-0 flex">
        <Split
          persistKey="live.split"
          initialLeftFraction={0.32}
          left={
            <LiveSidebar
              running={running}
              setRunning={setRunning}
              speedMs={speedMs}
              setSpeedMs={setSpeedMs}
              frame={frame}
            />
          }
          right={
            <A2UIProvider catalog={catalog}>
              <LiveCanvas
                running={running}
                speedMs={speedMs}
                onFrame={setFrame}
              />
            </A2UIProvider>
          }
        />
      </div>
    </div>
  );
}

function LiveCanvas({
  running,
  speedMs,
  onFrame,
}: {
  running: boolean;
  speedMs: number;
  onFrame: (f: Telemetry & { state: string }) => void;
}) {
  const actions = useA2UIActions();
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const createdRef = useRef(false);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const telemetry: Telemetry = await fetch(
          `${ROBOT_API}/robot/frame`,
        ).then((r) => r.json());
        const res: { state: string; a2ui_operations: A2UIOp[] } = await fetch(
          `${ROBOT_API}/robot/render`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(telemetry),
          },
        ).then((r) => r.json());
        if (cancelled) return;

        let ops = res.a2ui_operations ?? [];
        if (!createdRef.current) {
          const cs = ops.find((o) => "createSurface" in o);
          const sid = (
            cs?.createSurface as { surfaceId?: string } | undefined
          )?.surfaceId;
          if (sid) setSurfaceId(sid);
          createdRef.current = true;
        } else {
          // The surface already exists — re-rendering only needs the new
          // data model. Re-sending createSurface throws; updateComponents is
          // redundant. Keep just the updateDataModel op.
          ops = ops.filter((o) => "updateDataModel" in o);
        }
        try {
          actions.processMessages(ops as never);
        } catch (err) {
          console.warn("[live] processMessages threw", err);
        }
        onFrameRef.current({ ...telemetry, state: res.state });
      } catch (err) {
        console.warn("[live] frame fetch failed", err);
      }
      if (!cancelled) timer = setTimeout(tick, speedMs);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, speedMs, actions]);

  if (!surfaceId) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <div className="max-w-sm flex flex-col items-center gap-3">
          <div className="relative inline-flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--mint)] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--mint)]" />
          </div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--ink)]">
            Connecting to robot telemetry…
          </h2>
          <p className="text-[14px] text-[var(--ink-2)] leading-relaxed">
            Streaming live frames from {ROBOT_API}. The dashboard re-renders
            itself as the robot&apos;s NeSyConf moves between cognitive states.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="a2ui-surface p-6 md:p-8">
        <A2UIRenderer surfaceId={surfaceId} />
      </div>
    </div>
  );
}

function LiveSidebar({
  running,
  setRunning,
  speedMs,
  setSpeedMs,
  frame,
}: {
  running: boolean;
  setRunning: (v: boolean) => void;
  speedMs: number;
  setSpeedMs: (v: number) => void;
  frame: (Telemetry & { state: string }) | null;
}) {
  const meta =
    (frame && STATE_META[frame.state]) ?? STATE_META.autonomous;
  const conf = frame?.nesy_conf ?? 0;

  const Gauge = useCallback(
    ({ label, value }: { label: string; value: number }) => (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
            {label}
          </span>
          <span className="text-[12.5px] font-semibold text-[var(--ink)]">
            {(value * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(0, Math.min(100, value * 100))}%`,
              background:
                value >= 0.75
                  ? "var(--mint)"
                  : value >= 0.5
                    ? "#f59e0b"
                    : "#ef4444",
            }}
          />
        </div>
      </div>
    ),
    [],
  );

  return (
    <div className="h-full flex flex-col gap-5 p-5 overflow-y-auto">
      <div className="flex items-center gap-2">
        <span className="relative inline-flex h-2.5 w-2.5">
          {running && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#ef4444] opacity-75 animate-ping" />
          )}
          <span
            className="relative inline-flex rounded-full h-2.5 w-2.5"
            style={{ background: running ? "#ef4444" : "var(--ink-2)" }}
          />
        </span>
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
          {running ? "Live telemetry" : "Paused"}
        </span>
      </div>

      <div
        className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: meta.bg }}
      >
        <span
          className="mono text-[10.5px] uppercase tracking-[0.16em] font-semibold w-fit px-2 py-0.5 rounded-full"
          style={{ color: meta.color, border: `1px solid ${meta.color}` }}
        >
          {meta.label}
        </span>
        <div className="flex items-baseline gap-2">
          <span
            className="text-[40px] font-semibold tracking-tight leading-none tabular-nums"
            style={{ color: meta.color }}
          >
            {(conf * 100).toFixed(1)}
          </span>
          <span className="text-[16px] font-medium" style={{ color: meta.color }}>
            %
          </span>
        </div>
        <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
          NeSyConf · fused confidence
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Gauge label="Perception" value={frame?.perception_confidence ?? 0} />
        <Gauge label="Plan certainty" value={frame?.plan_certainty ?? 0} />
        <Gauge label="Task success" value={frame?.task_success_rate ?? 0} />
        <Gauge label="System uncertainty" value={frame?.system_uncertainty ?? 0} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <Stat label="Episode" value={frame ? String(frame.episode) : "—"} />
        <Stat label="Phase" value={frame?.phase ?? "—"} />
        <Stat label="Action" value={frame?.current_action ?? "—"} />
        <Stat
          label="Blocks"
          value={frame ? String(frame.blocks_detected) : "—"}
        />
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setRunning(!running)}
          className="w-full rounded-xl px-4 py-2.5 text-[13.5px] font-medium border border-[var(--line)] hover:bg-[color-mix(in oklab,var(--lilac) 8%,var(--surface))] transition-colors"
        >
          {running ? "Pause feed" : "Resume feed"}
        </button>
        <div className="flex items-center gap-2">
          <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
            Speed
          </span>
          <div className="flex gap-1 ml-auto">
            {SPEEDS.map((s) => (
              <button
                key={s.ms}
                type="button"
                onClick={() => setSpeedMs(s.ms)}
                className={`mono text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  speedMs === s.ms
                    ? "border-[var(--ink)] bg-[color-mix(in oklab,var(--lilac) 8%,var(--surface))] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-2)] hover:bg-[color-mix(in oklab,var(--lilac) 8%,var(--surface))]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--ink-2)]">
          Deterministic render — no LLM in the loop. Each frame re-renders in
          ~100ms as the robot streams telemetry.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] px-3 py-2 flex flex-col gap-0.5">
      <span className="mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
        {label}
      </span>
      <span className="text-[13px] font-medium text-[var(--ink)] truncate">
        {value}
      </span>
    </div>
  );
}
