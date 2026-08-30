"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, EyeOff, Search, ShieldCheck } from "lucide-react";
import { MG, readMarkPriceFor, readPosition, type PositionView } from "@/utils/marginguard";
import PerpOrderEntry from "./PerpOrderEntry";
import { fmtPrice } from "./data";
import styles from "@/app/terminal.module.css";

const explorer = "https://voyager.online/contract/";

export function PerpTerminal() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState(0);
  const [positionId, setPositionId] = useState("");
  const [position, setPosition] = useState<PositionView | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0, left: 0 });
    readMarkPriceFor(MG_MARK_BASE).then(setMark).catch(() => {});
  }, []);

  async function lookup() {
    if (!positionId.trim()) return;
    setLoading(true);
    setLookupError("");
    try {
      setPosition(await readPosition(positionId.trim()));
    } catch (error: any) {
      setPosition(null);
      setLookupError(error?.message ?? "Position lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={pageRef} className={styles.perpPage}>
      <div className={styles.perpHero}>
        <div>
          <span className={styles.perpKicker}>PRIVATE PERPETUALS</span>
          <h1>PerpEngine</h1>
          <p>Leveraged positions remain commitments until an owner, keeper, or registered agent presents the matching reveal.</p>
        </div>
        <span className={styles.perpStatus}><span className={styles.networkDot} />MAINNET CONTRACT DEPLOYED</span>
      </div>

      <div className={styles.perpGrid}>
        <section className={styles.perpCard}>
          <div className={styles.panelHeader}><span>STRK-PERP</span><span className={styles.subtleTag}>PRIVATE</span></div>
          <div className={styles.perpMetric}><span>Verified oracle mark</span><strong className={`${styles.tnum} ${styles.statCyan}`}>{fmtPrice(mark)}</strong></div>
          <div className={styles.perpMetric}><span>Leverage tiers</span><strong className={styles.tnum}>2x&nbsp;&nbsp;5x&nbsp;&nbsp;10x</strong></div>
          <div className={styles.perpMetric}><span>Position economics</span><strong><EyeOff size={14} /> shielded</strong></div>
          <a className={styles.contractLink} href={`${explorer}${MG.perpEngine}`} target="_blank" rel="noreferrer">View PerpEngine <ExternalLink size={12} /></a>
        </section>

        <section className={styles.perpCard}>
          <div className={styles.panelHeader}><span>Agent risk layer</span><ShieldCheck size={15} className={styles.statCyan} /></div>
          <div className={styles.perpCopy}>The registered agent proposes a bounded adjustment. PerpEngine verifies the signature, policy, nonce, and committed position before enforcement.</div>
          <div className={styles.riskRows}><span>Max margin increase <b>50%</b></span><span>Max size reduction <b>30%</b></span><span>May close <b>Yes</b></span></div>
          <a className={styles.contractLink} href={`${explorer}${MG.agentRegistry}`} target="_blank" rel="noreferrer">View AgentRegistry <ExternalLink size={12} /></a>
        </section>

        <section className={styles.perpCard}>
          <div className={styles.panelHeader}><span>Position lookup</span><Search size={14} /></div>
          <div className={styles.lookupRow}>
            <input value={positionId} onChange={(event) => setPositionId(event.target.value)} placeholder="0x… position id" aria-label="Position id" />
            <button onClick={lookup} disabled={loading || !positionId.trim()}>{loading ? "Reading" : "Look up"}</button>
          </div>
          {lookupError && <p className={styles.errorText}>{lookupError}</p>}
          {position && <div className={styles.positionResult}>
            <span>Status <b>{position.open ? "OPEN" : position.liquidated ? "LIQUIDATED" : position.exists ? "CLOSED" : "NOT FOUND"}</b></span>
            <span>Commitment <b className={styles.tnum}>{position.exists ? `${position.commitment.slice(0, 10)}…${position.commitment.slice(-6)}` : "—"}</b></span>
          </div>}
          {!position && !lookupError && <div className={styles.emptyPerp}>No position loaded. Position values are not enumerable from public state.</div>}
        </section>

        <PerpOrderEntry />
      </div>
    </div>
  );
}

const MG_MARK_BASE = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export default PerpTerminal;
