"use client";

import { useState } from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import { MARKETS, fmtPrice } from "./data";

type Props = {
  market: string;
  onMarket: (s: string) => void;
  mark: number;
  oracle: number;
};

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "long" | "short" | "muted";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "long" ? "text-[#00e5ff]" : tone === "short" ? "text-[#9d4edd]" : "text-white/85";
  return (
    <div className="flex flex-col gap-0.5 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-[0.08em] text-white/35">{label}</span>
      <span className={`tnum flex items-center gap-1 text-[13px] font-semibold ${color}`}>
        {icon}
        {value}
      </span>
    </div>
  );
}

export function MarketBar({ market, onMarket, mark, oracle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-14 shrink-0 items-center gap-7 border-b border-white/10 bg-[#121319] px-4">
      {/* Market selector */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md border border-white/10 bg-[#18191e] px-3 py-2 transition-colors hover:bg-white/[0.06]"
        >
          <span className="text-[14px] font-bold tracking-tight text-white">{market}</span>
          <span className="rounded bg-[#00e5ff]/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#00e5ff]">
            PRIVATE
          </span>
          <ChevronDown className="size-3.5 text-white/40" />
        </button>
        {open && (
          <div className="absolute left-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-md border border-white/10 bg-[#18191e] shadow-2xl">
            {MARKETS.map((m) => (
              <button
                key={m.symbol}
                onClick={() => {
                  onMarket(m.symbol);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-white/[0.06] ${
                  m.symbol === market ? "text-white" : "text-white/60"
                }`}
              >
                <span className="font-semibold">{m.symbol}</span>
                <span className="tnum text-[11px] text-white/35">{m.maxLev}x</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-7 w-px bg-white/10" />

      <Stat label="Mark Price" value={fmtPrice(mark)} tone="long" />
      <Stat label="Oracle Price" value={fmtPrice(oracle)} />
      <Stat label="24h Change" value="+2.34%" tone="long" />
      <Stat label="1h Funding" value="0.0041%" tone="short" />
      <Stat
        label="Shielded Liquidity"
        value="hidden"
        tone="muted"
        icon={<EyeOff className="size-3 text-white/35" />}
      />

      <div className="flex-1" />
      <div className="hidden items-center gap-2 text-[11px] text-white/30 xl:flex">
        <span className="size-1.5 rounded-full bg-[#00e5ff]" />
        Pragma oracle · live
      </div>
    </div>
  );
}

export default MarketBar;
