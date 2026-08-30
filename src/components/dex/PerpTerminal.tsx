"use client";

import { useEffect, useState } from "react";
import { ExternalLink, EyeOff, ShieldCheck } from "lucide-react";
import { MARK_BASE, MARK_QUOTE, MG, readEnginePrice } from "@/utils/marginguard";
import { USDC_DECIMALS, formatUnits } from "./perpPackets";
import PerpOrderEntry from "./PerpOrderEntry";
import PerpDataPanel from "./PerpDataPanel";
import TradeChart from "./TradeChart";
import styles from "@/app/terminal.module.css";

const CONTRACT = "https://voyager.online/contract/";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "long" | "short" }) {
  const color = tone === "long" ? styles.statCyan : tone === "short" ? styles.statPurple : "";
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.tnum} ${styles.statValue} ${color}`}>{value}</span>
    </div>
  );
}

export function PerpTerminal() {
  const [enginePrice, setEnginePrice] = useState<bigint | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => readEnginePrice(MARK_BASE, MARK_QUOTE)
      .then((p) => { if (active) setEnginePrice(p); })
      .catch(() => {});
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const markText = enginePrice ? `$${formatUnits(enginePrice, USDC_DECIMALS, 5)}` : "-";
  // The chart takes a plain number; the engine scale is quote-smallest per base-smallest.
  const markNumber = enginePrice ? Number(enginePrice) / 10 ** USDC_DECIMALS : 0;

  return (
    <>
      <div className={styles.marketBar}>
        <div className={styles.marketSelect}>
          <div className={styles.marketButton}>
            <span className={styles.marketSymbol}>STRK-PERP</span>
            <span className={styles.privateFlag}>PRIVATE</span>
          </div>
        </div>

        <div className={styles.marketDivider} />

        <div className={styles.statStrip}>
          <Stat label="Mark Price" value={markText} tone="long" />
          <Stat label="Oracle Price" value={markText} />
          <Stat label="Max Leverage" value="10x" />
          <Stat label="Maintenance" value="50%" tone="short" />
          <Stat label="Open Interest" value="Not enumerable" />
        </div>
      </div>

      <div className={styles.tradeGrid}>
        {/* Left: chart over the positions panel, matching the spot terminal. */}
        <div className={`${styles.mainColumn} ${styles.borderRight}`}>
          <TradeChart market="STRK/USDC" mark={markNumber} />
          <PerpDataPanel mark={enginePrice} />
        </div>

        {/* Middle: no order book by design. Perp positions are commitments, not resting
            orders, so there is no depth to display - the engine's verified risk terms go
            here instead of a book that would have to be fabricated. */}
        <section className={styles.panel} style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div className={styles.panelHeader}>
            <span>Engine &amp; risk</span>
            <span className={styles.subtleTag}>VERIFIED</span>
          </div>

          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            <div className={styles.collateralRow}><span>Leverage tiers</span><span className={styles.collateralValue}>2x &nbsp;5x &nbsp;10x</span></div>
            <div className={styles.collateralRow}><span>Maintenance margin</span><span className={styles.collateralValue}>50%</span></div>
            <div className={styles.collateralRow}><span>Settlement</span><span className={styles.collateralValue}>USDC</span></div>
            <div className={styles.collateralRow}><span>Position economics</span><span className={styles.collateralValue}><EyeOff size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />shielded</span></div>
          </div>

          <div className={styles.panelHeader} style={{ marginTop: 6 }}>
            <span>Agent risk layer</span>
            <ShieldCheck size={14} className={styles.statCyan} />
          </div>
          <div style={{ padding: "8px 12px", fontSize: 11, lineHeight: 1.55, color: "rgba(255,255,255,0.55)" }}>
            The registered agent proposes a bounded adjustment. PerpEngine verifies the signature,
            policy, nonce and committed position before any of it is enforced.
          </div>
          <div style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            <div className={styles.collateralRow}><span>Max margin increase</span><span className={styles.collateralValue}>50%</span></div>
            <div className={styles.collateralRow}><span>Max size reduction</span><span className={styles.collateralValue}>30%</span></div>
            <div className={styles.collateralRow}><span>May close</span><span className={styles.collateralValue}>Yes</span></div>
          </div>

          <div style={{ padding: "12px", marginTop: "auto", display: "flex", flexDirection: "column", gap: 7 }}>
            <a className={styles.contractLink} href={`${CONTRACT}${MG.perpEngine}`} target="_blank" rel="noreferrer">
              View PerpEngine <ExternalLink size={12} />
            </a>
            <a className={styles.contractLink} href={`${CONTRACT}${MG.agentRegistry}`} target="_blank" rel="noreferrer">
              View AgentRegistry <ExternalLink size={12} />
            </a>
          </div>
        </section>

        {/* Right: order entry */}
        <PerpOrderEntry enginePrice={enginePrice} />
      </div>
    </>
  );
}

export default PerpTerminal;
