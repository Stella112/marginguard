"use client";

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { num } from "starknet";
import {
  MARK_BASE,
  MARK_QUOTE,
  MG,
  SIDE_BUY,
  SIDE_SELL,
  positionCommitment,
  randomFelt,
  readEnginePrice,
  readProvider,
  traderCommitment,
} from "@/utils/marginguard";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import styles from "@/app/terminal.module.css";

const EXPLORER = "https://voyager.online/tx/";
const LEVERAGE_TIERS = [2, 5, 10] as const;
/** The engine scales every price by 1e18: quote_value = size * price / PRICE_SCALE. */
const PRICE_SCALE = 10n ** 18n;
const STRK_DECIMALS = 18;
const USDC_DECIMALS = 6;

/** A position's private economics, kept in this browser so it can be revealed at close. */
type PerpPacket = {
  positionId: string;
  ownerSecret: string;
  salt: string;
  side: number;
  size: string;
  entryPrice: string;
  margin: string;
  leverage: number;
  openTx: string;
};

function parseUnits(value: string, decimals: number) {
  const [whole, fraction = ""] = value.trim().split(".");
  if (!whole && !fraction) return 0n;
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function formatUnits(raw: bigint, decimals: number, places = 2) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, places);
  return `${whole}.${frac}`;
}

function readPackets(): PerpPacket[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem("marginguard.perp-positions") ?? "[]");
    return Array.isArray(parsed) ? parsed as PerpPacket[] : [];
  } catch {
    return [];
  }
}

function writePackets(next: PerpPacket[]) {
  sessionStorage.setItem("marginguard.perp-positions", JSON.stringify(next));
}

export function PerpOrderEntry() {
  const account = useStoreWallet((state) => state.myWalletAccount);
  const connected = useStoreWallet((state) => state.isConnected);
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState<number>(2);
  const [size, setSize] = useState("");
  const [enginePrice, setEnginePrice] = useState<bigint | null>(null);
  const [packets, setPackets] = useState<PerpPacket[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => { setPackets(readPackets()); }, []);

  useEffect(() => {
    let active = true;
    const load = () => readEnginePrice(MARK_BASE, MARK_QUOTE)
      .then((p) => { if (active) setEnginePrice(p); })
      .catch(() => {});
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const sizeRaw = size ? parseUnits(size, STRK_DECIMALS) : 0n;
  // Notional lands in quote-smallest units, matching the engine's quote_value().
  const notionalRaw = enginePrice ? (sizeRaw * enginePrice) / PRICE_SCALE : 0n;
  const marginRaw = notionalRaw / BigInt(leverage);
  // Liquidation sits where the loss has eaten half the posted margin (maintenance = 50%).
  const liqPrice = enginePrice && sizeRaw > 0n
    ? side === "long"
      ? enginePrice - (enginePrice / BigInt(leverage)) / 2n
      : enginePrice + (enginePrice / BigInt(leverage)) / 2n
    : null;

  async function waitFor(tx: string) {
    const receipt: any = await readProvider().waitForTransaction(tx, { retries: 120, retryInterval: 3000 });
    if (receipt?.execution_status === "REVERTED" || receipt?.status === "REVERTED") {
      throw new Error("The transaction reverted on Starknet.");
    }
  }

  async function openPosition() {
    setMessage("");
    setTxHash("");
    if (!account || !connected) { setMessage("Connect a Starknet wallet first."); return; }
    if (!enginePrice) { setMessage("Waiting for the oracle mark before a position can be priced."); return; }
    if (sizeRaw <= 0n) { setMessage("Enter a size greater than zero."); return; }
    if (marginRaw <= 0n) { setMessage("That size is too small to post any margin at this leverage."); return; }

    const positionId = randomFelt();
    const ownerSecret = randomFelt();
    const salt = randomFelt();
    const sideCode = side === "long" ? SIDE_BUY : SIDE_SELL;
    // Only the commitment reaches the chain: side, size, entry, margin and leverage stay here.
    const commitment = positionCommitment(sideCode, sizeRaw, enginePrice, marginRaw, leverage, salt);

    try {
      setBusy(true);
      setMessage("Confirm the position. Only its commitment is written on-chain, so size, entry and margin stay private.");
      const result = await account.execute([{
        contractAddress: MG.perpEngine,
        entrypoint: "open_position",
        calldata: [
          positionId,
          traderCommitment(ownerSecret),
          commitment,
          num.toHex(MARK_BASE),
          num.toHex(MARK_QUOTE),
        ],
      }]);
      setTxHash(result.transaction_hash);
      await waitFor(result.transaction_hash);
      const packet: PerpPacket = {
        positionId,
        ownerSecret,
        salt,
        side: sideCode,
        size: sizeRaw.toString(),
        entryPrice: enginePrice.toString(),
        margin: marginRaw.toString(),
        leverage,
        openTx: result.transaction_hash,
      };
      const next = [packet, ...readPackets()];
      writePackets(next);
      setPackets(next);
      setSize("");
      setMessage("Position open. Its economics are a private commitment; the chain shows only that a position exists.");
    } catch (error: any) {
      setMessage(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  }

  async function closePosition(packet: PerpPacket) {
    setMessage("");
    setTxHash("");
    if (!account || !connected) { setMessage("Connect a Starknet wallet first."); return; }
    try {
      setBusy(true);
      setMessage("Confirm the close. The committed economics are revealed to the contract only now, so it can verify and settle.");
      const result = await account.execute([{
        contractAddress: MG.perpEngine,
        entrypoint: "close_position",
        calldata: [
          packet.positionId,
          packet.ownerSecret,
          num.toHex(packet.side),
          num.toHex(BigInt(packet.size)),
          num.toHex(BigInt(packet.entryPrice)),
          num.toHex(BigInt(packet.margin)),
          num.toHex(packet.leverage),
          packet.salt,
        ],
      }]);
      setTxHash(result.transaction_hash);
      await waitFor(result.transaction_hash);
      const next = readPackets().filter((p) => p.positionId !== packet.positionId);
      writePackets(next);
      setPackets(next);
      setMessage("Position closed. The contract recomputed the commitment, priced it against the oracle and recorded the settlement.");
    } catch (error: any) {
      setMessage(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  }

  const markText = enginePrice ? `$${formatUnits(enginePrice, USDC_DECIMALS, 5)}` : "-";

  return (
    <section className={styles.perpCard}>
      <div className={styles.panelHeader}>
        <span>Order entry</span>
        <span className={styles.subtleTag}>STRK-PERP PRIVATE</span>
      </div>

      <div style={{ display: "flex", gap: 5, margin: "8px 0 10px" }}>
        {(["long", "short"] as const).map((which) => {
          const on = side === which;
          const accent = which === "long" ? "0,229,255" : "244,91,105";
          return (
            <button
              key={which}
              type="button"
              onClick={() => setSide(which)}
              style={{
                flex: 1, padding: "7px 0", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
                borderRadius: 6, cursor: "pointer", textTransform: "uppercase",
                border: `1px solid ${on ? `rgba(${accent},0.6)` : "rgba(255,255,255,0.12)"}`,
                background: on ? `rgba(${accent},0.15)` : "transparent",
                color: on ? `rgb(${accent})` : "rgba(255,255,255,0.45)",
              }}
            >
              {which}
            </button>
          );
        })}
      </div>

      {/* Leverage is fixed to the tiers the engine and the agent policy both recognise. */}
      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
        {LEVERAGE_TIERS.map((tier) => {
          const on = leverage === tier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setLeverage(tier)}
              style={{
                flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: "pointer",
                border: `1px solid ${on ? "rgba(157,78,221,0.6)" : "rgba(255,255,255,0.12)"}`,
                background: on ? "rgba(157,78,221,0.16)" : "transparent",
                color: on ? "#d8bcff" : "rgba(255,255,255,0.45)",
              }}
            >
              {tier}x
            </button>
          );
        })}
      </div>

      {/* .input is borderless by design; .inputWrap supplies the field chrome. */}
      <span className={styles.inputWrap} style={{ marginBottom: 10 }}>
        <input
          value={size}
          onChange={(event) => setSize(event.target.value)}
          placeholder="0.00"
          className={`${styles.input} ${styles.tnum}`}
          inputMode="decimal"
        />
        <span className={styles.inputUnit}>STRK</span>
      </span>

      <div className={styles.collateralRow}><span>Oracle mark</span><span className={`${styles.collateralValue} ${styles.collateralMain}`}>{markText}</span></div>
      <div className={styles.collateralRow}><span>Notional</span><span className={styles.collateralValue}>{notionalRaw ? `$${formatUnits(notionalRaw, USDC_DECIMALS)}` : "-"}</span></div>
      <div className={styles.collateralRow}><span>Margin required</span><span className={styles.collateralValue}>{marginRaw ? `$${formatUnits(marginRaw, USDC_DECIMALS)}` : "-"}</span></div>
      <div className={styles.collateralRow}><span>Est. liquidation</span><span className={styles.collateralValue}>{liqPrice ? `$${formatUnits(liqPrice, USDC_DECIMALS, 5)}` : "-"}</span></div>

      <button
        onClick={openPosition}
        disabled={busy || !connected}
        className={`${styles.submit} ${side === "long" ? styles.submitLong : styles.submitShort}`}
      >
        <ShieldCheck size={14} />
        {busy ? "Processing" : connected ? `Open shielded ${side}` : "Connect wallet"}
      </button>

      {message && (
        <div className={`${styles.proof} ${message.includes("open") || message.includes("closed") ? styles.positive : styles.negative}`}>
          <div className={styles.proofStep}><KeyRound size={12} />{message}</div>
          {txHash && <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noreferrer" className={styles.txLink}>{`${txHash.slice(0, 10)}...${txHash.slice(-6)}`} <ExternalLink size={11} /></a>}
        </div>
      )}

      {packets.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)", marginBottom: 8 }}>
            OPEN POSITIONS - THIS SESSION
          </div>
          {packets.map((packet) => (
            <div key={packet.positionId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className={packet.side === SIDE_BUY ? styles.sideLong : styles.sideShort} style={{ fontSize: 10.5, fontWeight: 800 }}>
                {packet.side === SIDE_BUY ? "LONG" : "SHORT"}
              </span>
              <span className={styles.tnum} style={{ fontSize: 11 }}>
                {formatUnits(BigInt(packet.size), STRK_DECIMALS)} STRK - {packet.leverage}x
              </span>
              <LockKeyhole size={10} style={{ color: "#9d4edd" }} />
              <button
                type="button"
                onClick={() => closePosition(packet)}
                disabled={busy}
                style={{
                  marginLeft: "auto", padding: "4px 10px", fontSize: 10.5, fontWeight: 700, borderRadius: 5,
                  cursor: busy ? "not-allowed" : "pointer", border: "1px solid rgba(255,255,255,0.18)",
                  background: "transparent", color: "rgba(255,255,255,0.75)", opacity: busy ? 0.5 : 1,
                }}
              >
                Close
              </button>
            </div>
          ))}
        </div>
      )}

      <p className={styles.entryFoot}>
        <KeyRound size={11} style={{ verticalAlign: "-2px", marginRight: 5 }} />
        Reveal packets live in this browser session only. Close a position before leaving, or keep the
        page open, because without the packet the contract cannot verify your ownership.
      </p>
    </section>
  );
}

export default PerpOrderEntry;
