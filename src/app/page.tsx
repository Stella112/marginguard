"use client";

import { motion } from "motion/react";
import c from "./landing.module.css";
import { MG, VOYAGER } from "@/utils/marginguard";

const fadeUp = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
};

export default function Landing() {
  return (
    <div className={c.page}>
      <nav className={c.nav}>
        <div className={c.brand}>
          <span className={c.brandDot} />
          Margin<span className={c.brandMark}>Guard</span>
        </div>
        <div className={c.navCenter}>
          <a className={c.navLink} href="#protocol">Protocol</a>
          <a className={c.navLink} href="#privacy">Privacy</a>
          <a className={c.navLink} href="#security">Security</a>
        </div>
        <div className={c.navRight}>
          <a className={c.navLink} href="https://github.com/Stella112/marginguard" target="_blank" rel="noreferrer">GitHub</a>
          <a className={c.navCta} href="/trade">Launch Terminal</a>
        </div>
      </nav>

      {/* Hero */}
      <header className={c.hero}>
        <div className={c.heroGrid}>
          <div className={c.heroCopy}>
            <motion.div className={c.livePill} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <span className={c.liveDot} /> Starknet mainnet · SN_MAIN
            </motion.div>

            <motion.h1 className={c.h1} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}>
              Trade without
              <br />
              <span className={c.accent}>showing your hand.</span>
            </motion.h1>

            <motion.p className={c.sub} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.35 }}>
              A private spot and perpetuals venue for Starknet. STRK20 shields the settlement;
              Cairo verifies every action that can touch your position.
            </motion.p>

            <motion.div className={c.heroCtas} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.5 }}>
              <a className={c.btnPrimary} href="/trade">Launch Terminal</a>
              <a className={c.btnGhost} href="#protocol">Explore the protocol</a>
            </motion.div>
          </div>

          <motion.div className={c.heroFrame} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.25 }}>
            <div className={c.frameHeader}><span>PRIVATE EXECUTION</span><span className={c.frameLive}><span className={c.liveDot} /> LIVE</span></div>
            <div className={c.frameMain}>
              <div className={c.frameKicker}>ORDER STATE</div>
              <div className={c.frameTitle}>COMMITTED</div>
              <div className={`${c.frameHash} ${c.mono}`}>0x2170c88c228d…a4ec41a</div>
              <div className={c.frameRule} />
              <div className={c.frameRows}>
                <div><span>market</span><b>STRK / USDC</b></div>
                <div><span>terms</span><b className={c.framePrivate}>shielded</b></div>
                <div><span>settlement</span><b>STRK20 note</b></div>
              </div>
            </div>
            <div className={c.frameFooter}><span>Poseidon commitment</span><span className={c.mono}>verified</span></div>
          </motion.div>
        </div>
      </header>

      <div className={c.proofStrip}>
        <div><span>01</span><b>Private matching</b><small>Orders reveal only when matched.</small></div>
        <div><span>02</span><b>Shielded settlement</b><small>Native STRK20 notes.</small></div>
        <div><span>03</span><b>Verified risk</b><small>Agent actions gated in Cairo.</small></div>
        <div><span>04</span><b>Starknet mainnet</b><small>SN_MAIN · non-custodial.</small></div>
      </div>

      {/* Problem */}
      <section className={c.section} id="protocol">
        <motion.div {...fadeUp}>
          <div className={c.kicker}>The problem</div>
          <h2 className={c.h2}>On a public order book, everyone sees your hand before you play it.</h2>
          <p className={c.lead}>
            Size, direction, price impact — all visible in the mempool before a trade settles.
            The trades that most need discretion are exactly the ones a transparent book punishes.
            STRK20 made transfers private on Starknet; MarginGuard makes <em>matching</em> private.
          </p>
        </motion.div>
      </section>

      {/* Dark pool — commitment transform */}
      <section className={c.section}>
        <motion.div {...fadeUp}>
          <div className={c.kicker}>The dark pool</div>
          <h2 className={c.h2}>Your order becomes a single hash. The rest stays yours.</h2>
          <p className={c.lead}>
            Price and size are folded into one Poseidon commitment. Only that reaches the chain — it
            reveals nothing and can&apos;t be guessed. Orders match at a contract-enforced midpoint,
            settling into shielded notes. No one front-runs what they can&apos;t see.
          </p>
        </motion.div>
        <motion.div className={c.transform} {...fadeUp}>
          <div className={c.plain}>
            <span className={c.chip}>SIDE / BUY</span>
            <span className={c.chip}>PRICE / 0.0246</span>
            <span className={c.chip}>SIZE / 10,000</span>
          </div>
          <span className={c.arrowBig}>TO COMMITMENT</span>
          <div className={`${c.hashOut} ${c.mono}`}>0x2170c88c228d5f16362ea596c1f417c7bb16acd061fbd4bd96089392a4ec41a</div>
        </motion.div>
      </section>

      {/* Two products */}
      <section className={c.section}>
        <motion.div {...fadeUp}>
          <div className={c.kicker}>Two products, one privacy pool</div>
          <h2 className={c.h2}>Spot and perps, both shielded to the same core.</h2>
        </motion.div>
        <div className={c.cards}>
          {[
            { title: "Spot dark pool", text: "Hidden limit orders, matched at a private midpoint, settled into shielded STRK20 notes. Deposit once, trade many — funding never links to an order." },
            { title: "Private perpetuals", text: "Leveraged long/short at 2x, 5x, 10x. Size, entry, margin, PnL and liquidation thresholds all shielded. Liquidations gated on a live Pragma oracle." },
            { title: "Agent-verified risk", text: "A registered agent watches each position and proposes protective moves — but the contract verifies identity, signature, policy and state before anything executes." },
          ].map((x, i) => (
            <motion.div key={x.title} className={c.card} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.1 }}>
              <div className={c.cardIcon} aria-hidden="true" />
              <div className={c.cardTitle}>{x.title}</div>
              <div className={c.cardText}>{x.text}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Agent flow */}
      <section className={c.section} id="privacy">
        <motion.div {...fadeUp}>
          <div className={c.kicker}>The trust model</div>
          <h2 className={c.h2}>The agent proposes. The contract verifies. The contract enforces.</h2>
          <p className={c.lead}>
            Active risk management usually means handing an agent control over a visible position.
            Here the agent has zero authority — it only signs a suggestion. A stolen agent key can
            never do more than the policy you set.
          </p>
        </motion.div>
        <div className={c.flow}>
          {[
            { n: "01", t: "Observe", d: "The agent reads your position through a scoped viewing key you granted — hidden from the public, not from the agent protecting it." },
            { n: "02", t: "Propose & sign", d: "It signs a protective move: add margin, trim size, lower leverage, close. Just a signature — no funds, no state." },
            { n: "03", t: "Verify & enforce", d: "The contract checks identity, signature, policy and the real position, burns the nonce, then executes. It is the final authority." },
          ].map((x, i) => (
            <motion.div key={x.n} className={c.step} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.12 }}>
              <div className={c.stepNum}>{x.n}</div>
              <div className={c.stepTitle}>{x.t}</div>
              <div className={c.stepText}>{x.d}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Viewing key */}
      <section className={c.section} id="security">
        <motion.div {...fadeUp}>
          <div className={c.kicker}>Selective disclosure · IDEA-21</div>
          <h2 className={c.h2}>Hidden from the market. Visible to the guardian you choose.</h2>
          <p className={c.lead}>
            When you open a position you grant the agent a scoped, revocable view using STRK20&apos;s
            own ECDH scheme — real cryptography, not a mock. The chain records only that a grant
            exists; the values stay off-chain. Revoke it any time. It&apos;s a documented trust
            boundary, not a privacy hole.
          </p>
        </motion.div>
      </section>

      {/* Live on mainnet */}
      <section className={c.section}>
        <motion.div {...fadeUp}>
          <div className={c.kicker}>Live &amp; verified</div>
          <h2 className={c.h2}>Deployed on Starknet mainnet. Every binding checked on-chain.</h2>
          <p className={c.lead}>
            Not a testnet demo. Five contracts live, wired, and reading a real Pragma price — with
            96 Cairo tests behind them and honest docs about what is and isn&apos;t private.
          </p>
        </motion.div>
        <div className={c.contracts}>
          {[
            ["AgentRegistry", MG.agentRegistry],
            ["PragmaOracle", MG.oracle],
            ["PerpEngine", MG.perpEngine],
            ["OrderBook", MG.orderBook],
            ["MarginGuardVenue", MG.venue],
          ].map(([n, a], i) => (
            <motion.div key={n} className={c.contractRow} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.06 }}>
              <span className={c.contractName}>{n}</span>
              <a className={`${c.contractAddr} ${c.mono}`} href={`${VOYAGER}${a}`} target="_blank" rel="noreferrer">
                {`${a.slice(0, 10)}…${a.slice(-6)}`}
              </a>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className={c.finalCta}>
        <motion.div className={`${c.orb} ${c.orb2}`} style={{ left: "50%", transform: "translateX(-50%)", bottom: -200 }} animate={{ opacity: [0.35, 0.55, 0.35] }} transition={{ duration: 8, repeat: Infinity }} />
        <motion.div className={c.finalInner} {...fadeUp}>
          <h2 className={c.h2} style={{ margin: "0 auto", textAlign: "center" }}>Step into the dark pool.</h2>
          <p className={c.lead} style={{ margin: "18px auto 30px", textAlign: "center" }}>
            Build a real order, watch it become a commitment, and see the agent verification flow —
            all against the live mainnet contracts.
          </p>
          <div className={c.heroCtas} style={{ justifyContent: "center" }}>
            <a className={c.btnPrimary} href="/trade">Launch Terminal</a>
            <a className={c.btnGhost} href="https://github.com/Stella112/marginguard" target="_blank" rel="noreferrer">Read the code</a>
          </div>
        </motion.div>
      </section>

      <footer className={c.footer}>
        MarginGuard · STRK20 Private Sprint ·{" "}
        <a href="https://github.com/Stella112/marginguard" target="_blank" rel="noreferrer">github.com/Stella112/marginguard</a>
      </footer>
    </div>
  );
}
