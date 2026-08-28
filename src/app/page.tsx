"use client";

import { useEffect, useMemo, useState } from "react";
import { ec } from "starknet";
import s from "./terminal.module.css";
import SelectWallet from "./components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "./components/Wallet/walletContext";
import {
  MG,
  VOYAGER,
  SIDE_BUY,
  SIDE_SELL,
  positionCommitment,
  traderCommitment,
  randomFelt,
  short,
  readProvider,
  readVenueStatus,
  readMarkPrice,
  readAgent,
  readViewGrant,
  readPosition,
  grantRoundTrip,
  type VenueStatus,
  type AgentInfo,
  type ViewGrant,
  type PositionView,
} from "@/utils/marginguard";

const SCALE = 10n ** 18n;

/** Price with precision that adapts to magnitude (more decimals for sub-dollar assets). */
function fmtPrice(p: number): string {
  if (!p) return "—";
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

// ─── Synthetic candles (illustrative), ending at the live mark ──────────────
function candles(mark: number, n = 52) {
  let seed = 20260827;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: { o: number; h: number; l: number; c: number }[] = [];
  let price = mark * 0.94;
  for (let i = 0; i < n; i++) {
    const o = price;
    const drift = (mark - price) * 0.05;
    const c = o + drift + (rnd() - 0.48) * mark * 0.012;
    const h = Math.max(o, c) + rnd() * mark * 0.006;
    const l = Math.min(o, c) - rnd() * mark * 0.006;
    out.push({ o, h, l, c });
    price = c;
  }
  // pin the last close to the mark
  if (out.length) out[out.length - 1].c = mark;
  return out;
}

function Chart({ mark }: { mark: number }) {
  const data = useMemo(() => candles(mark), [mark]);
  const W = 800;
  const H = 360;
  const pad = 8;
  const lo = Math.min(...data.map((d) => d.l));
  const hi = Math.max(...data.map((d) => d.h));
  const y = (p: number) => pad + (1 - (p - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const cw = (W - 2 * pad) / data.length;
  return (
    <svg className={s.chartSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <line key={f} x1={0} x2={W} y1={pad + f * (H - 2 * pad)} y2={pad + f * (H - 2 * pad)} stroke="#1c242e" strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const x = pad + i * cw + cw / 2;
        const up = d.c >= d.o;
        const col = up ? "#16c784" : "#f6465d";
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={col} strokeWidth={1} />
            <rect
              x={x - cw * 0.3}
              width={cw * 0.6}
              y={Math.min(y(d.o), y(d.c))}
              height={Math.max(2, Math.abs(y(d.o) - y(d.c)))}
              fill={col}
            />
          </g>
        );
      })}
      <line x1={0} x2={W} y1={y(mark)} y2={y(mark)} stroke="#5b8def" strokeWidth={1} strokeDasharray="4 3" />
    </svg>
  );
}

// ─── Shielded order book (the dark-pool differentiator) ─────────────────────
function ShieldedBook({ mark }: { mark: number }) {
  const rows = (side: "ask" | "bid") =>
    Array.from({ length: 7 }).map((_, i) => {
      const depth = 30 + ((i * 37) % 60);
      return (
        <div key={i} className={`${s.bookRow} ${side === "ask" ? s.askRow : s.bidRow}`}>
          <span className={s.depth} style={{ width: `${depth}%` }} />
          <span className={s.bookHidden}>■ ■ ■ ■ ■</span>
          <span className={s.bookHidden}>shielded</span>
        </div>
      );
    });
  return (
    <div className={s.col}>
      <div className={s.panelHead}>
        <span>Shielded book</span>
        <span className={s.tag} style={{ background: "rgba(154,123,255,.16)", color: "#9a7bff" }}>DARK</span>
      </div>
      <div className={s.book}>
        <div className={s.bookRows}>
          {rows("ask")}
          <div className={s.bookMid}>
            <span className={s.up}>{fmtPrice(mark)}</span>
            <span className={s.muted} style={{ fontSize: 11, fontWeight: 400 }}>midpoint</span>
          </div>
          {rows("bid")}
        </div>
        <div className={s.bookExplain}>
          Every resting order is a Poseidon commitment — price and size are hidden until it trades.
          A match executes at the midpoint; ownership is never revealed. This is what a real dark
          pool looks like on-chain.
        </div>
      </div>
    </div>
  );
}

// ─── Trade panel ────────────────────────────────────────────────────────────
function TradePanel({ mark }: { mark: number }) {
  const isConnected = useStoreWallet((st) => st.isConnected);
  const [side, setSide] = useState(SIDE_BUY);
  const [size, setSize] = useState("100");
  const [lev, setLev] = useState(2);
  const [salt, setSalt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => setSalt(randomFelt()), []);

  const entry = mark || 1500;
  const sizeN = Number(size) || 0;
  const notional = sizeN * entry;
  const margin = lev > 0 ? notional / lev : 0;

  const commitment = salt
    ? positionCommitment(
        side,
        BigInt(Math.round(sizeN)),
        BigInt(Math.round(entry * 1e18)) * 1n,
        BigInt(Math.round(margin)),
        lev,
        salt,
      )
    : "…";

  return (
    <div className={s.col}>
      <div className={s.panelHead}>Open position</div>
      <div className={s.trade}>
        <div className={s.sideToggle}>
          <button className={`${s.sideBtn} ${s.sideLong} ${side === SIDE_BUY ? s.on : ""}`} onClick={() => setSide(SIDE_BUY)}>
            Long
          </button>
          <button className={`${s.sideBtn} ${s.sideShort} ${side === SIDE_SELL ? s.on : ""}`} onClick={() => setSide(SIDE_SELL)}>
            Short
          </button>
        </div>

        <div>
          <div className={s.tradeLabel}>
            <span>Size (STRK)</span>
            <span className={s.mono}>≈ ${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <input className={s.tradeInput} value={size} onChange={(e) => setSize(e.target.value)} />
        </div>

        <div>
          <div className={s.tradeLabel}><span>Leverage</span><span className={s.mono}>{lev}x</span></div>
          <div className={s.levRow}>
            {[2, 5, 10].map((l) => (
              <button key={l} className={`${s.levBtn} ${lev === l ? s.on : ""}`} onClick={() => setLev(l)}>
                {l}x
              </button>
            ))}
          </div>
        </div>

        <div className={s.privacyPreview}>
          <div className={`${s.previewRow} ${s.previewShielded}`}>
            <span className={s.previewLabel}><span className={s.lock}>🔒</span> entry / size / margin / lev</span>
            <span className={s.mono}>{fmtPrice(entry)} / {sizeN} / {margin.toFixed(2)} / {lev}x</span>
          </div>
          <div className={`${s.previewRow} ${s.previewShielded}`}>
            <span className={s.previewLabel}><span className={s.lock}>🔒</span> shielded — off chain</span>
            <span className={s.mono}>all of the above</span>
          </div>
          <div className={`${s.previewRow} ${s.previewPublic}`}>
            <span className={s.previewLabel}>🌐 stored on chain</span>
            <span className={s.mono}>{short(commitment)}</span>
          </div>
        </div>

        <button
          className={`${s.placeBtn} ${side === SIDE_BUY ? s.placeLong : s.placeShort}`}
          disabled={!isConnected}
          onClick={() =>
            setStatus(
              isConnected
                ? `Position commitment built (${short(commitment)}). Full shielded open routes through the STRK20 pool — wire your privacy wallet to submit.`
                : null,
            )
          }
        >
          {isConnected ? `${side === SIDE_BUY ? "Long" : "Short"} STRK ${lev}x` : "Connect wallet"}
        </button>

        {status && <div className={`${s.status} ${s.statusInfo}`}>{status}</div>}
        <p className={s.hint}>
          The commitment above is exactly what the contract stores — computed here with the same
          Poseidon scheme as the Cairo code. Change any input and it changes completely.
        </p>
      </div>
    </div>
  );
}

// ─── Bottom tabs ────────────────────────────────────────────────────────────
type Tab = "positions" | "agent" | "privacy" | "contracts";

function PositionsTab() {
  const [id, setId] = useState("");
  const [pos, setPos] = useState<PositionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function look() {
    setErr(""); setPos(null);
    if (!id) return;
    try { setBusy(true); setPos(await readPosition(id)); }
    catch (e: unknown) { setErr(`${(e as Error)?.message ?? e}`); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <p className={s.cardTitle}>Positions — look up by id</p>
      <div style={{ display: "flex", gap: 10, maxWidth: 560 }}>
        <input className={s.tradeInput} placeholder="0x… position id" value={id} onChange={(e) => setId(e.target.value.trim())} />
        <button className={`${s.btnSm} ${s.btnAccent}`} disabled={busy} onClick={look}>Look up</button>
      </div>
      {pos && !pos.exists && <div className={s.empty}>No position under that id.</div>}
      {pos && pos.exists && (
        <div style={{ maxWidth: 560, marginTop: 12 }}>
          <div className={s.row}><span className={s.muted}>status</span><span className={pos.open ? s.ok : s.muted}>{pos.liquidated ? "liquidated" : pos.open ? "open" : "closed"}</span></div>
          <div className={s.row}><span className={s.muted}>market</span><span className={s.mono}>{short(pos.baseToken)} / {short(pos.quoteToken)}</span></div>
          <div className={s.row}><span className={s.muted}>commitment</span><span className={s.mono}>{short(pos.commitment)}</span></div>
        </div>
      )}
      {err && <div className={`${s.status} ${s.statusErr}`}>{err}</div>}
      {!pos && !err && <div className={s.empty}>Positions rest as commitments — size, entry and PnL are shielded. Look one up by id.</div>}
    </div>
  );
}

function AgentTab() {
  const isConnected = useStoreWallet((st) => st.isConnected);
  const address = useStoreWallet((st) => st.address);
  const wa = useStoreWallet((st) => st.myWalletAccount);
  const [lookup, setLookup] = useState("");
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ k: string; m: string } | null>(null);

  async function look(a: string) {
    setStatus(null); setInfo(null);
    if (!a) return;
    try { setBusy(true); setInfo(await readAgent(a)); }
    catch (e: unknown) { setStatus({ k: "err", m: `${(e as Error)?.message ?? e}` }); }
    finally { setBusy(false); }
  }
  async function register() {
    if (!wa) { setStatus({ k: "err", m: "connect a wallet" }); return; }
    try {
      setBusy(true); setStatus({ k: "info", m: "submitting registration…" });
      const pub = ec.starkCurve.getStarkKey(randomFelt());
      const res = await wa.execute([{ contractAddress: MG.agentRegistry, entrypoint: "register_agent", calldata: [pub, "5000", "3000", "5", "1"] }]);
      setStatus({ k: "info", m: `submitted ${short(res.transaction_hash)}…` });
      await readProvider().waitForTransaction(res.transaction_hash);
      setStatus({ k: "ok", m: "registered ✓" });
      setLookup(address); await look(address);
    } catch (e: unknown) { setStatus({ k: "err", m: `${(e as Error)?.message ?? e}` }); }
    finally { setBusy(false); }
  }
  return (
    <div className={s.grid2}>
      <div>
        <p className={s.cardTitle}>Agent registry (live)</p>
        <div className={s.field} style={{ marginBottom: 10 }}>
          <label>Look up agent address</label>
          <input className={s.tradeInput} placeholder="0x…" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} />
        </div>
        <button className={s.btnSm} disabled={busy} onClick={() => look(lookup)}>Look up</button>
        {info && (
          <div style={{ marginTop: 12 }}>
            <div className={s.row}><span className={s.muted}>registered</span><span className={info.registered ? s.ok : s.bad}>{info.registered ? "yes" : "no"}</span></div>
            {info.registered && info.policy && (
              <>
                <div className={s.row}><span className={s.muted}>public key</span><span className={s.mono}>{short(info.publicKey)}</span></div>
                <div className={s.row}><span className={s.muted}>next nonce</span><span className={s.mono}>{BigInt(info.nonce).toString()}</span></div>
                <div className={s.row}><span className={s.muted}>policy</span><span className={s.mono}>≤{info.policy.maxMarginIncreaseBps / 100}% mgn · ≤{info.policy.maxSizeReductionBps / 100}% cut · ≤{info.policy.maxLeverage}x</span></div>
              </>
            )}
          </div>
        )}
      </div>
      <div>
        <p className={s.cardTitle}>The trust model</p>
        <p className={s.hint} style={{ marginBottom: 12 }}>
          The agent proposes; the contract verifies identity, signature, policy and nonce, then
          enforces. The agent holds no funds and no keys — a compromised agent key can only ever
          act within the policy you set.
        </p>
        <button className={`${s.btnSm} ${s.btnAccent}`} disabled={busy || !isConnected} onClick={register}>
          {isConnected ? "Register a demo agent (live tx)" : "Connect wallet to register"}
        </button>
        {status && <div className={`${s.status} ${status.k === "ok" ? s.statusOk : status.k === "err" ? s.statusErr : s.statusInfo}`}>{status.m}</div>}
      </div>
    </div>
  );
}

function PrivacyTab() {
  const [priv, setPriv] = useState("");
  const [cap, setCap] = useState("");
  useEffect(() => { setPriv(randomFelt()); setCap(randomFelt()); }, []);
  const demo = priv && cap ? grantRoundTrip(cap, priv) : null;

  const [posId, setPosId] = useState("");
  const [grant, setGrant] = useState<ViewGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function look() {
    setErr(""); setGrant(null);
    if (!posId) return;
    try { setBusy(true); setGrant(await readViewGrant(posId)); }
    catch (e: unknown) { setErr(`${(e as Error)?.message ?? e}`); }
    finally { setBusy(false); }
  }
  return (
    <div className={s.grid2}>
      <div>
        <p className={s.cardTitle}>Viewing-key delegation (IDEA-21)</p>
        <p className={s.hint} style={{ marginBottom: 12 }}>
          Positions are hidden from the public and other traders — not from the agent that
          protects them. The owner grants the agent a scoped, revocable view via real STARK-curve
          ECDH. Below: a live encrypt → recover round-trip.
        </p>
        <div className={s.privacyPreview}>
          <div className={`${s.previewRow} ${s.previewShielded}`}><span className={s.previewLabel}><span className={s.lock}>🔒</span> viewing capability</span><span className={s.mono}>{short(cap)}</span></div>
          <div className={`${s.previewRow} ${s.previewPublic}`}><span className={s.previewLabel}>🌐 ephemeral rG.x</span><span className={s.mono}>{short(demo?.ephemeralOnChain ?? "")}</span></div>
          <div className={`${s.previewRow} ${s.previewPublic}`}><span className={s.previewLabel}>🌐 ciphertext</span><span className={s.mono}>{short(demo?.ciphertext ?? "")}</span></div>
          <div className={`${s.previewRow} ${s.previewShielded}`}><span className={s.previewLabel}>agent recovers</span><span className={demo?.ok ? s.ok : s.bad}>{demo ? (demo.ok ? "✓ exact capability" : "✗") : "…"}</span></div>
        </div>
        <button className={s.btnSm} style={{ marginTop: 10 }} onClick={() => { setPriv(randomFelt()); setCap(randomFelt()); }}>↻ regenerate</button>
      </div>
      <div>
        <p className={s.cardTitle}>Live grant lookup</p>
        <div className={s.field} style={{ marginBottom: 10 }}>
          <label>Position id</label>
          <input className={s.tradeInput} placeholder="0x…" value={posId} onChange={(e) => setPosId(e.target.value.trim())} />
        </div>
        <button className={s.btnSm} disabled={busy} onClick={look}>Look up grant</button>
        {grant && (
          <div style={{ marginTop: 12 }}>
            <div className={s.row}><span className={s.muted}>granted agent</span><span className={s.mono}>{BigInt(grant.agent) === 0n ? "none" : short(grant.agent)}</span></div>
            <div className={s.row}><span className={s.muted}>status</span><span className={grant.active ? s.ok : s.muted}>{BigInt(grant.agent) === 0n ? "no grant" : grant.active ? "active" : "revoked"}</span></div>
          </div>
        )}
        {err && <div className={`${s.status} ${s.statusErr}`}>{err}</div>}
      </div>
    </div>
  );
}

function ContractsTab({ status }: { status: VenueStatus | null }) {
  const rows: [string, string][] = [
    ["AgentRegistry", MG.agentRegistry],
    ["PerpEngine", MG.perpEngine],
    ["OrderBook", MG.orderBook],
    ["MarginGuardVenue", MG.venue],
    ["ManualOracle", MG.oracle],
    ["STRK20 pool", MG.pool],
  ];
  return (
    <div>
      <p className={s.cardTitle}>Live on Starknet Mainnet</p>
      <div style={{ maxWidth: 640 }}>
        {rows.map(([n, a]) => (
          <div className={s.row} key={n}>
            <span className={s.muted}>{n}</span>
            <a className={`${s.link} ${s.mono}`} href={`${VOYAGER}${a}`} target="_blank" rel="noreferrer">{short(a)}</a>
          </div>
        ))}
        <div className={s.row}>
          <span className={s.muted}>wiring</span>
          <span className={status ? (status.wired ? s.ok : s.bad) : s.muted}>{status ? (status.wired ? "✓ book ↔ venue ↔ pool" : "mismatch") : "checking…"}</span>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [mark, setMark] = useState(0);
  const [status, setStatus] = useState<VenueStatus | null>(null);
  const [tab, setTab] = useState<Tab>("positions");

  useEffect(() => {
    readMarkPrice().then(setMark).catch(() => setMark(1500));
    readVenueStatus().then(setStatus).catch(() => {});
  }, []);

  const change = 2.34; // illustrative 24h

  return (
    <div className={s.app}>
      <div className={s.topbar}>
        <div className={s.brand}>
          <span className={s.brandDot} />
          Margin<span className={s.brandMark}>Guard</span>
        </div>
        <div className={s.market}>
          <span className={s.marketPair}>STRK-USDC</span>
          <span className={s.tag}>PERP</span>
          <span className={`${s.tag} ${s.tagPrivate}`}>PRIVATE</span>
        </div>
        <div className={s.spacer} />
        <div className={s.netpill}><span className={s.netLive} /> Mainnet · live</div>
        <SelectWallet variant="nav" />
      </div>

      <div className={s.stats}>
        <div className={s.stat}>
          <span className={s.statLabel}>Mark (oracle)</span>
          <span className={`${s.statValue} ${s.markBig} ${s.mono} ${s.up}`}>{fmtPrice(mark)}</span>
        </div>
        <div className={s.stat}><span className={s.statLabel}>24h</span><span className={`${s.statValue} ${s.mono} ${s.up}`}>+{change}%</span></div>
        <div className={s.stat}><span className={s.statLabel}>Maint. margin</span><span className={`${s.statValue} ${s.mono}`}>50%</span></div>
        <div className={s.stat}><span className={s.statLabel}>Max leverage</span><span className={`${s.statValue} ${s.mono}`}>10x</span></div>
        <div className={s.stat}><span className={s.statLabel}>Settlement</span><span className={`${s.statValue} ${s.mono}`}>shielded notes</span></div>
        <div className={s.stat}><span className={s.statLabel}>Venue</span><span className={`${s.statValue} ${s.mono} ${status?.wired ? s.up : ""}`}>{status ? (status.wired ? "wired ✓" : "—") : "…"}</span></div>
      </div>

      <div className={s.grid}>
        <div className={s.col}>
          <div className={s.panelHead}><span>STRK-USDC · chart</span><span className={s.muted} style={{ textTransform: "none", fontWeight: 400 }}>illustrative</span></div>
          <div className={s.chartWrap}>
            <Chart mark={mark || 1500} />
            <div className={s.chartNote}>Blue line = live oracle mark. Candles illustrative (no public trade tape — orders are shielded).</div>
          </div>
        </div>
        <ShieldedBook mark={mark || 1500} />
        <TradePanel mark={mark} />
      </div>

      <div className={s.bottom}>
        <div className={s.tabBar}>
          {(["positions", "agent", "privacy", "contracts"] as Tab[]).map((t) => (
            <button key={t} className={`${s.tab} ${tab === t ? s.on : ""}`} onClick={() => setTab(t)}>
              {t === "positions" ? "Positions" : t === "agent" ? "Agent" : t === "privacy" ? "Privacy" : "Contracts"}
            </button>
          ))}
        </div>
        <div className={s.tabBody}>
          {tab === "positions" && <PositionsTab />}
          {tab === "agent" && <AgentTab />}
          {tab === "privacy" && <PrivacyTab />}
          {tab === "contracts" && <ContractsTab status={status} />}
        </div>
      </div>
    </div>
  );
}
