"use client";

import { useEffect, useMemo, useState } from "react";
import { CandlestickChart, Maximize2 } from "lucide-react";
import { fmtPrice } from "./data";
import styles from "@/app/terminal.module.css";

/** No 1m: the public feed's finest resolution is 5 minutes, so it could only repeat 5m. */
const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D", "1W"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type Candle = { t: number; o: number; h: number; l: number; c: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Axis labels are chosen from the window the candles actually span, not from the
 * timeframe name. 4h candles cover a month, so a clock-only label repeats the same
 * few hours and hides the date entirely.
 */
function axisLabel(ts: number, spanMs: number) {
  const date = new Date(ts);
  const time = () => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = () => date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (spanMs <= 2 * DAY_MS) return time();
  if (spanMs <= 14 * DAY_MS) return `${day()} ${time()}`;
  if (spanMs <= 200 * DAY_MS) return day();
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function TradeChart({ market, mark }: { market: string; mark: number }) {
  const [tf, setTf] = useState<Timeframe>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [failed, setFailed] = useState(false);
  const asset = market.split(/[\/-]/)[0];

  useEffect(() => {
    let active = true;
    setCandles([]);
    setFailed(false);
    fetch(`/api/market?asset=${asset}&tf=${tf}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { candles?: Candle[] }) => {
        if (!active) return;
        const next = data.candles ?? [];
        setCandles(next);
        setFailed(next.length === 0);
      })
      .catch(() => { if (active) { setCandles([]); setFailed(true); } });
    return () => { active = false; };
  }, [asset, tf]);

  const W = 1000;
  const H = 340;
  const padY = 16;
  const lo = candles.length ? Math.min(...candles.map((c) => c.l)) : 0;
  const hi = candles.length ? Math.max(...candles.map((c) => c.h)) : 1;
  const y = (p: number) => padY + (1 - (p - lo) / (hi - lo || 1)) * (H - padY * 2);
  const cw = W / Math.max(candles.length, 1);
  const ticks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) / 5) * i).reverse();

  // Six evenly spaced time labels across whatever window the timeframe covers.
  const timeLabels = useMemo(() => {
    if (candles.length < 2) return [];
    const count = Math.min(6, candles.length);
    const span = candles[candles.length - 1].t - candles[0].t;
    return Array.from({ length: count }, (_, i) => {
      const index = Math.round((i * (candles.length - 1)) / (count - 1));
      return { key: index, label: axisLabel(candles[index].t, span) };
    });
  }, [candles]);

  const first = candles[0];
  const last = candles.at(-1);

  return (
    <section className={`${styles.chart} ${styles.borderBottom}`}>
      <div className={styles.chartToolbar}>
        <CandlestickChart size={14} className={styles.headerIcon} />
        <span className={styles.chartName}>{market}</span>
        {TIMEFRAMES.map((t) => (
          <button key={t} onClick={() => setTf(t)} className={`${styles.timeframe} ${tf === t ? styles.timeframeActive : ""}`}>
            {t}
          </button>
        ))}
        <div className={styles.ohlc}>
          <span>O {fmtPrice(first?.o ?? 0)}</span>
          <span>H {fmtPrice(hi)}</span>
          <span>L {fmtPrice(lo)}</span>
          <span className={styles.ohlcClose}>C {fmtPrice(last?.c ?? mark)}</span>
        </div>
        <Maximize2 size={14} className={styles.headerIcon} />
      </div>

      <div className={styles.chartBody}>
        {candles.length ? (
          <svg
            className={styles.chartSvg}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            shapeRendering="crispEdges"
            aria-label={`${market} market chart, ${tf} candles`}
          >
            {ticks.map((t, i) => <line key={i} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.055)" />)}
            {candles.map((d, i) => {
              const x = i * cw + cw / 2;
              const up = d.c >= d.o;
              const color = up ? "#00e5ff" : "#9d4edd";
              const top = Math.min(y(d.o), y(d.c));
              const height = Math.max(1.5, Math.abs(y(d.o) - y(d.c)));
              return (
                <g key={d.t}>
                  <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={color} opacity=".8" />
                  <rect x={x - cw * .28} width={cw * .56} y={top} height={height} fill={color} />
                </g>
              );
            })}
            {/* The oracle mark, which is a different source from the chart feed. */}
            {mark > 0 && <line x1={0} x2={W} y1={y(mark)} y2={y(mark)} stroke="#00e5ff" strokeDasharray="4 4" opacity=".7" />}
          </svg>
        ) : (
          <div className={styles.chartCaption}>
            {failed
              ? "Live market history unavailable. Oracle mark remains the only verified price source."
              : "Loading market history"}
          </div>
        )}

        <div className={styles.priceLadder}>{ticks.map((t, i) => <span key={i} className={styles.tnum}>{fmtPrice(t)}</span>)}</div>

        {candles.length ? (
          <>
            <div className={styles.timeAxis}>
              {timeLabels.map((item) => <span key={item.key} className={styles.tnum}>{item.label}</span>)}
            </div>
            <div className={styles.chartCaption}>
              Public market history · {tf} candles · {candles.length} bars
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export default TradeChart;
