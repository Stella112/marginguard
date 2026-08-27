"use client";

import { useEffect, useState } from "react";
import { ec } from "starknet";
import styles from "./mg.module.css";
import SelectWallet from "./components/client/WalletHandle/SelectWallet";
import { useStoreWallet } from "./components/Wallet/walletContext";
import {
  MG,
  VOYAGER,
  SIDE_BUY,
  SIDE_SELL,
  orderCommitment,
  positionCommitment,
  traderCommitment,
  randomFelt,
  short,
  readProvider,
  readVenueStatus,
  readAgent,
  readViewGrant,
  grantRoundTrip,
  type VenueStatus,
  type AgentInfo,
  type ViewGrant,
} from "@/utils/marginguard";

function Addr({ a }: { a: string }) {
  return (
    <a className={styles.link} href={`${VOYAGER}${a}`} target="_blank" rel="noreferrer">
      <span className={styles.mono}>{short(a)}</span>
    </a>
  );
}

// ─── Live venue status ──────────────────────────────────────────────────────
function VenueStatusCard() {
  const [s, setS] = useState<VenueStatus | null>(null);
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    readVenueStatus().then(setS).catch((e) => setErr(String(e?.message ?? e)));
  }, []);
  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>Live on Starknet Sepolia</p>
      <div className={styles.row}>
        <span className={styles.label}>AgentRegistry</span>
        <Addr a={MG.agentRegistry} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>OrderBook</span>
        <Addr a={MG.orderBook} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>MarginGuardVenue</span>
        <Addr a={MG.venue} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>STRK20 pool (pinned)</span>
        <Addr a={MG.pool} />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Wiring verified</span>
        {err ? (
          <span className={styles.bad}>read error</span>
        ) : !s ? (
          <span className={styles.label}>checking…</span>
        ) : s.wired ? (
          <span className={styles.ok}>✓ book ↔ venue ↔ pool</span>
        ) : (
          <span className={styles.bad}>mismatch</span>
        )}
      </div>
      <p className={styles.note}>
        Read live from chain: the venue&apos;s pinned pool and the book&apos;s bound venue,
        confirming the deployment is wired end to end.
      </p>
    </div>
  );
}

// ─── Commitment Lab ─────────────────────────────────────────────────────────
type Mode = "spot" | "perp";

function CommitmentLab() {
  const [mode, setMode] = useState<Mode>("spot");

  // Spot
  const [side, setSide] = useState(SIDE_BUY);
  const [price, setPrice] = useState("1500");
  const [size, setSize] = useState("100");
  // Perp
  const [entry, setEntry] = useState("1500");
  const [margin, setMargin] = useState("500");
  const [lev, setLev] = useState(2);

  // Generated after mount so SSR and client agree (random in useState breaks hydration).
  const [salt, setSalt] = useState("");
  const [secret, setSecret] = useState("");
  useEffect(() => {
    setSalt(randomFelt());
    setSecret(randomFelt());
  }, []);

  let commit = "";
  try {
    if (!salt) commit = "generating…";
    else commit =
      mode === "spot"
        ? orderCommitment(side, BigInt(price || "0"), BigInt(size || "0"), salt)
        : positionCommitment(
            side,
            BigInt(size || "0"),
            BigInt(entry || "0"),
            BigInt(margin || "0"),
            lev,
            salt,
          );
  } catch {
    commit = "—";
  }
  const trader = secret ? traderCommitment(secret) : "generating…";

  return (
    <div className={`${styles.card} ${styles.cardWide}`}>
      <p className={styles.cardTitle}>Commitment Lab — what the chain actually sees</p>

      <div className={styles.seg}>
        <button
          className={`${styles.segBtn} ${mode === "spot" ? styles.segBtnOn : ""}`}
          onClick={() => setMode("spot")}
        >
          Spot order
        </button>
        <button
          className={`${styles.segBtn} ${mode === "perp" ? styles.segBtnOn : ""}`}
          onClick={() => setMode("perp")}
        >
          Perp position
        </button>
      </div>

      <div className={styles.split}>
        <div>
          <div className={styles.field}>
            <label>Side</label>
            <select
              className={styles.select}
              value={side}
              onChange={(e) => setSide(Number(e.target.value))}
            >
              <option value={SIDE_BUY}>{mode === "spot" ? "Buy" : "Long"}</option>
              <option value={SIDE_SELL}>{mode === "spot" ? "Sell" : "Short"}</option>
            </select>
          </div>
          {mode === "spot" ? (
            <div className={styles.inline}>
              <div className={styles.field}>
                <label>Limit price</label>
                <input className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Size</label>
                <input className={styles.input} value={size} onChange={(e) => setSize(e.target.value)} />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.inline}>
                <div className={styles.field}>
                  <label>Entry price</label>
                  <input className={styles.input} value={entry} onChange={(e) => setEntry(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Size</label>
                  <input className={styles.input} value={size} onChange={(e) => setSize(e.target.value)} />
                </div>
              </div>
              <div className={styles.inline}>
                <div className={styles.field}>
                  <label>Margin</label>
                  <input className={styles.input} value={margin} onChange={(e) => setMargin(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Leverage</label>
                  <select className={styles.select} value={lev} onChange={(e) => setLev(Number(e.target.value))}>
                    <option value={2}>2x</option>
                    <option value={5}>5x</option>
                    <option value={10}>10x</option>
                  </select>
                </div>
              </div>
            </>
          )}
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setSalt(randomFelt())}>
            ↻ new random salt
          </button>
        </div>

        <div className={styles.split} style={{ gridTemplateColumns: "1fr" }}>
          <div className={`${styles.panel} ${styles.panelHidden}`}>
            <div className={styles.panelHead}>🔒 Shielded — never on chain</div>
            {mode === "spot" ? (
              <>
                <div className={styles.kv}>
                  <span className={styles.label}>side</span>
                  <span className={styles.mono}>{side === SIDE_BUY ? "buy" : "sell"}</span>
                </div>
                <div className={styles.kv}>
                  <span className={styles.label}>price</span>
                  <span className={styles.mono}>{price}</span>
                </div>
                <div className={styles.kv}>
                  <span className={styles.label}>size</span>
                  <span className={styles.mono}>{size}</span>
                </div>
              </>
            ) : (
              <>
                <div className={styles.kv}>
                  <span className={styles.label}>side</span>
                  <span className={styles.mono}>{side === SIDE_BUY ? "long" : "short"}</span>
                </div>
                <div className={styles.kv}>
                  <span className={styles.label}>entry / size</span>
                  <span className={styles.mono}>{entry} / {size}</span>
                </div>
                <div className={styles.kv}>
                  <span className={styles.label}>margin / lev</span>
                  <span className={styles.mono}>{margin} / {lev}x</span>
                </div>
              </>
            )}
            <div className={styles.kv}>
              <span className={styles.label}>salt</span>
              <span className={styles.mono}>{short(salt)}</span>
            </div>
          </div>

          <div className={`${styles.panel} ${styles.panelPublic}`}>
            <div className={styles.panelHead}>🌐 Public — stored on chain</div>
            <div className={styles.kv}>
              <span className={styles.label}>trader commitment</span>
              <span className={styles.mono}>{short(trader)}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.label}>market</span>
              <span className={styles.mono}>STRK / USDC</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.label}>flags</span>
              <span className={styles.mono}>{mode === "spot" ? "live=1 matched=0" : "open=1"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.commitOut}>
        <div className={styles.label} style={{ marginBottom: 6 }}>
          {mode === "spot" ? "order" : "position"} commitment (this, and only this, is stored)
        </div>
        <span className={styles.mono}>{commit}</span>
      </div>
      <p className={styles.note}>
        Poseidon over domain-separated tags, computed here exactly as the Cairo contract computes
        it — a test cross-checks the two so they can never drift. Change any hidden value and the
        commitment changes completely; without the salt, the hidden values can&apos;t be recovered
        or guessed. This is the pre-trade opacity a dark pool provides.
      </p>
    </div>
  );
}

// ─── Agent Registry ─────────────────────────────────────────────────────────
function AgentPanel() {
  const isConnected = useStoreWallet((s) => s.isConnected);
  const address = useStoreWallet((s) => s.address);
  const myWalletAccount = useStoreWallet((s) => s.myWalletAccount);

  const [lookup, setLookup] = useState("");
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);

  async function doLookup(addr: string) {
    setStatus(null);
    setInfo(null);
    if (!addr) return;
    try {
      setBusy(true);
      setInfo(await readAgent(addr));
    } catch (e: unknown) {
      setStatus({ kind: "err", msg: `lookup failed: ${(e as Error)?.message ?? e}` });
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (!myWalletAccount) {
      setStatus({ kind: "err", msg: "connect a wallet first" });
      return;
    }
    try {
      setBusy(true);
      setStatus({ kind: "info", msg: "generating agent key and submitting…" });
      // Demo agent keypair, generated in-browser. In production the agent's key lives in its
      // own signing service; the registry only ever stores the public key.
      const pk = randomFelt();
      const pub = ec.starkCurve.getStarkKey(pk);
      // register_agent(public_key, policy{max_margin_bps, max_size_bps, max_leverage, may_close})
      const calldata = [pub, "5000", "3000", "5", "1"];
      const res = await myWalletAccount.execute([
        { contractAddress: MG.agentRegistry, entrypoint: "register_agent", calldata },
      ]);
      setStatus({ kind: "info", msg: `submitted ${short(res.transaction_hash)}, confirming…` });
      await readProvider().waitForTransaction(res.transaction_hash);
      setStatus({ kind: "ok", msg: "registered ✓ — look up your address below to see it live" });
      setLookup(address);
      await doLookup(address);
    } catch (e: unknown) {
      setStatus({ kind: "err", msg: `register failed: ${(e as Error)?.message ?? e}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>Agent Registry (live)</p>

      <div className={styles.field}>
        <label>Look up an agent address</label>
        <input
          className={styles.input}
          placeholder="0x…"
          value={lookup}
          onChange={(e) => setLookup(e.target.value.trim())}
        />
      </div>
      <button className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => doLookup(lookup)}>
        Look up
      </button>

      {info && (
        <div style={{ marginTop: 14 }}>
          <div className={styles.row}>
            <span className={styles.label}>registered</span>
            <span className={info.registered ? styles.ok : styles.bad}>
              {info.registered ? "yes" : "no"}
            </span>
          </div>
          {info.registered && (
            <>
              <div className={styles.row}>
                <span className={styles.label}>public key</span>
                <span className={styles.mono}>{short(info.publicKey)}</span>
              </div>
              <div className={styles.row}>
                <span className={styles.label}>next nonce</span>
                <span className={styles.mono}>{BigInt(info.nonce).toString()}</span>
              </div>
              {info.policy && (
                <div className={styles.row}>
                  <span className={styles.label}>policy</span>
                  <span className={styles.mono}>
                    ≤{info.policy.maxMarginIncreaseBps / 100}% margin · ≤
                    {info.policy.maxSizeReductionBps / 100}% cut · ≤{info.policy.maxLeverage}x ·{" "}
                    {info.policy.mayClose ? "may close" : "no close"}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 18, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16 }}>
        <button className={styles.btn} disabled={busy || !isConnected} onClick={register}>
          {isConnected ? "Register a demo agent (live tx)" : "Connect wallet to register"}
        </button>
        <p className={styles.note}>
          Registers a fresh agent under a policy capping it to ≤50% margin top-ups, ≤30% size
          cuts, ≤5x leverage, and closes. The registry stores only the public key and policy — the
          agent proposes, the contract verifies and enforces.
        </p>
      </div>

      {status && (
        <div
          className={`${styles.status} ${
            status.kind === "ok" ? styles.statusOk : status.kind === "err" ? styles.statusErr : styles.statusInfo
          }`}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

// ─── Privacy Center: viewing-key delegation ─────────────────────────────────
function PrivacyCenter() {
  // Client-side grant round-trip (real STARK-curve ECDH), regenerated on demand.
  const [agentPriv, setAgentPriv] = useState("");
  const [capability, setCapability] = useState("");
  useEffect(() => {
    setAgentPriv(randomFelt());
    setCapability(randomFelt());
  }, []);

  const demo = agentPriv && capability ? grantRoundTrip(capability, agentPriv) : null;

  // Live on-chain grant lookup.
  const [posId, setPosId] = useState("");
  const [grant, setGrant] = useState<ViewGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function lookup() {
    setErr("");
    setGrant(null);
    if (!posId) return;
    try {
      setBusy(true);
      setGrant(await readViewGrant(posId));
    } catch (e: unknown) {
      setErr(`lookup failed: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.card} ${styles.cardWide}`}>
      <p className={styles.cardTitle}>Privacy Center — viewing-key delegation (IDEA-21)</p>

      <p className={styles.note} style={{ marginTop: 0, marginBottom: 16 }}>
        Positions are hidden from the public and other traders — <strong>not</strong> from the
        agent that protects them. When you open a position you grant the agent a scoped, revocable
        view, using STRK20&apos;s own ECDH-on-the-STARK-curve scheme. The chain records only that a
        grant exists; the values stay off-chain. Below is that grant, computed live in your browser.
      </p>

      <div className={styles.split}>
        <div className={`${styles.panel} ${styles.panelHidden}`}>
          <div className={styles.panelHead}>🔒 Owner encrypts to the agent</div>
          <div className={styles.kv}>
            <span className={styles.label}>agent viewing key</span>
            <span className={styles.mono}>{short(demo?.agentPub ?? "")}</span>
          </div>
          <div className={styles.kv}>
            <span className={styles.label}>viewing capability</span>
            <span className={styles.mono}>{short(capability)}</span>
          </div>
          <div className={styles.kv}>
            <span className={styles.label}>ECDH shared secret</span>
            <span className={styles.mono}>{short(demo?.sharedX ?? "")}</span>
          </div>
        </div>

        <div className={`${styles.panel} ${styles.panelPublic}`}>
          <div className={styles.panelHead}>🌐 Grant record on chain</div>
          <div className={styles.kv}>
            <span className={styles.label}>ephemeral rG.x</span>
            <span className={styles.mono}>{short(demo?.ephemeralOnChain ?? "")}</span>
          </div>
          <div className={styles.kv}>
            <span className={styles.label}>ciphertext</span>
            <span className={styles.mono}>{short(demo?.ciphertext ?? "")}</span>
          </div>
          <div className={styles.kv}>
            <span className={styles.label}>agent recovers</span>
            <span className={demo?.ok ? styles.ok : styles.bad}>
              {demo ? (demo.ok ? "✓ exact capability" : "✗ mismatch") : "…"}
            </span>
          </div>
        </div>
      </div>

      <button
        className={`${styles.btn} ${styles.btnGhost}`}
        onClick={() => {
          setAgentPriv(randomFelt());
          setCapability(randomFelt());
        }}
      >
        ↻ regenerate grant
      </button>

      <p className={styles.note}>
        The public grant record reveals nothing: only the agent, holding its private viewing key,
        recovers the capability from the ephemeral point (recovered value equals the original,
        proven above). Anyone else sees two random field elements. On-chain,{" "}
        <span className={styles.mono}>PerpEngine.grant_view</span> stores this and{" "}
        <span className={styles.mono}>revoke_view</span> retires it — both owner-gated.
      </p>

      <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16 }}>
        <div className={styles.field}>
          <label>Look up a live grant by position id</label>
          <input
            className={styles.input}
            placeholder="e.g. 0x… position id"
            value={posId}
            onChange={(e) => setPosId(e.target.value.trim())}
          />
        </div>
        <button className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={lookup}>
          Look up grant
        </button>
        {grant && (
          <div style={{ marginTop: 12 }}>
            <div className={styles.row}>
              <span className={styles.label}>granted agent</span>
              <span className={styles.mono}>
                {BigInt(grant.agent) === 0n ? "none" : short(grant.agent)}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>status</span>
              <span className={grant.active ? styles.ok : styles.label}>
                {BigInt(grant.agent) === 0n ? "no grant" : grant.active ? "active" : "revoked"}
              </span>
            </div>
          </div>
        )}
        {err && <div className={`${styles.status} ${styles.statusErr}`}>{err}</div>}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.brand}>
          <span>
            Margin<span className={styles.brandMark}>Guard</span>
          </span>
          <span className={styles.brandTag}>private dark pool &amp; perps on STRK20</span>
        </div>
        <SelectWallet variant="nav" />
      </nav>

      <div className={styles.wrap}>
        <header className={styles.hero}>
          <h1 className={styles.heroTitle}>
            Trade in the dark.
            <br />
            <span className={styles.accent}>Verified in the open.</span>
          </h1>
          <p className={styles.heroSub}>
            A private spot dark pool and perpetuals venue on Starknet, built on STRK20 shielded
            notes. Who is trading is never revealed; what a resting order was stays hidden until it
            trades. An agent manages risk on positions hidden from the public and other traders —
            seeing only what the owner grants it, and every move verified by the contract before it
            executes.
          </p>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${styles.badgeLive}`}>● Live on Sepolia</span>
            <span className={styles.badge}>STRK20 anonymizer</span>
            <span className={styles.badge}>Agent-verified risk</span>
            <span className={styles.badge}>Cairo · 96 tests</span>
          </div>
        </header>

        <div className={styles.grid}>
          <VenueStatusCard />
          <AgentPanel />
          <CommitmentLab />
          <PrivacyCenter />

          <div className={`${styles.card} ${styles.cardWide}`}>
            <p className={styles.cardTitle}>How a private trade settles</p>
            <div className={styles.flow}>
              <span className={styles.step}>Fund (pool → venue balance)</span>
              <span className={styles.arrow}>→</span>
              <span className={styles.step}>Place (commitment only)</span>
              <span className={styles.arrow}>→</span>
              <span className={styles.step}>Match (reveal &amp; verify, midpoint)</span>
              <span className={styles.arrow}>→</span>
              <span className={styles.step}>Claim (open note)</span>
            </div>
            <p className={styles.note}>
              Funding is separate from placement because the pool&apos;s withdraw leg is a public
              transfer — funding inside the placing transaction would publish the order&apos;s size.
              Settlement is claim-driven because STRK20 permits at most one external invoke per pool
              transaction, so each side claims its own leg. Full detail in the repo&apos;s
              ARCHITECTURE.md.
            </p>
          </div>
        </div>

        <div className={styles.footer}>
          MarginGuard · STRK20 Private Sprint ·{" "}
          <a href="https://github.com/Stella112/marginguard" target="_blank" rel="noreferrer">
            github.com/Stella112/marginguard
          </a>
        </div>
      </div>
    </div>
  );
}
