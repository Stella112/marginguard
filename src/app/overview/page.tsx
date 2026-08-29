"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Lock, ShieldCheck, TrendingUp, Wallet, AlertTriangle } from "lucide-react";
import AppShell from "@/components/dex/AppShell";
import { POSITIONS, SPOT_BALANCES, fmtUsd } from "@/components/dex/data";

const NET_SHIELDED = 36495.87;
const FREE_COLLATERAL = 18420.55;
const INITIAL_MARGIN = 9317.42;

const ALLOC = [
  { name: "USDC (shielded)", value: 24180.55, color: "#00e5ff" },
  { name: "ETH (shielded)", value: 7778.47, color: "#9d4edd" },
  { name: "STRK (shielded)", value: 4536.85, color: "#3b82f6" },
  { name: "Perp liabilities", value: 9317.42, color: "#f6465d" },
];

function Metric({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-white/10 bg-[#121319] p-4"
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 place-items-center rounded-md"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </span>
        <span className="text-[11px] uppercase tracking-[0.07em] text-white/40">{label}</span>
      </div>
      <div className="tnum mt-3 text-[26px] font-bold leading-none text-white">{value}</div>
      <div className="mt-2 text-[11.5px] text-white/35">{sub}</div>
    </motion.div>
  );
}

function Toggle({
  on,
  onChange,
  title,
  desc,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] py-3 last:border-b-0">
      <div>
        <div className="text-[12.5px] font-semibold text-white/85">{title}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-white/35">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!on)}
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: on ? "#00e5ff" : "rgba(255,255,255,0.14)" }}
        aria-pressed={on}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="absolute top-0.5 size-4 rounded-full bg-[#0a0a0b]"
          style={{ left: on ? 18 : 2 }}
        />
      </button>
    </div>
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

export default function OverviewPage() {
  const [autoMargin, setAutoMargin] = useState(true);
  const [autoDelev, setAutoDelev] = useState(false);

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1400px] p-4">
          {/* Metrics */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Metric
              icon={<Lock className="size-3.5" />}
              label="Net Shielded Value"
              value={fmtUsd(NET_SHIELDED)}
              sub="Total shielded assets less perp liabilities"
              accent="#00e5ff"
            />
            <Metric
              icon={<Wallet className="size-3.5" />}
              label="Free Collateral"
              value={fmtUsd(FREE_COLLATERAL)}
              sub="Available to open new shielded positions"
              accent="#9d4edd"
            />
            <Metric
              icon={<AlertTriangle className="size-3.5" />}
              label="Initial Margin Requirement"
              value={fmtUsd(INITIAL_MARGIN)}
              sub="Maintenance threshold at 50% of initial"
              accent="#f6465d"
            />
          </div>

          {/* Split: donut + tables */}
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
            {/* Donut */}
            <div className="rounded-lg border border-white/10 bg-[#121319] p-4">
              <div className="text-[12px] font-semibold text-white/70">Shielded Allocation</div>
              <div className="mt-1 text-[11px] text-white/35">Assets vs. liabilities</div>

              <div className="relative mt-2 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ALLOC}
                      dataKey="value"
                      innerRadius={62}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {ALLOC.map((a) => (
                        <Cell key={a.name} fill={a.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#18191e",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#fff" }}
                      formatter={(v) => fmtUsd(Number(v))}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-white/35">Net</span>
                  <span className="tnum text-[17px] font-bold text-white">{fmtUsd(NET_SHIELDED, 0)}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1.5">
                {ALLOC.map((a) => (
                  <div key={a.name} className="flex items-center gap-2 text-[11.5px]">
                    <span className="size-2 rounded-sm" style={{ background: a.color }} />
                    <span className="flex-1 text-white/55">{a.name}</span>
                    <span className="tnum text-white/75">{fmtUsd(a.value, 0)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tables */}
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg border border-white/10 bg-[#121319]">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                  <span className="text-[12px] font-semibold text-white/70">Shielded Spot Balances</span>
                  <Lock className="size-3 text-[#9d4edd]" />
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-white/10">
                      <TH>Asset</TH>
                      <TH right>Balance</TH>
                      <TH right>Value</TH>
                      <TH right>APY</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {SPOT_BALANCES.map((b) => (
                      <tr key={b.asset} className="border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 text-[12.5px] font-semibold text-white">{b.asset}</td>
                        <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/75">{b.balance}</td>
                        <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/75">{fmtUsd(b.value)}</td>
                        <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-[#00e5ff]">{b.apy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-hidden rounded-lg border border-white/10 bg-[#121319]">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                  <span className="text-[12px] font-semibold text-white/70">Private Perp Positions</span>
                  <span className="rounded bg-[#9d4edd]/12 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#9d4edd]">
                    SHIELDED
                  </span>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-white/10">
                      <TH>Market</TH>
                      <TH>Side</TH>
                      <TH right>Size</TH>
                      <TH right>Entry</TH>
                      <TH right>Liq.</TH>
                      <TH right>PnL</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {POSITIONS.map((p) => (
                      <tr key={p.market} className="border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.02]">
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
                        <td className="px-3 py-2.5 text-right">
                          <span className="tnum select-none text-[12.5px] text-white/85 blur-[5px]">{p.size}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="tnum select-none text-[12.5px] text-white/85 blur-[5px]">{p.entry}</span>
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-white/45">{p.liq}</td>
                        <td className="tnum px-3 py-2.5 text-right text-[12.5px] font-semibold text-[#00e5ff]">
                          +{fmtUsd(p.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Agent risk configuration */}
              <div className="rounded-lg border border-white/10 bg-[#121319] p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-[#00e5ff]" />
                  <span className="text-[12.5px] font-semibold text-white/85">Agent Risk Configuration</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
                  The agent <span className="text-white/60">proposes</span>; the contract{" "}
                  <span className="text-white/60">verifies and enforces</span>. It signs suggestions only —
                  it holds no funds, writes no state, and can never exceed the policy you set here.
                </p>

                <div className="mt-3">
                  <Toggle
                    on={autoMargin}
                    onChange={setAutoMargin}
                    title="Enable Auto-Margin Adjustment"
                    desc="Agent may propose margin top-ups up to 50% of initial margin. Each proposal is signature- and policy-checked on-chain."
                  />
                  <Toggle
                    on={autoDelev}
                    onChange={setAutoDelev}
                    title="Enable Auto-Deleverage"
                    desc="Agent may propose size reductions up to 30% and leverage cuts. Nonce burned on execution to prevent replay."
                  />
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-[#18191e] px-3 py-2">
                  <TrendingUp className="size-3.5 text-[#9d4edd]" />
                  <span className="text-[11px] text-white/45">
                    Policy ceiling: ≤50% margin · ≤30% size cut · ≤5x leverage · close disabled
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
