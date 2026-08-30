"use client";

import { useEffect, useState } from "react";
import { ExternalLink, EyeOff, GitMerge, LockKeyhole, Search } from "lucide-react";
import { num } from "starknet";
import { MG, readPosition, readProvider, type PositionView } from "@/utils/marginguard";
import {
  PERP_EVENT,
  STRK_DECIMALS,
  USDC_DECIMALS,
  formatUnits,
  readPackets,
  writePackets,
  type PerpPacket,
} from "./perpPackets";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import styles from "@/app/terminal.module.css";

type Tab = "positions" | "lookup";
const SIDE_LONG = 0;

export function PerpDataPanel({ mark }: { mark: bigint | null }) {
  const account = useStoreWallet((state) => state.myWalletAccount);
  const connected = useStoreWallet((state) => state.isConnected);
  const [tab, setTab] = useState<Tab>("positions");
  const [packets, setPackets] = useState<PerpPacket[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [positionId, setPositionId] = useState("");
  const [position, setPosition] = useState<PositionView | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sync = () => setPackets(readPackets());
    sync();
    window.addEventListener(PERP_EVENT, sync);
    return () => window.removeEventListener(PERP_EVENT, sync);
  }, []);

  async function waitFor(tx: string) {
    const receipt: any = await readProvider().waitForTransaction(tx, { retries: 120, retryInterval: 3000 });
    if (receipt?.execution_status === "REVERTED" || receipt?.status === "REVERTED") {
      throw new Error("The transaction reverted on Starknet.");
    }
  }

  async function closePosition(packet: PerpPacket) {
    setNotice("");
    if (!account || !connected) { setNotice("Connect a wallet to close this position."); return; }
    try {
      setBusy(packet.positionId);
      setNotice("Confirm the close. The committed economics are revealed to the contract only now, so it can verify and settle.");
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
      await waitFor(result.transaction_hash);
      writePackets(readPackets().filter((p) => p.positionId !== packet.positionId));
      setNotice("Position closed. The contract recomputed the commitment, priced it against the oracle and recorded the settlement.");
    } catch (error: any) {
      setNotice(error?.message ?? String(error));
    } finally {
      setBusy("");
    }
  }

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

  /** Unrealised PnL against the live mark, using the engine's own quote_value scaling. */
  function pnlOf(packet: PerpPacket) {
    if (!mark) return null;
    const size = BigInt(packet.size);
    const entry = BigInt(packet.entryPrice);
    const entryValue = (size * entry) / 10n ** 18n;
    const nowValue = (size * mark) / 10n ** 18n;
    return packet.side === SIDE_LONG ? nowValue - entryValue : entryValue - nowValue;
  }

  const tabs = [
    { id: "positions" as const, label: "Positions", count: packets.length },
    { id: "lookup" as const, label: "Position lookup", count: 0 },
  ];

  return (
    <section className={styles.dataPanel}>
      <div className={styles.tabs}>
        {tabs.map((item) => (
          <button
            key={item.id}
            className={[styles.tab, tab === item.id ? styles.tabActive : ""].join(" ")}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span className={styles.count}>{item.count}</span>
          </button>
        ))}
      </div>

      {notice && <div className={styles.lifecycleNotice}><GitMerge size={13} />{notice}</div>}

      <div className={styles.tableScroll}>
        {tab === "positions" && (packets.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Side</th><th>Size</th><th>Lev</th><th>Entry</th><th>Margin</th><th>uPnL</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {packets.map((packet) => {
                const pnl = pnlOf(packet);
                const up = pnl !== null && pnl >= 0n;
                return (
                  <tr key={packet.positionId}>
                    <td className={packet.side === SIDE_LONG ? styles.sideLong : styles.sideShort}>
                      {packet.side === SIDE_LONG ? "LONG" : "SHORT"}
                    </td>
                    <td className={styles.tnum}>{formatUnits(BigInt(packet.size), STRK_DECIMALS)}</td>
                    <td className={styles.tnum}>{packet.leverage}x</td>
                    <td className={styles.tnum}>${formatUnits(BigInt(packet.entryPrice), USDC_DECIMALS, 5)}</td>
                    <td className={styles.tnum}>${formatUnits(BigInt(packet.margin), USDC_DECIMALS)}</td>
                    <td className={`${styles.tnum} ${pnl === null ? styles.tableMuted : up ? styles.positive : styles.negative}`}>
                      {pnl === null ? "-" : `${up ? "+" : "-"}$${formatUnits(pnl < 0n ? -pnl : pnl, USDC_DECIMALS)}`}
                    </td>
                    <td>
                      <span className={styles.actionGroup}>
                        <button
                          className={styles.actionButton}
                          disabled={Boolean(busy)}
                          onClick={() => closePosition(packet)}
                        >
                          {busy === packet.positionId ? "Closing" : "Close"}
                        </button>
                        <a
                          href={`https://voyager.online/tx/${packet.openTx}`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.txLink}
                        >
                          <ExternalLink size={11} />view
                        </a>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className={styles.privateEmpty}>
            <EyeOff size={18} />
            <strong>No open positions</strong>
            <span>Open a shielded long or short from the order entry. Position economics never reach public state, so only positions opened in this browser session can be listed here.</span>
          </div>
        ))}

        {tab === "lookup" && (
          <div style={{ padding: 12 }}>
            <div className={styles.lookupRow}>
              <input
                value={positionId}
                onChange={(event) => setPositionId(event.target.value)}
                placeholder="0x position id"
                aria-label="Position id"
              />
              <button onClick={lookup} disabled={loading || !positionId.trim()}>
                {loading ? "Reading" : "Look up"}
              </button>
            </div>
            {lookupError && <p className={styles.errorText}>{lookupError}</p>}
            {position && (
              <div className={styles.positionResult}>
                <span>Status <b>{position.open ? "OPEN" : position.liquidated ? "LIQUIDATED" : position.exists ? "CLOSED" : "NOT FOUND"}</b></span>
                <span>Commitment <b className={styles.tnum}>{position.exists ? `${position.commitment.slice(0, 10)}...${position.commitment.slice(-6)}` : "-"}</b></span>
              </div>
            )}
            {!position && !lookupError && (
              <div className={styles.emptyPerp}>
                <LockKeyhole size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Any position id can be checked for its public lifecycle flags. The committed economics stay private.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default PerpDataPanel;
