"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Lock, LockOpen, KeyRound, CheckCircle2, XCircle } from "lucide-react";
import { POSITIONS, ORDERS, AGENT_LOGS, fmtUsd } from "./data";

type Tab = "positions" | "orders" | "logs";

/** A value hidden behind the viewing key: blurred + locked until access is granted. */
function Shielded({ value, unlocked }: { value: string; unlocked: boolean }) {
  if (unlocked) return <span className="tnum text-white/85">{value}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tnum select-none text-white/85 blur-[5px]" aria-hidden>
        {value}
      </span>
      <Lock className="size-3 shrink-0 text-[#9d4edd]" />
    </span>
  );
}

const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th
    className={`px-3 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-white/30 ${
      right ? "text-right" : "text-left"
    }`}
  >
    {children}
  </th>
);

export function DataPanel() {
  const [tab, setTab] = useState<Tab>("positions");
  const [unlocked, setUnlocked] = useState(false);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "positions", label: "Positions", count: POSITIONS.length },
    { id: "orders", label: "Orders", count: ORDERS.length },
    { id: "logs", label: "Agent Logs", count: AGENT_LOGS.length },
  ];

  return (
    <div className="flex min-h-0 flex-col bg-[#121319]">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === t.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/75"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="tnum rounded bg-white/10 px-1 text-[10px] text-white/50">{t.count}</span>
            )}
          </button>
        ))}

        <div className="flex-1" />

        {tab === "positions" && (
          <button
            onClick={() => setUnlocked((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              unlocked
                ? "border-[#00e5ff]/40 bg-[#00e5ff]/10 text-[#00e5ff]"
                : "border-[#9d4edd]/40 bg-[#9d4edd]/10 text-[#9d4edd] hover:bg-[#9d4edd]/20"
            }`}
          >
            {unlocked ? <LockOpen className="size-3" /> : <KeyRound className="size-3" />}
            {unlocked ? "Viewing Key Granted" : "Unlock Viewing Key"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#121319]">
              <tr className="border-b border-white/10">
                <TH>Market</TH>
                <TH>Side</TH>
                <TH right>Size</TH>
                <TH right>Entry Price</TH>
                <TH right>Mark</TH>
                <TH right>Liq. Price</TH>
                <TH right>PnL</TH>
                <TH right>Lev</TH>
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((p) => (
                <tr key={p.market} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 text-[12.5px] font-semibold text-white">{p.market}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{
                        color: p.side === "LONG" ? "#00e5ff" : "#9d4edd",
                        background: p.side === "LONG" ? "#00e5ff14" : "#9d4edd14",
                      }}
                    >
                      {p.side}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-[12.5px]">
                    <Shielded value={p.size} unlocked={unlocked} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-[12.5px]">
                    <Shielded value={p.entry} unlocked={unlocked} />
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/70">{p.mark}</td>
                  <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/45">{p.liq}</td>
                  <td className="tnum px-3 py-2.5 text-right text-[12.5px] font-semibold text-[#00e5ff]">
                    +{fmtUsd(p.pnl)}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/60">{p.lev}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "positions" && (
          <motion.div
            key={String(unlocked)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-white/35"
          >
            <Lock className="size-3 text-[#9d4edd]" />
            {unlocked
              ? "Viewing key granted to the registered risk agent — scoped to these positions, revocable at any time."
              : "Size and entry are shielded from the public and other traders. Grant a scoped viewing key to let your risk agent read them."}
          </motion.div>
        )}

        {tab === "orders" && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#121319]">
              <tr className="border-b border-white/10">
                <TH>Market</TH>
                <TH>Type</TH>
                <TH>Side</TH>
                <TH right>Size</TH>
                <TH right>Price</TH>
                <TH right>Status</TH>
              </tr>
            </thead>
            <tbody>
              {ORDERS.map((o, i) => (
                <tr key={i} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 text-[12.5px] font-semibold text-white">{o.market}</td>
                  <td className="px-3 py-2.5 text-[12px] text-white/60">{o.type}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: o.side === "BUY" ? "#00e5ff" : "#9d4edd" }}
                    >
                      {o.side}
                    </span>
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/75">{o.size}</td>
                  <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/75">{o.price}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="rounded bg-[#9d4edd]/12 px-1.5 py-0.5 text-[10px] font-bold text-[#9d4edd]">
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "logs" && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#121319]">
              <tr className="border-b border-white/10">
                <TH>Time</TH>
                <TH>Proposed Action</TH>
                <TH>Market</TH>
                <TH>Detail</TH>
                <TH right>Contract Verdict</TH>
              </tr>
            </thead>
            <tbody>
              {AGENT_LOGS.map((l, i) => (
                <tr key={i} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  <td className="tnum px-3 py-2.5 text-[12px] text-white/45">{l.time}</td>
                  <td className="px-3 py-2.5 text-[12px] font-semibold text-white/85">{l.action}</td>
                  <td className="px-3 py-2.5 text-[12px] text-white/60">{l.market}</td>
                  <td className="px-3 py-2.5 text-[12px] text-white/45">{l.detail}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                        l.verdict === "VERIFIED" ? "text-[#00e5ff]" : "text-[#9d4edd]"
                      }`}
                    >
                      {l.verdict === "VERIFIED" ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <XCircle className="size-3" />
                      )}
                      {l.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default DataPanel;
