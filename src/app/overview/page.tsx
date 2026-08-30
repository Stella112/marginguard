"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import AppShell from "@/components/dex/AppShell";
import { SPOT_MARKETS } from "@/utils/marginguard";
import { useStoreWallet } from "@/app/components/Wallet/walletContext";
import styles from "@/app/terminal.module.css";

type Balance = { asset: string; amount: string; raw: bigint };

const formatUnits = (raw: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = raw % base;
  if (!fraction) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "")}`;
};

function labelForToken(token: string) {
  try {
    const match = SPOT_MARKETS.find((market) => BigInt(market.baseToken) === BigInt(token));
    return match ? { asset: match.symbol, decimals: match.baseDecimals } : { asset: "Token", decimals: 18 };
  } catch { return { asset: "Token", decimals: 18 }; }
}

function Metric({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return <div className={styles.metric}><div className={styles.metricTop}><span>{label}</span><span className={styles.metricIcon}>{icon}</span></div><div className={styles.metricValue}>{value}</div><div className={styles.metricSub}>{sub}</div></div>;
}

function Toggle({ on, title, copy }: { on: boolean; title: string; copy: string }) {
  return <div className={styles.agentRow}><div><div className={styles.agentRowTitle}>{title}</div><div className={styles.agentRowCopy}>{copy}</div></div><button aria-pressed={on} disabled className={`${styles.toggle} ${on ? styles.toggleOn : styles.toggleOff}`}><span className={styles.toggleKnob} /></button></div>;
}

export default function OverviewPage() {
  const account = useStoreWallet((state) => state.myWalletAccount);
  const connected = useStoreWallet((state) => state.isConnected);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [balanceError, setBalanceError] = useState("");

  useEffect(() => {
    if (!connected || !account) { setBalances(null); return; }
    let active = true;
    setBalanceError("");
    // Scope the request to the tokens this venue actually trades. Passing [] asks the wallet
    // to disclose *every* private balance it holds, which is what triggered Ready's
    // "share all private balances" consent prompt.
    const tokens = Array.from(new Set(
      SPOT_MARKETS.flatMap((m) => [m.baseToken, m.quoteToken]).filter((t) => t && t !== "0x0"),
    ));
    account.strk20Balances(tokens).then((raw: unknown) => {
      const rows = (raw as { value?: unknown })?.value ?? raw;
      if (!Array.isArray(rows)) throw new Error("Unexpected shielded balance response");
      const next = rows.map((row: any) => {
        const token = String(row?.token ?? row?.token_address ?? row?.[0]);
        const rawAmount = BigInt(row?.balance ?? row?.amount ?? row?.[1] ?? 0);
        const meta = labelForToken(token);
        return { asset: meta.asset, amount: formatUnits(rawAmount, meta.decimals), raw: rawAmount };
      });
      if (active) setBalances(next);
    }).catch((error: unknown) => { if (active) { setBalances([]); setBalanceError(error instanceof Error ? error.message : String(error)); } });
    return () => { active = false; };
  }, [account, connected]);

  const allocation = useMemo(() => {
    const total = (balances ?? []).reduce((sum, balance) => sum + balance.raw, 0n);
    return (balances ?? []).map((balance, index) => ({
      name: balance.asset,
      value: total > 0n ? Number((balance.raw * 1_000_000n) / total) / 1_000_000 : 0,
      color: ["#00e5ff", "#9d4edd", "#3b82f6", "#f45b69"][index % 4],
    }));
  }, [balances]);
  const address = account?.address ? `${account.address.slice(0, 8)}…${account.address.slice(-6)}` : "wallet not connected";

  return <AppShell><div className={styles.overview}><div className={styles.overviewInner}>
    <div className={styles.overviewHeader}><div><div className={styles.eyebrow}>Account / private risk surface</div><h1 className={styles.overviewTitle}>Portfolio overview</h1><p className={styles.overviewDescription}>Read-only balances from your privacy-enabled wallet. Position economics remain private commitments.</p></div><div className={styles.overviewAddress}>{address}</div></div>
    <div className={styles.metricGrid}><Metric label="Net shielded value" value="—" sub={connected ? "Value feed not configured" : "Connect wallet to load"} icon={<LockKeyhole size={15} />} /><Metric label="Free collateral" value="—" sub="Not exposed by public chain state" icon={<WalletCards size={15} />} /><Metric label="Initial margin requirement" value="—" sub="Loaded from position view, not indexed" icon={<AlertTriangle size={15} />} /></div>

    <div className={styles.overviewGrid}><section className={styles.allocation}><div className={styles.sectionTitle}>Shielded allocation</div><div className={styles.sectionSub}>Derived from the wallet’s private balance response.</div><div className={styles.donut}>{allocation.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={allocation} dataKey="value" innerRadius={68} outerRadius={96} paddingAngle={2} stroke="none">{allocation.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer> : <div className={styles.privateEmpty}><LockKeyhole size={16} /><strong>{connected ? "No shielded balances" : "Wallet not connected"}</strong><span>{balanceError || "Connect a privacy-enabled Starknet wallet to read notes."}</span></div>}<div className={styles.donutCenter}><span className={styles.donutLabel}>Assets</span><span className={styles.donutValue}>{balances?.length ?? "—"}</span></div></div><div className={styles.legend}>{allocation.map((item) => <div key={item.name} className={styles.legendRow}><span className={styles.legendSwatch} style={{ background: item.color }} /><span>{item.name}</span><strong>loaded</strong></div>)}</div></section>

      <div className={styles.overviewTables}><section className={styles.tablePanel}><div className={styles.tablePanelHeader}><span className={styles.sectionTitle}>Shielded spot balances</span><span className={styles.panelBadge}>WALLET READ</span></div><table className={styles.table}><thead><tr><th>Asset</th><th>Balance</th><th>Value</th><th>Source</th></tr></thead><tbody>{balances?.length ? balances.map((balance) => <tr key={balance.asset}><td className={styles.tableStrong}>{balance.asset}</td><td className={styles.tnum}>{balance.amount}</td><td className={styles.tnum}>—</td><td className={styles.tableMuted}>STRK20 wallet</td></tr>) : <tr><td colSpan={4} className={styles.emptyCell}>{connected ? "No shielded notes returned by the wallet." : "Connect wallet to read shielded balances."}</td></tr>}</tbody></table></section>
      <section className={styles.tablePanel}><div className={styles.tablePanelHeader}><span className={styles.sectionTitle}>Private perp positions</span><span className={styles.panelBadge}>COMMITMENTS ONLY</span></div><table className={styles.table}><thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Status</th></tr></thead><tbody><tr><td colSpan={5} className={styles.emptyCell}>Positions are not publicly enumerable. Look up a known position commitment to inspect its lifecycle.</td></tr></tbody></table></section></div></div>

    <section className={styles.agentPanel}><div className={styles.agentHeader}><ShieldCheck size={15} /> Agent risk configuration</div><p className={styles.agentCopy}><strong>Agent proposes. Contract verifies.</strong> The guardian worker is not connected in this build, so these controls are shown as inactive and cannot imply live risk automation.</p><div className={styles.agentRows}><Toggle on={false} title="Auto-margin adjustment" copy="Inactive — no position feed or executor worker connected." /><Toggle on={false} title="Auto-deleverage" copy="Inactive — enable only after the signed executor is deployed." /></div></section>
  </div></div></AppShell>;
}
