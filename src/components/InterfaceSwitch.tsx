import Link from "next/link";

/**
 * Interface switcher — toggles between the classic A2UI shell (hackathon UI)
 * and the assurance shell (UI v2 + fleet). Mounted from both navs so either
 * interface can reach the other in one click.
 */
export function InterfaceSwitch({
  target,
}: {
  target: "assurance" | "classic";
}) {
  if (target === "assurance") {
    return (
      <Link
        href="/live?ui=v2&fleet=1"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition bg-[var(--ink)] text-white hover:opacity-85"
        title="Open the assurance shell (replay telemetry, contract, fleet)"
      >
        Assurance UI <span aria-hidden>→</span>
      </Link>
    );
  }
  return (
    <Link
      href="/live"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition border border-[var(--line,#d8d8e0)] text-[#5f6470] hover:text-[#1d1d1f] hover:bg-black/5"
      title="Back to the classic A2UI interface"
    >
      <span aria-hidden>←</span> Classic UI
    </Link>
  );
}
