"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/dex/AppShell";
import MarketBar from "@/components/dex/MarketBar";
import TradeChart from "@/components/dex/TradeChart";
import Orderbook from "@/components/dex/Orderbook";
import OrderEntry from "@/components/dex/OrderEntry";
import DataPanel from "@/components/dex/DataPanel";
import PerpTerminal from "@/components/dex/PerpTerminal";
import { readMarkPriceFor, SPOT_MARKETS } from "@/utils/marginguard";
import styles from "@/app/terminal.module.css";

/**
 * The trading terminal. CSS Grid locks chart / book / order-entry into place at
 * h-screen so nothing scrolls the page itself — only the inner panels scroll.
 */
export default function TradePage() {
  const [product, setProduct] = useState<"spot" | "perps">("spot");
  const [market, setMarket] = useState("ETH/USDC");
  const [mark, setMark] = useState(0);
  const [priceSource, setPriceSource] = useState("Pragma oracle · live");
  const selected = SPOT_MARKETS.find((item) => item.symbol === market) ?? SPOT_MARKETS[0];

  useEffect(() => {
    setMark(0);
    if (selected.id === "strk") {
      setPriceSource("Pragma oracle · live");
      readMarkPriceFor(selected.baseToken).then((p) => p && setMark(p)).catch(() => {});
      return;
    }

    // The deployed adapter is configured for STRK/USD only. Use the real public
    // market feed for other spot assets rather than displaying STRK's price under
    // ETH or BTC. This is a reference price, not a settlement oracle.
    setPriceSource("Public reference feed");
    fetch(`/api/market?asset=${selected.symbol.split("/")[0]}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { prices?: [number, number][] }) => {
        const latest = data.prices?.at(-1)?.[1];
        if (latest) setMark(latest);
      })
      .catch(() => {});
  }, [selected.baseToken]);

  return (
    <AppShell>
      <div className={styles.tradePage}>
        <div className={styles.productBar}>
          <span className={styles.productLabel}>MARKETS</span>
          <div className={styles.productSwitch} role="tablist" aria-label="Trading product">
            <button className={`${styles.productTab} ${product === "spot" ? styles.productTabActive : ""}`} onClick={() => setProduct("spot")} role="tab" aria-selected={product === "spot"}>Spot / Dark Pool</button>
            <button className={`${styles.productTab} ${product === "perps" ? styles.productTabActive : ""}`} onClick={() => setProduct("perps")} role="tab" aria-selected={product === "perps"}>Perpetuals</button>
          </div>
          <span className={styles.productHint}>{product === "spot" ? "Private STRK20 settlement" : "Deployed PerpEngine state"}</span>
        </div>

        {product === "perps" ? <PerpTerminal /> : <>
          <MarketBar market={market} onMarket={setMarket} mark={mark} oracle={mark} priceSource={priceSource} oracleVerified={selected.id === "strk"} />

          <div className={styles.tradeGrid}>
            {/* Left: chart over data tabs */}
            <div className={`${styles.mainColumn} ${styles.borderRight}`}>
              <TradeChart market={market} mark={mark} />
              <DataPanel />
            </div>

            {/* Middle: orderbook */}
            <Orderbook mark={mark} />

            {/* Right: order entry */}
            <OrderEntry mark={mark} market={selected.id} />
          </div>
        </>}
      </div>
    </AppShell>
  );
}
