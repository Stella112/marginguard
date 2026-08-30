"use client";

import { useEffect, useMemo, useState } from "react";
import { CandlestickChart, Maximize2 } from "lucide-react";
import { fmtPrice } from "./data";
import styles from "@/app/terminal.module.css";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;

export function TradeChart({ market, mark }: { market: string; mark: number }) {
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const [prices, setPrices] = useState<number[]>([]);
  const asset = market.split(/[\/-]/)[0];
  useEffect(() => {
    let active = true;
    setPrices([]);
    fetch(`/api/market?asset=${asset}`).then((response) => response.ok ? response.json() : Promise.reject()).then((data: { prices?: [number, number][] }) => { if (active) setPrices((data.prices ?? []).map(([, value]) => value)); }).catch(() => { if (active) setPrices([]); });
    return () => { active = false; };
  }, [asset]);
  const candles = useMemo(() => {
    const values = prices.length ? prices : mark > 0 ? [mark] : [];
    return values.slice(-72).map((close, index, list) => {
      const previous = list[index - 1] ?? close;
      const high = Math.max(previous, close);
      const low = Math.min(previous, close);
      return { o: previous, c: close, h: high, l: low, t: index };
    });
  }, [prices, mark]);
  const W = 1000;
  const H = 340;
  const padY = 16;
  const lo = candles.length ? Math.min(...candles.map((c) => c.l)) : 0;
  const hi = candles.length ? Math.max(...candles.map((c) => c.h)) : 1;
  const y = (p: number) => padY + (1 - (p - lo) / (hi - lo || 1)) * (H - padY * 2);
  const cw = W / Math.max(candles.length, 1);
  const ticks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) / 5) * i).reverse();

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
          <span>O {fmtPrice(candles[0]?.o ?? 0)}</span>
          <span>H {fmtPrice(hi)}</span>
          <span>L {fmtPrice(lo)}</span>
          <span className={styles.ohlcClose}>C {fmtPrice(mark)}</span>
        </div>
        <Maximize2 size={14} className={styles.headerIcon} />
      </div>
      <div className={styles.chartBody}>
        {candles.length ? <svg className={styles.chartSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-label={`${market} live market chart`}>
          {ticks.map((t, i) => <line key={i} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.055)" />)}
          {candles.map((d, i) => {
            const x = i * cw + cw / 2;
            const up = d.c >= d.o;
            const color = up ? "#00e5ff" : "#9d4edd";
            const top = Math.min(y(d.o), y(d.c));
            const height = Math.max(1.5, Math.abs(y(d.o) - y(d.c)));
            return <g key={i}><line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={color} opacity=".8" /><rect x={x - cw * .28} width={cw * .56} y={top} height={height} fill={color} /></g>;
          })}
          <line x1={0} x2={W} y1={y(mark)} y2={y(mark)} stroke="#00e5ff" strokeDasharray="4 4" opacity=".7" />
        </svg> : <div className={styles.chartCaption}>Live market history unavailable. Oracle mark remains the only verified price source.</div>}
        <div className={styles.priceLadder}>{ticks.map((t, i) => <span key={i} className={styles.tnum}>{fmtPrice(t)}</span>)}</div>
        {candles.length ? <div className={styles.chartCaption}>Public market history · {tf} · chart feed</div> : null}
      </div>
    </section>
  );
}

export default TradeChart;
