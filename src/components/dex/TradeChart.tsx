"use client";

import { useMemo, useState } from "react";
import { CandlestickChart, Maximize2 } from "lucide-react";
import { buildCandles, fmtPrice } from "./data";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;

/** Mock TradingView-style candlestick panel with a timeframe toolbar. */
export function TradeChart({ market, mark }: { market: string; mark: number }) {
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const candles = useMemo(() => buildCandles(mark || 1, 90), [mark]);

  const W = 1000;
  const H = 340;
  const padY = 16;
  const lo = Math.min(...candles.map((c) => c.l));
  const hi = Math.max(...candles.map((c) => c.h));
  const y = (p: number) => padY + (1 - (p - lo) / (hi - lo || 1)) * (H - padY * 2);
  const cw = W / candles.length;

  // Right-hand price ladder
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) / 4) * i).reverse();

  return (
    <div className="flex min-h-0 flex-col border-b border-white/10 bg-[#121319]">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <CandlestickChart className="size-3.5 text-white/35" />
        <span className="text-[12px] font-semibold text-white/70">{market}</span>
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`tnum rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
                tf === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/75"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="tnum text-[11px] text-white/30">O {fmtPrice(candles[0]?.o ?? 0)}</span>
        <span className="tnum text-[11px] text-white/30">H {fmtPrice(hi)}</span>
        <span className="tnum text-[11px] text-white/30">L {fmtPrice(lo)}</span>
        <span className="tnum text-[11px] text-[#00e5ff]">C {fmtPrice(mark)}</span>
        <Maximize2 className="size-3.5 text-white/25" />
      </div>

      {/* Chart body */}
      <div className="relative min-h-0 flex-1">
        <svg
          className="size-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
        >
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={0}
              x2={W}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}
          {candles.map((d, i) => {
            const x = i * cw + cw / 2;
            const up = d.c >= d.o;
            const col = up ? "#00e5ff" : "#9d4edd";
            const top = Math.min(y(d.o), y(d.c));
            const h = Math.max(1.5, Math.abs(y(d.o) - y(d.c)));
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={col} strokeWidth={1} opacity={0.75} />
                <rect x={x - cw * 0.3} width={cw * 0.6} y={top} height={h} fill={col} />
              </g>
            );
          })}
          {/* Mark line */}
          <line
            x1={0}
            x2={W}
            y1={y(mark)}
            y2={y(mark)}
            stroke="#00e5ff"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.6}
          />
        </svg>

        {/* Price ladder */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-16 flex-col justify-between border-l border-white/10 bg-[#121319]/85 py-3 pl-2">
          {ticks.map((t, i) => (
            <span key={i} className="tnum text-[10px] text-white/35">
              {fmtPrice(t)}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-white/25">
          No public trade tape — resting orders are shielded commitments.
        </div>
      </div>
    </div>
  );
}

export default TradeChart;
