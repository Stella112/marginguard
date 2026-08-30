"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  readPoolRegistration,
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

/**
 * Turns a raw STRK20 wallet error into something a user can act on. The wallet API's
 * documented failures are NOT_REGISTERED, INSUFFICIENT_PRIVATE_BALANCE, PRIVACY_LEAK,
 * INVALID_REQUEST_PAYLOAD and USER_REFUSED_OP.
 */
function explainStrk20Error(error: any): string {
  const raw = error?.message ?? error?.toString?.() ?? "The request was not submitted.";
  if (raw.includes("NOT_REGISTERED")) {
    return "Your wallet is not registered with the STRK20 privacy pool yet. Registration is handled by the wallet, not by this app: open Ready, use its privacy/shield feature once to register a viewing key, then come back and retry.";
  }
  if (raw.includes("INSUFFICIENT_PRIVATE_BALANCE")) {
    return "Not enough shielded balance for this action. Shield more of this token first.";
  }
  if (raw.includes("USER_REFUSED_OP")) {
    return "You declined the request in the wallet.";
  }
  if (raw.includes("PRIVACY_LEAK")) {
    return "The wallet blocked this request because it would have leaked private state.";
  }
  if (raw.includes("INVALID_REQUEST_PAYLOAD")) {
    return "The wallet rejected the STRK20 request format. Make sure you are on a wallet with STRK20 Wallet API 0.10.3+ (Ready or Xverse) and reconnect.";
  }
  return raw;
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
  // Which token to shield. Defaults to whatever the current side reserves, but the user can
  // shield either leg independently — funding and order side are separate concerns.
  const [depositAsset, setDepositAsset] = useState<"base" | "quote">("quote");
  // null = not checked yet. Read straight from the pool so the UI can state registration
  // status up front rather than surfacing NOT_REGISTERED mid-transaction.
  const [registered, setRegistered] = useState<boolean | null>(null);

  useEffect(() => {
    if (mark && !price) setPrice(mark.toFixed(6));
  }, [mark, price]);

  const refreshBalances = useCallback(async () => {
    if (!account) return;
    try {
      // Ask only for this market's two tokens. Passing [] would request *every* private
      // balance the wallet holds — a far broader disclosure than this venue needs, and the
      // reason Ready raised a "share all private balances" consent prompt.
      const entries: any[] = await account.strk20Balances([
        marketConfig.baseToken,
        marketConfig.quoteToken,
      ]);
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
  }, [account, marketConfig.baseToken, marketConfig.quoteToken]);

  // Reading balances triggers a wallet consent prompt, so ask at most once per connected
  // account+market. Everything after that is user-initiated (the refresh control, or a
  // successful deposit) — otherwise every re-render re-prompts.
  const askedRef = useRef<string>("");
  useEffect(() => {
    if (!account?.address) return;
    const key = `${account.address}:${marketConfig.symbol}`;
    if (askedRef.current === key) return;
    askedRef.current = key;
    refreshBalances();
  }, [account?.address, marketConfig.symbol, refreshBalances]);

  useEffect(() => {
    if (!account?.address) {
      setRegistered(null);
      return;
    }
    readPoolRegistration(account.address).then(setRegistered).catch(() => setRegistered(null));
  }, [account?.address]);

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
      setMessage(explainStrk20Error(error));
    } finally {
      setBusy(false);
    }
  }

  const sizeN = Number(size) || 0;
  const priceN = Number(price) || mark;
  const notional = sizeN * priceN;
  const reserveLabel = side === "buy" ? "USDC" : "STRK";
  const accent = side === "buy" ? styles.submitLong : styles.submitShort;
  // A buy reserves quote (USDC); a sell reserves base (STRK). The deposit panel can shield
  // either, independently of the current side.
  const baseSymbol = marketConfig.symbol.split("/")[0];
  const depositToken = depositAsset === "quote" ? marketConfig.quoteToken : marketConfig.baseToken;
  const depositDecimals = depositAsset === "quote" ? marketConfig.quoteDecimals : marketConfig.baseDecimals;
  const depositSymbol = depositAsset === "quote" ? marketConfig.quoteSymbol : baseSymbol;
  // The balance shown alongside the order is the one that order will actually reserve.
  const reserveToken = side === "buy" ? marketConfig.quoteToken : marketConfig.baseToken;
  const reserveDecimals = side === "buy" ? marketConfig.quoteDecimals : marketConfig.baseDecimals;
  const shieldedRaw = shielded ? shielded[reserveToken.toLowerCase()] ?? 0n : null;

  /** Formats a shielded balance for one leg, so both tokens are visible at once. */
  const legBalance = (which: "base" | "quote") => {
    const token = which === "quote" ? marketConfig.quoteToken : marketConfig.baseToken;
    const decimals = which === "quote" ? marketConfig.quoteDecimals : marketConfig.baseDecimals;
    const symbol = which === "quote" ? marketConfig.quoteSymbol : baseSymbol;
    if (!shielded) return { symbol, text: "—" };
    const raw = shielded[token.toLowerCase()] ?? 0n;
    return {
      symbol,
      text: `${(Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`,
      zero: raw === 0n,
    };
  };

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
      setMessage(explainStrk20Error(error));
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
        {connected && registered === false && (
          <div style={{
            padding: "8px 10px", marginBottom: 8, borderRadius: 6, fontSize: 10.5, lineHeight: 1.5,
            border: "1px solid rgba(157,78,221,0.45)", background: "rgba(157,78,221,0.12)",
            color: "#d8bcff",
          }}>
            <strong style={{ display: "block", marginBottom: 2 }}>Pool registration required</strong>
            This address has no viewing key in the STRK20 pool. Only a wallet can register one —
            open Ready and use its privacy / shield feature once, then reload here.
          </div>
        )}
        {connected && registered === true && (
          <div style={{
            padding: "6px 10px", marginBottom: 8, borderRadius: 6, fontSize: 10.5,
            border: "1px solid rgba(0,229,255,0.35)", background: "rgba(0,229,255,0.10)",
            color: "#8ef0ff",
          }}>
            Registered with the STRK20 pool · private actions enabled
          </div>
        )}
        <div className={styles.collateralRow}>
          <span><LockKeyhole size={11} style={{ verticalAlign: "-2px", marginRight: 5 }} />Shielded balance</span>
          <span className={styles.collateralValue}>
            {/* Both legs are shown: shielding STRK must not look like "nothing happened"
                just because the current side reserves USDC. */}
            <span style={{ display: "inline-flex", gap: 10, marginRight: 8 }}>
              {(["base", "quote"] as const).map((which) => {
                const leg = legBalance(which);
                const isReserve = (which === "quote") === (side === "buy");
                return (
                  <span
                    key={which}
                    title={isReserve ? "Reserved by this order" : undefined}
                    style={{
                      color: leg.zero ? "rgba(255,255,255,0.35)" : "#8ef0ff",
                      fontWeight: isReserve ? 700 : 400,
                    }}
                  >
                    {leg.text}
                  </span>
                );
              })}
            </span>
            <button
              type="button"
              onClick={() => refreshBalances()}
              disabled={!connected || busy}
              title="Re-read shielded balances from the wallet"
              style={{
                marginRight: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700,
                borderRadius: 4, cursor: connected && !busy ? "pointer" : "not-allowed",
                border: "1px solid rgba(255,255,255,0.18)", background: "transparent",
                color: "rgba(255,255,255,0.6)",
              }}
            >
              ↻
            </button>
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
          <div style={{ padding: "8px 0 4px" }}>
            {/* Choose which token to shield — independent of the order side. */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {(["quote", "base"] as const).map((which) => {
                const label = which === "quote" ? marketConfig.quoteSymbol : baseSymbol;
                const on = depositAsset === which;
                return (
                  <button
                    key={which}
                    type="button"
                    onClick={() => setDepositAsset(which)}
                    style={{
                      flex: 1, padding: "5px 0", fontSize: 10.5, fontWeight: 700, borderRadius: 5,
                      cursor: "pointer",
                      border: `1px solid ${on ? "rgba(0,229,255,0.55)" : "rgba(255,255,255,0.12)"}`,
                      background: on ? "rgba(0,229,255,0.14)" : "transparent",
                      color: on ? "#00e5ff" : "rgba(255,255,255,0.45)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder={`Amount in ${depositSymbol}`}
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
