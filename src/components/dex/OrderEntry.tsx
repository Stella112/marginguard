"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import type { STRK20_ACTION } from "@starknet-io/types-js";
import { num } from "starknet";
import { fmtPrice } from "./data";
import styles from "@/app/terminal.module.css";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import {
  MG,
  SPOT_MARKETS,
  SIDE_BUY,
  SIDE_SELL,
  orderCommitment,
  randomFelt,
  readProvider,
  traderCommitment,
} from "@/utils/marginguard";

type Side = "buy" | "sell";
type OrderType = "Market" | "Limit" | "Stop";

const STRK_DECIMALS = 18;
const USDC_DECIMALS = 6;
const ZERO = "0x0";
const EXPLORER = "https://voyager.online/tx/";

function parseUnits(value: string, decimals: number): bigint {
  const clean = value.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Enter a positive decimal amount.");
  const [whole, fraction = ""] = clean.split(".");
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  return BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

function quoteAmount(size: bigint, price: bigint): bigint {
  // Venue PRICE_SCALE is 1e18: base smallest units × quote-smallest per
  // whole base unit / 1e18 = quote smallest units.
  return (size * price) / 10n ** 18n;
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function rememberOrder(record: Record<string, string>) {
  try {
    const current = JSON.parse(sessionStorage.getItem("marginguard.spot-orders") ?? "[]");
    // Keep the owner secret in the current browser session only. It is required
    // for a later claim/cancel and must not survive as a durable localStorage secret.
    sessionStorage.setItem("marginguard.spot-orders", JSON.stringify([record, ...current].slice(0, 20)));
    localStorage.removeItem("marginguard.spot-orders");
  } catch {
    // Local persistence is convenience only; the chain remains authoritative.
  }
}

export function OrderEntry({ mark, market = "strk" }: { mark: number; market?: "strk" | "eth" | "btc" | "sol" }) {
  const marketConfig = SPOT_MARKETS.find((item) => item.id === market) ?? SPOT_MARKETS[0];
  const account = useStoreWallet((state) => state.myWalletAccount);
  const connected = useStoreWallet((state) => state.isConnected);
  const walletApi = useStoreWallet((state) => state.walletApiList);
  const [side, setSide] = useState<Side>("buy");
  const [type, setType] = useState<OrderType>("Limit");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  // Shielded (in-pool) balances, keyed by token address. Read through the wallet, so no
  // viewing key ever reaches this app.
  const [shielded, setShielded] = useState<Record<string, bigint> | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [showDeposit, setShowDeposit] = useState(false);

  useEffect(() => {
    if (mark && !price) setPrice(mark.toFixed(6));
  }, [mark, price]);

  const refreshBalances = useCallback(async () => {
    if (!account) return;
    try {
      // Empty array asks the wallet for every private balance it knows about.
      const entries: any[] = await account.strk20Balances([]);
      const next: Record<string, bigint> = {};
      for (const entry of entries ?? []) {
        const token = entry?.token ?? entry?.token_address;
        const balance = entry?.balance ?? entry?.amount;
        if (token !== undefined && balance !== undefined) {
          next[num.toHex(token).toLowerCase()] = BigInt(balance);
        }
      }
      setShielded(next);
    } catch {
      // The wallet refused (no STRK20 support, or consent declined).
      setShielded(null);
    }
  }, [account]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  /** Shields public tokens into the STRK20 pool so they can back a private order. */
  async function shieldTokens() {
    setMessage("");
    setTxHash("");
    if (!account || !connected) {
      setMessage("Connect a Starknet wallet first.");
      return;
    }
    try {
      setBusy(true);
      const amount = parseUnits(depositAmount, depositDecimals);
      if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
      setMessage("Confirm the deposit in your wallet. This moves public tokens into the STRK20 pool.");
      const result = await account.strk20InvokeTransaction([
        { type: "deposit", token: depositToken, amount: num.toHex(amount) },
      ] as STRK20_ACTION[]);
      setTxHash(result.transaction_hash);
      await waitFor(result.transaction_hash);
      setMessage("Shielded. The balance is now private inside the pool and can back an order.");
      setDepositAmount("");
      setShowDeposit(false);
      refreshBalances();
    } catch (error: any) {
      const raw = error?.message ?? String(error);
      setMessage(raw.includes("INVALID_REQUEST_PAYLOAD")
        ? "The connected wallet rejected the STRK20 request. Use a wallet with STRK20 Wallet API support (Ready or Xverse) and reconnect."
        : raw);
    } finally {
      setBusy(false);
    }
  }

  const sizeN = Number(size) || 0;
  const priceN = Number(price) || mark;
  const notional = sizeN * priceN;
  const reserveLabel = side === "buy" ? "USDC" : "STRK";
  const accent = side === "buy" ? styles.submitLong : styles.submitShort;
  // A buy reserves quote (USDC); a sell reserves base (STRK). Shield whichever the order needs.
  const depositToken = side === "buy" ? marketConfig.quoteToken : marketConfig.baseToken;
  const depositDecimals = side === "buy" ? marketConfig.quoteDecimals : marketConfig.baseDecimals;
  const shieldedRaw = shielded ? shielded[depositToken.toLowerCase()] ?? 0n : null;
  const shieldedDisplay = shieldedRaw === null
    ? "Wallet consent required"
    : `${(Number(shieldedRaw) / 10 ** depositDecimals).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${reserveLabel}`;

  async function waitFor(tx: string) {
    const receipt: any = await readProvider().waitForTransaction(tx, { retries: 120, retryInterval: 3000 });
    if (receipt?.execution_status === "REVERTED" || receipt?.status === "REVERTED") {
      throw new Error("The transaction reverted on Starknet.");
    }
  }

  async function submitOrder() {
    setMessage("");
    setTxHash("");
    if (!account || !connected) {
      setMessage("Connect a Starknet wallet first.");
      return;
    }
    const supportsStrk20 = walletApi.some((version) => {
      const [major, minor, patch] = version.split(".").map(Number);
      return major > 0 || (major === 0 && (minor > 10 || (minor === 10 && patch >= 3)));
    });
    if (!supportsStrk20) {
      setMessage("This wallet does not advertise STRK20 Wallet API 0.10.3 or newer. Reconnect with Ready or Xverse to fund a private order.");
      return;
    }
    if (type !== "Limit") {
      setMessage("Only limit orders are live on the deployed private venue. Market and stop execution are not wired yet.");
      return;
    }

    try {
      setBusy(true);
      if (!marketConfig.available) throw new Error(marketConfig.note ?? "This market is not available yet.");
      const sizeUnits = parseUnits(size, marketConfig.baseDecimals);
      const quoteUnits = parseUnits(price, marketConfig.quoteDecimals);
      const priceUnits = (quoteUnits * 10n ** 18n) / (10n ** BigInt(marketConfig.baseDecimals));
      if (sizeUnits <= 0n || priceUnits <= 0n) throw new Error("Enter a size and limit price greater than zero.");

      const reserveAmount = side === "buy" ? quoteAmount(sizeUnits, priceUnits) : sizeUnits;
      if (reserveAmount <= 0n) throw new Error("The reserve is below the token precision.");

      // These values never leave the browser in plaintext. The venue receives
      // only the trader and order commitments during placement. The owner
      // secret is needed later to cancel or claim this order.
      const ownerSecret = randomFelt();
      const salt = randomFelt();
      const orderId = randomFelt();
      const trader = traderCommitment(ownerSecret);
      const orderCommit = orderCommitment(side === "buy" ? SIDE_BUY : SIDE_SELL, priceUnits, sizeUnits, salt);
      const reserveToken = side === "buy" ? marketConfig.quoteToken : marketConfig.baseToken;

      setMessage("Step 1/2 · Confirm STRK20 collateral funding in your wallet…");
      // The pool must actually move the reserve to the venue before the invoke runs:
      // `do_fund` measures the venue's real ERC-20 balance and reverts UNDERFUNDED if the
      // tokens are not already there. An invoke-only STRK20 transaction moves nothing (and
      // the wallet rejects it as a malformed payload), so the withdraw leg is required.
      // Phase order is enforced by the protocol: Withdraw (6) precedes InvokeExternal (7).
      const fundActions: STRK20_ACTION[] = [
        {
          type: "withdraw",
          token: reserveToken,
          amount: num.toHex(reserveAmount),
          recipient: MG.venue,
        },
        {
          type: "invoke",
          contract: MG.venue,
          // VenueOperation::Fund plus the remaining positional fields. Fund returns an
          // empty span, so no OPEN note is needed for this leg.
          calldata: ["0x0", trader, reserveToken, num.toHex(reserveAmount), ZERO, ZERO, "0x0", ZERO, ZERO, ZERO, ZERO],
        },
      ];
      const funded = await account.strk20InvokeTransaction(fundActions);
      setTxHash(funded.transaction_hash);
      await waitFor(funded.transaction_hash);

      setMessage("Step 2/2 · Funding confirmed. Confirm the shielded limit order…");
      const placed = await account.execute([{
        contractAddress: MG.venue,
        entrypoint: "place_order",
        calldata: [
          orderId,
          trader,
          orderCommit,
          marketConfig.baseToken,
          marketConfig.quoteToken,
          reserveToken,
          reserveAmount.toString(),
        ],
      }]);
      setTxHash(placed.transaction_hash);
      await waitFor(placed.transaction_hash);

      rememberOrder({
        orderId,
        ownerSecret,
        salt,
        baseToken: marketConfig.baseToken,
        quoteToken: marketConfig.quoteToken,
        priceUnits: priceUnits.toString(),
        sizeUnits: sizeUnits.toString(),
        side,
        size,
        price,
        fundingTx: funded.transaction_hash,
        placementTx: placed.transaction_hash,
      });
      window.dispatchEvent(new Event("marginguard:orders"));
      setMessage(`Order live. It is backed by ${reserveAmount.toString()} ${reserveLabel} units and waiting for a counterparty.`);
    } catch (error: any) {
      const raw = error?.message ?? error?.toString?.() ?? "The order was not submitted.";
      setMessage(raw.includes("INVALID_REQUEST_PAYLOAD")
        ? "The connected wallet rejected the STRK20 request format. Use a wallet with STRK20 Wallet API support, such as Ready or Xverse, then reconnect."
        : raw);
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.entry}>
    <div className={styles.sideTabs}>
      <button className={`${styles.sideTab} ${side === "buy" ? styles.sideTabLong : ""}`} onClick={() => setSide("buy")}>Buy</button>
      <button className={`${styles.sideTab} ${side === "sell" ? styles.sideTabShort : ""}`} onClick={() => setSide("sell")}>Sell</button>
    </div>
    <div className={styles.entryBody}>
      <div className={styles.entryLabel}>Spot dark pool <span>{marketConfig.symbol}</span></div>
      <div className={styles.segmented}>{(["Market", "Limit", "Stop"] as OrderType[]).map((item) => <button key={item} onClick={() => setType(item)} className={`${styles.segment} ${type === item ? styles.segmentActive : ""}`}>{item}</button>)}</div>
      <label><span className={styles.fieldLabel}><span>Order size</span><span className={styles.fieldValue}>≈ ${notional.toFixed(2)}</span></span><span className={styles.inputWrap}><input value={size} onChange={(event) => setSize(event.target.value)} placeholder="0.00" className={`${styles.input} ${styles.tnum}`} inputMode="decimal" /><span className={styles.inputUnit}>{marketConfig.symbol.split("/")[0]}</span></span></label>
      <label><span className={styles.fieldLabel}><span>Limit price</span><span className={styles.fieldValue}>{marketConfig.quoteSymbol}</span></span><span className={styles.inputWrap}><input value={price} placeholder={fmtPrice(mark)} disabled={type === "Market"} onChange={(event) => setPrice(event.target.value)} className={`${styles.input} ${styles.tnum}`} inputMode="decimal" /><span className={styles.inputUnit}>{marketConfig.quoteSymbol}</span></span></label>
      <div className={styles.collateral}>
        <div className={styles.collateralRow}>
          <span><LockKeyhole size={11} style={{ verticalAlign: "-2px", marginRight: 5 }} />Shielded balance</span>
          <span className={styles.collateralValue}>
            {shieldedDisplay}
            <button
              type="button"
              onClick={() => setShowDeposit((v) => !v)}
              disabled={!connected || busy}
              style={{
                marginLeft: 8, padding: "2px 7px", fontSize: 10, fontWeight: 700,
                borderRadius: 4, cursor: connected && !busy ? "pointer" : "not-allowed",
                border: "1px solid rgba(0,229,255,0.4)", background: "rgba(0,229,255,0.12)",
                color: "#00e5ff",
              }}
            >
              {showDeposit ? "CLOSE" : "SHIELD"}
            </button>
          </span>
        </div>

        {showDeposit && (
          <div style={{ display: "flex", gap: 6, padding: "8px 0 4px" }}>
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder={`Amount in ${reserveLabel}`}
              className={styles.input}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={shieldTokens}
              disabled={busy || !depositAmount}
              style={{
                padding: "0 12px", fontSize: 11, fontWeight: 700, borderRadius: 6,
                cursor: busy || !depositAmount ? "not-allowed" : "pointer",
                border: "none", background: "#00e5ff", color: "#06121a",
                opacity: busy || !depositAmount ? 0.5 : 1,
              }}
            >
              {busy ? "…" : "DEPOSIT"}
            </button>
          </div>
        )}

        <div className={styles.collateralRow}><span>Reserve required</span><span className={styles.collateralValue}>{reserveLabel}</span></div>
        <div className={styles.collateralRow}><span>Verified oracle mark</span><span className={`${styles.collateralValue} ${styles.collateralMain}`}>{mark ? fmtPrice(mark) : "—"}</span></div>
      </div>
      <button onClick={submitOrder} disabled={busy} className={`${styles.submit} ${accent}`}><ShieldCheck size={14} />{busy ? "Processing…" : "Place shielded order"}</button>
      {message && <div className={`${styles.proof} ${message.includes("Order live") ? styles.positive : styles.negative}`}><div className={styles.proofStep}><KeyRound size={12} />{message}</div>{txHash && <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noreferrer" className={styles.txLink}>{shortHash(txHash)} <ExternalLink size={11} /></a>}</div>}
      <p className={styles.entryFoot}><KeyRound size={11} style={{ verticalAlign: "-2px", marginRight: 5 }} />Funding and placement are separate by design. Your price and size are committed privately; the chain sees only lifecycle flags until matching.</p>
    </div>
  </section>;
}

export default OrderEntry;
