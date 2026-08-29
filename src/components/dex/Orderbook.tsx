"use client";

import { useMemo } from "react";
import { ArrowUp } from "lucide-react";
import { buildBook, fmtPrice } from "./data";

const nf = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Vertical orderbook: asks above, spread/mark in the middle, bids below, with depth bars. */
export function Orderbook({ mark }: { mark: number }) {
  const { asks, bids, maxTotal } = useMemo(() => buildBook(mark || 1), [mark]);
  const spread = asks.length && bids.length ? asks[asks.length - 1].price - bids[0].price : 0;
  const spreadPct = mark ? (spread / mark) * 100 : 0;

  const Row = ({
    price,
    size,
    total,
    side,
  }: {
    price: number;
    size: number;
    total: number;
    side: "ask" | "bid";
  }) => (
    <div className="relative grid h-[22px] grid-cols-[1fr_1fr_1fr] items-center px-3 text-[11.5px]">
      <div
        className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-[#9d4edd]/12" : "bg-[#00e5ff]/12"}`}
        style={{ width: `${Math.min(100, (total / maxTotal) * 100)}%` }}
      />
      <span className={`tnum relative z-10 ${side === "ask" ? "text-[#9d4edd]" : "text-[#00e5ff]"}`}>
        {fmtPrice(price)}
      </span>
      <span className="tnum relative z-10 text-right text-white/70">{nf(size)}</span>
      <span className="tnum relative z-10 text-right text-white/35">{nf(total)}</span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col border-r border-white/10 bg-[#121319]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <span className="text-[12px] font-semibold text-white/70">Orderbook</span>
        <span className="rounded bg-[#9d4edd]/12 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#9d4edd]">
          DARK
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_1fr_1fr] px-3 py-1.5 text-[10px] uppercase tracking-[0.06em] text-white/30">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        {asks.map((l, i) => (
          <Row key={`a${i}`} {...l} side="ask" />
        ))}
      </div>

      {/* Spread / mark */}
      <div className="flex shrink-0 items-center justify-between border-y border-white/10 bg-[#18191e] px-3 py-2">
        <span className="tnum flex items-center gap-1 text-[15px] font-bold text-[#00e5ff]">
          <ArrowUp className="size-3.5" />
          {fmtPrice(mark)}
        </span>
        <span className="tnum text-[10.5px] text-white/35">
          spread {spreadPct.toFixed(3)}%
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {bids.map((l, i) => (
          <Row key={`b${i}`} {...l} side="bid" />
        ))}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 py-2 text-[10px] leading-relaxed text-white/30">
        Depth shown is aggregate. Individual resting orders stay hidden until matched.
      </div>
    </div>
  );
}

export default Orderbook;
