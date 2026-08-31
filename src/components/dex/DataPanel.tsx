"use client";

import { useEffect, useState } from "react";
import type { STRK20_ACTION } from "@starknet-io/types-js";
import { num } from "starknet";
import { Database, ExternalLink, EyeOff, GitMerge, KeyRound, LockKeyhole } from "lucide-react";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import { MG, readOrderState, readProvider } from "@/utils/marginguard";
import { deriveOrder, unlockSeed } from "@/utils/keyvault";
import { readSpotOrders, writeSpotOrders } from "./perpPackets";
import styles from "@/app/terminal.module.css";

type Tab = "positions" | "orders" | "logs";
type StoredOrder = {
  orderId: string;
  index?: string;
  salt?: string;
  baseToken?: string;
  quoteToken?: string;
  priceUnits?: string;
  sizeUnits?: string;
  side: "buy" | "sell";
  size: string;
  price: string;
  placementTx: string;
  matchTx?: string;
};
type LiveOrder = StoredOrder & { live: boolean; matched: boolean; claimed: boolean };
const Th = ({ children }: { children: React.ReactNode }) => <th>{children}</th>;

function readStoredOrders(): StoredOrder[] {
  try {
    return readSpotOrders() as StoredOrder[];
  } catch {
    return [];
  }
}

function writeStoredOrders(update: (order: StoredOrder) => StoredOrder) {
  const next = readStoredOrders().map(update);
  writeSpotOrders(next);
}

function supportsStrk20(versions: string[]) {
  return versions.some((version) => {
    const [major, minor, patch] = version.split(".").map(Number);
    return major > 0 || (major === 0 && (minor > 10 || (minor === 10 && patch >= 3)));
  });
}

export function DataPanel() {
  const account = useStoreWallet((state) => state.myWalletAccount);
  const walletApi = useStoreWallet((state) => state.walletApiList);
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const stored = readStoredOrders();
      const live = await Promise.all(stored.map(async (order) => {
        try {
          return { ...order, ...(await readOrderState(order.orderId)) };
        } catch {
          return { ...order, live: false, matched: false, claimed: false };
        }
      }));
      if (active) setOrders(live);
    };
    refresh();
    const onOrdersChanged = () => refresh();
    window.addEventListener("marginguard:orders", onOrdersChanged);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      window.removeEventListener("marginguard:orders", onOrdersChanged);
      window.clearInterval(timer);
    };
  }, []);

  async function waitFor(tx: string) {
    const receipt: any = await readProvider().waitForTransaction(tx, { retries: 120, retryInterval: 3000 });
    if (receipt?.execution_status === "REVERTED" || receipt?.status === "REVERTED") {
      throw new Error("The transaction reverted on Starknet.");
    }
  }

  function counterpartyFor(order: LiveOrder) {
    return orders.find((candidate) => candidate.orderId !== order.orderId
      && candidate.live
      && !candidate.matched
      && candidate.side !== order.side
      && candidate.baseToken && candidate.baseToken === order.baseToken
      && candidate.quoteToken && candidate.quoteToken === order.quoteToken
      && candidate.index !== undefined && candidate.priceUnits && candidate.sizeUnits);
  }

  async function matchOrder(order: LiveOrder) {
    const other = counterpartyFor(order);
    if (!account) { setNotice("Connect a wallet to submit the permissionless match transaction."); return; }
    if (!other || !order.priceUnits || !order.sizeUnits || order.index === undefined
      || !other.priceUnits || !other.sizeUnits || other.index === undefined) {
      setNotice("Matching needs two compatible orders with their private reveal packets in this browser session.");
      return;
    }
    const buy = order.side === "buy" ? order : other;
    const sell = order.side === "sell" ? order : other;
    try {
      setBusy(`match:${order.orderId}`);
      setNotice("Confirm the public match transaction. Terms are revealed to the contract only at matching.");
      const seed = await unlockSeed(account);
      const buyKeys = deriveOrder(seed, Number(buy.index));
      const sellKeys = deriveOrder(seed, Number(sell.index));
      const result = await account.execute([{
        contractAddress: MG.orderBook,
        entrypoint: "match_orders",
        calldata: [buy.orderId, buy.priceUnits!, buy.sizeUnits!, buyKeys.salt, sell.orderId, sell.priceUnits!, sell.sizeUnits!, sellKeys.salt],
      }]);
      await waitFor(result.transaction_hash);
      writeStoredOrders((item) => item.orderId === buy.orderId || item.orderId === sell.orderId ? { ...item, matchTx: result.transaction_hash } : item);
      setNotice("Orders matched at the contract-enforced midpoint. Each side can now claim its open-note payout.");
      window.dispatchEvent(new Event("marginguard:orders"));
    } catch (error: any) {
      setNotice(error?.message ?? String(error));
    } finally {
      setBusy("");
    }
  }

  async function claimOrder(order: LiveOrder) {
    if (!account) { setNotice("Connect a wallet to claim the matched leg."); return; }
    if (!supportsStrk20(walletApi)) { setNotice("Reconnect with a wallet advertising STRK20 Wallet API 0.10.3 or newer."); return; }
    if (order.index === undefined || !order.priceUnits || !order.sizeUnits || !order.baseToken || !order.quoteToken) {
      setNotice("This order predates the claim flow. Place a new order in this browser session.");
      return;
    }
    const payoutToken = order.side === "buy" ? order.baseToken : order.quoteToken;
    try {
      setBusy(`claim:${order.orderId}`);
      setNotice("Confirm the STRK20 claim. The matched payout will be credited to an open note.");
      // Addresses are hex-normalized for the wallet; the "OPEN" and ${openNoteIds[0]}
      // placeholders are literal strings and must NOT be normalized.
      const seed = await unlockSeed(account);
      const { ownerSecret, salt } = deriveOrder(seed, Number(order.index));
      const actions: STRK20_ACTION[] = [
        { type: "transfer", token: num.toHex(payoutToken), amount: "OPEN", recipient: num.toHex(account.address) },
        {
          type: "invoke",
          contract: num.toHex(MG.venue),
          calldata: ["0x1", "0x0", "0x0", "0x0", ownerSecret, num.toHex(order.orderId), order.side === "buy" ? "0x0" : "0x1", order.priceUnits, order.sizeUnits, salt, "${openNoteIds[0]}"],
        },
      ];
      const result = await account.strk20InvokeTransaction(actions);
      await waitFor(result.transaction_hash);
      setNotice("Claim confirmed. The payout is now in a new shielded open note.");
      window.dispatchEvent(new Event("marginguard:orders"));
    } catch (error: any) {
      setNotice(error?.message ?? String(error));
    } finally {
      setBusy("");
    }
  }

  const tabs = [
    { id: "positions" as const, label: "Positions", count: 0 },
    { id: "orders" as const, label: "Dark pool orders", count: orders.length },
    { id: "logs" as const, label: "Agent logs", count: 0 },
  ];

  return (
    <section className={styles.dataPanel}>
      <div className={styles.tabs}>
        {tabs.map((item) => <button key={item.id} className={[styles.tab, tab === item.id ? styles.tabActive : ""].join(" ")} onClick={() => setTab(item.id)}>{item.label}<span className={styles.count}>{item.count}</span></button>)}
      </div>
      {notice && <div className={styles.lifecycleNotice}><GitMerge size={13} />{notice}</div>}
      <div className={styles.tableScroll}>
        {tab === "positions" && <div className={styles.privateEmpty}><EyeOff size={18} /><strong>No private positions indexed</strong><span>Perp position economics are not enumerable on-chain. The current live product slice is spot dark-pool trading.</span></div>}
        {tab === "orders" && (orders.length ? <table className={styles.table}>
          <thead><tr><Th>Order ID</Th><Th>Side</Th><Th>Terms</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
          <tbody>{orders.map((order) => {
            const other = counterpartyFor(order);
            const actionKey = busy.startsWith("match:") ? busy : busy.startsWith("claim:") ? busy : "";
            return <tr key={order.orderId}>
              <td className={styles.tnum}>{order.orderId.slice(0, 8)}…</td>
              <td className={order.side === "buy" ? styles.sideLong : styles.sideShort}>{order.side.toUpperCase()}</td>
              <td><span className={styles.tnum}>shielded</span><LockKeyhole size={10} style={{ marginLeft: 5, verticalAlign: "-1px", color: "#9d4edd" }} /></td>
              <td className={order.claimed ? styles.positive : order.matched ? styles.positive : order.live ? styles.status : styles.tableMuted}>{order.claimed ? "CLAIMED" : order.matched ? "MATCHED" : order.live ? "LIVE" : "CLOSED"}</td>
              <td><span className={styles.actionGroup}>
                {order.matched && !order.claimed && <button className={styles.actionButton} disabled={Boolean(actionKey)} onClick={() => claimOrder(order)}>{busy === `claim:${order.orderId}` ? "Claiming…" : "Claim"}</button>}
                {order.live && !order.matched && other && <button className={styles.actionButton} disabled={Boolean(actionKey)} onClick={() => matchOrder(order)}>{busy === `match:${order.orderId}` ? "Matching…" : "Match"}</button>}
                <a href={"https://voyager.online/tx/" + (order.matchTx ?? order.placementTx)} target="_blank" rel="noreferrer" className={styles.txLink}><ExternalLink size={11} />view</a>
              </span></td>
            </tr>;
          })}</tbody>
        </table> : <div className={styles.privateEmpty}><Database size={18} /><strong>No orders in this session</strong><span>Place a live limit order above. Once two compatible reveal packets are present, the permissionless match action appears here.</span></div>)}
        {tab === "logs" && <div className={styles.privateEmpty}><KeyRound size={18} /><strong>No agent actions recorded</strong><span>The guardian is registered on-chain, but no off-chain worker is running in this build.</span></div>}
      </div>
    </section>
  );
}

export default DataPanel;
