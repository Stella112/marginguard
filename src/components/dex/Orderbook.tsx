"use client";

import { EyeOff } from "lucide-react";
import { fmtPrice } from "./data";
import styles from "@/app/terminal.module.css";

const nf = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function Orderbook({ mark }: { mark: number }) {
  return (
    <section className={styles.orderbook}>
      <div className={styles.panelHeader}><span>Private match queue</span><span className={styles.subtleTag}>COMMITMENTS</span></div>
      <div className={styles.bookHead}><span>Price</span><span>Size</span><span>Total</span></div>
      <div className={styles.bookHalf}><div className={styles.privateEmpty}><EyeOff size={16} /><strong>No public levels</strong><span>Individual orders are commitments. Price and size are revealed only when a match is verified.</span></div></div>
      <div className={styles.markRow}><span className={`${styles.tnum} ${styles.markValue}`}>{mark ? fmtPrice(mark) : "—"}</span><span className={`${styles.tnum} ${styles.spread}`}>oracle mark</span></div>
      <div className={styles.bookHalf}><div className={styles.privateEmpty}><span className={styles.tnum}>LIVE=1 · MATCHED=0</span><span>Waiting for a counterparty commitment.</span></div></div>
      <div className={styles.bookFooter}><EyeOff size={12} style={{ verticalAlign: "-2px", marginRight: 5 }} />Spot dark-pool orders stay private until two reveal packets are matched.</div>
    </section>
  );
}

export default Orderbook;
