"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { num } from "starknet";
import {
  MARK_BASE,
  MARK_QUOTE,
  MG,
  SIDE_BUY,
  SIDE_SELL,
  nextPositionIndex,
  positionCommitment,
  readProvider,
  traderCommitment,
} from "@/utils/marginguard";
import { derivePosition, unlockSeed } from "@/utils/keyvault";
import {
  PRICE_SCALE,
  STRK_DECIMALS,
  USDC_DECIMALS,
  formatUnits,
  formatUsd,
  parseUnits,
  readPackets,
  writePackets,
  type PerpPacket,
} from "./perpPackets";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import styles from "@/app/terminal.module.css";

const EXPLORER = "https://voyager.online/tx/";
const LEVERAGE_TIERS = [2, 5, 10] as const;
/** The order form offers the same size shortcuts a leveraged venue normally does. */
const SIZE_STEPS = [25, 50, 75, 100] as const;

export function PerpOrderEntry({ enginePrice }: { enginePrice: bigint | null }) {
  const account = useStoreWallet((state) => state.myWalletAccount);
  const connected = useStoreWallet((state) => state.isConnected);
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState<number>(2);
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

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

    const sideCode = side === "long" ? SIDE_BUY : SIDE_SELL;
    try {
      setBusy(true);
      // Keys come from a wallet signature, so nothing secret is ever stored. The same
      // wallet reproduces them anywhere, which is what makes a lost browser survivable.
      setMessage("Sign to derive your trading keys. They are recomputed from your wallet, never stored.");
      const seed = await unlockSeed(account);
      const index = await nextPositionIndex(seed);
      const { id: positionId, ownerSecret, salt } = derivePosition(seed, index);
      // Only the commitment reaches the chain: side, size, entry, margin and leverage stay local.
      const commitment = positionCommitment(sideCode, sizeRaw, enginePrice, marginRaw, leverage, salt);
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
        index,
        positionId,
        side: sideCode,
        size: sizeRaw.toString(),
        entryPrice: enginePrice.toString(),
        margin: marginRaw.toString(),
        leverage,
        openTx: result.transaction_hash,
      };
      writePackets([packet, ...readPackets()]);
      setSize("");
      setMessage("Position open. Its economics are a private commitment; the chain shows only that a position exists.");
    } catch (error: any) {
      setMessage(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.entry}>
      <div className={styles.sideTabs}>
        <button
          className={`${styles.sideTab} ${side === "long" ? styles.sideTabLong : ""}`}
          onClick={() => setSide("long")}
        >
          Buy / Long
        </button>
        <button
          className={`${styles.sideTab} ${side === "short" ? styles.sideTabShort : ""}`}
          onClick={() => setSide("short")}
        >
          Sell / Short
        </button>
      </div>

      <div className={styles.entryBody}>
        <div className={styles.entryLabel}>Private perpetual <span>STRK-PERP</span></div>

        {/* Leverage is fixed to the tiers the engine and the agent policy both recognise. */}
        <div className={styles.segmented}>
          {LEVERAGE_TIERS.map((tier) => (
            <button
              key={tier}
              onClick={() => setLeverage(tier)}
              className={`${styles.segment} ${leverage === tier ? styles.segmentActive : ""}`}
            >
              {tier}x
            </button>
          ))}
        </div>

        <label>
          <span className={styles.fieldLabel}>
            <span>Order size</span>
            <span className={styles.fieldValue}>{notionalRaw ? `= ${formatUsd(notionalRaw)}` : "= $0.00"}</span>
          </span>
          <span className={styles.inputWrap}>
            <input
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="0.00"
              className={`${styles.input} ${styles.tnum}`}
              inputMode="decimal"
            />
            <span className={styles.inputUnit}>STRK</span>
          </span>
        </label>

        {/* Size shortcuts are relative to a round 1000 STRK clip, since a shielded
            balance the wallet will not disclose cannot anchor a percentage. */}
        <div className={styles.segmented}>
          {SIZE_STEPS.map((step) => (
            <button
              key={step}
              onClick={() => setSize(String((1000 * step) / 100))}
              className={styles.segment}
            >
              {step}%
            </button>
          ))}
        </div>

        <div className={styles.collateralRow}>
          <span>Oracle mark</span>
          <span className={`${styles.collateralValue} ${styles.collateralMain}`}>
            {enginePrice ? `$${formatUnits(enginePrice, USDC_DECIMALS, 5)}` : "-"}
          </span>
        </div>
        <div className={styles.collateralRow}>
          <span>Order value</span>
          <span className={styles.collateralValue}>{notionalRaw ? formatUsd(notionalRaw) : "-"}</span>
        </div>
        <div className={styles.collateralRow}>
          <span>Margin required</span>
          <span className={styles.collateralValue}>{marginRaw ? formatUsd(marginRaw) : "-"}</span>
        </div>
        <div className={styles.collateralRow}>
          <span>Liquidation price</span>
          <span className={styles.collateralValue}>{liqPrice ? `$${formatUnits(liqPrice, USDC_DECIMALS, 5)}` : "-"}</span>
        </div>
      </div>

      <button
        onClick={openPosition}
        disabled={busy}
        className={`${styles.submit} ${side === "long" ? styles.submitLong : styles.submitShort}`}
      >
        <ShieldCheck size={14} />
        {busy ? "Processing" : `Open shielded ${side}`}
      </button>

      {message && (
        <div className={`${styles.proof} ${message.includes("open") ? styles.positive : styles.negative}`}>
          <div className={styles.proofStep}><KeyRound size={12} />{message}</div>
          {txHash && (
            <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noreferrer" className={styles.txLink}>
              {`${txHash.slice(0, 10)}...${txHash.slice(-6)}`} <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      <p className={styles.entryFoot}>
        <KeyRound size={11} style={{ verticalAlign: "-2px", marginRight: 5 }} />
        Margin is a committed figure, not escrowed collateral. Reveal packets live in this browser
        session only, and without one the contract cannot verify your ownership at close.
      </p>
    </section>
  );
}

export default PerpOrderEntry;
