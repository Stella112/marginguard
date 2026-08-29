"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/dex/AppShell";
import MarketBar from "@/components/dex/MarketBar";
import TradeChart from "@/components/dex/TradeChart";
import Orderbook from "@/components/dex/Orderbook";
import OrderEntry from "@/components/dex/OrderEntry";
import DataPanel from "@/components/dex/DataPanel";
import { readMarkPrice } from "@/utils/marginguard";

/**
 * The trading terminal. CSS Grid locks chart / book / order-entry into place at
 * h-screen so nothing scrolls the page itself — only the inner panels scroll.
 */
export default function TradePage() {
  const [market, setMarket] = useState("STRK-PERP");
  const [mark, setMark] = useState(0.02463);

  useEffect(() => {
    // Live mark from the deployed Pragma oracle on mainnet.
    readMarkPrice()
      .then((p) => p && setMark(p))
      .catch(() => {});
  }, []);

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <MarketBar market={market} onMarket={setMarket} mark={mark} oracle={mark} />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px_300px] xl:grid-cols-[minmax(0,1fr)_300px_320px]">
          {/* Left: chart over data tabs */}
          <div className="grid min-h-0 grid-rows-[minmax(0,1.35fr)_minmax(0,1fr)] border-r border-white/10">
            <TradeChart market={market} mark={mark} />
            <DataPanel />
          </div>

          {/* Middle: orderbook */}
          <Orderbook mark={mark} />

          {/* Right: order entry */}
          <OrderEntry mark={mark} />
        </div>
      </div>
    </AppShell>
  );
}
