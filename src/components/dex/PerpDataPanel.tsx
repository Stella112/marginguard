"use client";

import { useEffect, useState } from "react";
import { ExternalLink, EyeOff, GitMerge, LockKeyhole, Search } from "lucide-react";
import { num } from "starknet";
import { MG, readPosition, readProvider, scanPositions, type PositionView } from "@/utils/marginguard";
import { derivePosition, unlockSeed } from "@/utils/keyvault";
import {
  PERP_EVENT,
  riskOf as sharedRiskOf,
  STRK_DECIMALS,
  USDC_DECIMALS,
  formatUnits,
  formatUsd,
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
      // Re-derive the secret from the wallet rather than reading a stored one.
      setNotice("Sign to derive your trading keys, then confirm the close.");
      const seed = await unlockSeed(account);
      const { ownerSecret, salt } = derivePosition(seed, packet.index);
      setNotice("Confirm the close. The committed economics are revealed to the contract only now, so it can verify and settle.");
      const result = await account.execute([{
        contractAddress: MG.perpEngine,
        entrypoint: "close_position",
        calldata: [
          packet.positionId,
          ownerSecret,
          num.toHex(packet.side),
          num.toHex(BigInt(packet.size)),
          num.toHex(BigInt(packet.entryPrice)),
          num.toHex(BigInt(packet.margin)),
          num.toHex(packet.leverage),
          salt,
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


  /**
   * Backup and restore for the local economics cache.
   *
   * Secrets are derived from the wallet now, so this file holds nothing spendable - but the
   * committed economics still cannot be recomputed, and `close_position` needs them. A file
   * the user keeps is the difference between a recoverable browser and a stranded position.
   */
  function exportBackup() {
    const blob = new Blob([JSON.stringify(readPackets(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `marginguard-positions-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Backup saved. Keep it: without these figures a position cannot be closed.");
  }

  function importBackup(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error("That file is not a MarginGuard backup.");
        const byId = new Map<string, PerpPacket>();
        for (const item of [...readPackets(), ...parsed as PerpPacket[]]) byId.set(item.positionId, item);
        writePackets([...byId.values()]);
        setNotice(`Restored ${parsed.length} position${parsed.length === 1 ? "" : "s"} from backup.`);
      } catch (error: any) {
        setNotice(error?.message ?? "That file could not be read.");
      }
    };
    reader.readAsText(file);
  }

  /** Rebuilds the list of on-chain positions from the wallet alone, with no local state. */
  async function checkChain() {
    if (!account || !connected) { setNotice("Connect a wallet to check the chain."); return; }
    try {
      setBusy("scan");
      setNotice("Sign to derive your trading keys, then the chain is scanned for your positions.");
      const seed = await unlockSeed(account);
      const found = await scanPositions(seed);
      const open = found.filter((item) => item.open);
      const known = new Set(readPackets().map((item) => item.positionId));
      const missing = open.filter((item) => !known.has(item.positionId));
      setNotice(
        found.length === 0
          ? "No positions found on-chain for this wallet."
          : `${found.length} position${found.length === 1 ? "" : "s"} on-chain, ${open.length} still open` +
            (missing.length
              ? `. ${missing.length} not in this browser - restore a backup to close ${missing.length === 1 ? "it" : "them"}.`
              : ". All are listed here."),
      );
    } catch (error: any) {
      setNotice(error?.message ?? String(error));
    } finally {
      setBusy("");
    }
  }

  const riskOf = (packet: PerpPacket) => (mark ? sharedRiskOf(packet, mark) : null);

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

      <div style={{ display: "flex", gap: 6, padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {[
          { label: "Check chain", onClick: checkChain },
          { label: "Back up", onClick: exportBackup },
        ].map((action) => (
          <button key={action.label} type="button" onClick={action.onClick} disabled={busy === "scan"}
            style={{ padding: "4px 9px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.16)", background: "transparent", color: "rgba(255,255,255,0.7)" }}>
            {busy === "scan" && action.label === "Check chain" ? "Scanning" : action.label}
          </button>
        ))}
        <label style={{ padding: "4px 9px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer",
          border: "1px solid rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.7)" }}>
          Restore
          <input type="file" accept="application/json" style={{ display: "none" }}
            onChange={(event) => { const f = event.target.files?.[0]; if (f) importBackup(f); event.target.value = ""; }} />
        </label>
      </div>

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
                const risk = riskOf(packet);
                const pnl = risk?.pnl ?? null;
                const up = pnl !== null && pnl >= 0n;
                return (
                  <tr key={packet.positionId}>
                    <td className={packet.side === SIDE_LONG ? styles.sideLong : styles.sideShort}>
                      {packet.side === SIDE_LONG ? "LONG" : "SHORT"}
                      {risk?.liquidatable && (
                        <span title="Equity is below the 50% maintenance threshold; this position can be liquidated by anyone."
                          style={{ marginLeft: 5, padding: "1px 4px", borderRadius: 3, fontSize: 9,
                            background: "rgba(244,91,105,0.18)", color: "#f45b69" }}>LIQ</span>
                      )}
                    </td>
                    <td className={styles.tnum}>{formatUnits(BigInt(packet.size), STRK_DECIMALS)}</td>
                    <td className={styles.tnum}>{packet.leverage}x</td>
                    <td className={styles.tnum}>${formatUnits(BigInt(packet.entryPrice), USDC_DECIMALS, 5)}</td>
                    <td className={styles.tnum}>{formatUsd(BigInt(packet.margin))}</td>
                    <td className={`${styles.tnum} ${pnl === null ? styles.tableMuted : up ? styles.positive : styles.negative}`}>
                      {pnl === null ? "-" : `${up ? "+" : ""}${formatUsd(pnl)}`}
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
