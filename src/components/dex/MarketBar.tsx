"use client";

import { useState } from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import { MARKETS, fmtPrice } from "./data";
import styles from "@/app/terminal.module.css";

type Props = {
  market: string;
  onMarket: (s: string) => void;
  mark: number;
  oracle: number;
  priceSource: string;
  oracleVerified: boolean;
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
  const color = tone === "long" ? styles.statCyan : tone === "short" ? styles.statPurple : tone === "muted" ? styles.statMuted : "";
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.tnum} ${styles.statValue} ${color}`}>
        {icon}
        {value}
      </span>
    </div>
  );
}

export function MarketBar({ market, onMarket, mark, oracle, priceSource, oracleVerified }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.marketBar}>
      {/* Market selector */}
      <div className={styles.marketSelect}>
        <button
          onClick={() => setOpen((v) => !v)}
          className={styles.marketButton}
        >
          <span className={styles.marketSymbol}>{market}</span>
          <span className={styles.privateFlag}>
            PRIVATE
          </span>
          <ChevronDown size={14} className={styles.headerIcon} />
        </button>
        {open && (
          <div className={styles.marketMenu}>
            {MARKETS.map((m) => (
              <button
                key={m.symbol}
                onClick={() => {
                  onMarket(m.symbol);
                  setOpen(false);
                }}
                className={`${styles.marketOption} ${m.symbol === market ? styles.marketOptionSelected : ""}`}
              >
                <span className={styles.marketSymbol}>{m.symbol}</span>
                <span className={styles.tnum}>{m.maxLev}x</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.marketDivider} />

      <div className={styles.statStrip}>
        <Stat label="Mark Price" value={fmtPrice(mark)} tone="long" />
        <Stat label={oracleVerified ? "Oracle Price" : "Reference Price"} value={fmtPrice(oracle)} />
        <Stat label="24h Change" value="—" tone="muted" />
        <Stat label="Funding" value="N/A" tone="muted" />
        <Stat label="Shielded liquidity" value="private" tone="muted" icon={<EyeOff size={12} />} />
      </div>

      <div className={styles.oracle}>
        <span className={styles.networkDot} />
        {priceSource}
      </div>
    </div>
  );
}

export default MarketBar;
