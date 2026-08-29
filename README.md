# MarginGuard — Private Dark Pool & Perpetuals on Starknet

**Track:** Privacy DeFi · STRK20 Private Sprint
**Status:** Cairo contracts pass 115 tests and are deployed on Starknet mainnet. Spot STRK20
funding/order placement is the active product slice; perp collateral custody remains gated until
it is atomic with position opening.

A private spot **dark pool** and **perpetuals** venue on Starknet, built on STRK20 shielded
notes, with a registered agent that manages risk on each position — **the agent proposes, the
contract verifies, the contract enforces.** Who is trading is never revealed; what a resting
order was stays hidden until it trades.

> **On "circuit" vs "contract".** STRK20 proves *pool transactions* over a fixed action set and
> exposes no user-supplied circuit. Every guarantee in MarginGuard is therefore enforced by
> **Cairo contract logic**, not by an application circuit. This README says "contract" wherever
> an earlier draft said "circuit," deliberately.

---

## The problem

Public order books leak everything before a trade settles — size, direction, price impact.
STRK20 made private transfers, swaps, lending and staking native on Starknet, but there was no
private *matching* venue on it: no dark pool, no private perps on STRK20's shielded notes.
Separately, active risk management (dynamic margin, trailing exits, leverage adjustment) is
standard on public perps like Hyperliquid — but always over *fully visible* positions, because
the agent doing that work has to see the position to protect it. MarginGuard combines the two:
private positions, and an agent that manages them under a scoped, revocable grant.

## What it is

- **Spot dark pool** — hidden limit orders rest as Poseidon commitments, match at a
  contract-enforced midpoint, and settle into shielded STRK20 notes. With no opposing order, the
  design falls back to an Ekubo swap (unshield → swap → reshield) so a trade completes.
- **Perpetuals** — leveraged long/short (2x / 5x / 10x), with size, entry, margin, leverage and
  PnL shielded; settlement through shielded notes.
- **Agent risk layer** — the one agentic piece. For each open position the agent watches
  collateral health and proposes protective moves (add margin, trim size, lower leverage, close).
  Every proposal is a signed action the **contract** verifies against the position's real state
  and the agent's registered policy before it executes.

## How the agent sees a hidden position (the viewing-key delegation model)

Positions are hidden **from the public and from other market participants — not from the agent
that protects them.** This is a deliberate, documented trust boundary, the same shape as a
fraud-detection system seeing transactions the public cannot.

- STRK20's viewing system is built on **ECDH on the STARK curve** (the scheme it uses for
  channels and the auditor escrow). STRK20 documents two viewing paths — the owner's self-view
  and a single whole-key escrow to a governance-fixed **auditor** — but **no** native call for an
  owner to grant *a chosen third party* scoped view of *one* position.
- MarginGuard builds that grant at the **application level, on STRK20's own ECDH primitive** (no
  invented cryptography): the agent registers a viewing public key; when the owner opens a
  position, they ECDH-encrypt the position's viewing capability to the agent's key and record the
  grant on-chain (ephemeral pubkey + ciphertext, exactly like STRK20's channel/auditor records).
  The agent decrypts off-chain and computes health from the real numbers.
- The grant is **revocable**. The owner can revoke the agent's view, and the Privacy Center in
  the UI shows every active grant.

This is precisely **IDEA-21 (Selective disclosure tooling)** — an organizer-listed, no-warning
idea — built on STRK20's real primitive. It is documented throughout as an app-level
construction, never as a native STRK20 "delegate" call, because that call does not exist.

## Agent verification flow — propose, verify, enforce

1. The agent observes the position (via its granted viewing key, off-chain).
2. It creates and **signs** a proposal (STARK-curve signature).
3. The proposal is submitted on-chain.
4. The **contract** verifies: registered & active agent, valid signature over the exact proposal,
   the revealed position matches its commitment, the proposal is within the agent's policy, and
   the nonce is fresh — then **burns the nonce** so it can't be replayed.
5. The contract enforces the effect and re-commits the position under a fresh salt.

The agent supplies only a signature. It holds no funds, writes no state directly, and cannot
push a position past its policy — **a compromised agent key is survivable.**

## Public vs. shielded

| | |
| --- | --- |
| **Public** | Agent identity, action type, timestamp; order/position existence, matched/settled flags; the market (token pair); and — once a leg settles — the settlement amount (an open-note amount is plaintext by protocol). |
| **Shielded** (from the public and other traders; visible to the owner, and to the agent where granted) | Trade size, price; position size, margin, leverage, entry, PnL, liquidation threshold, exit triggers. |

The honest one-line claim: **who is trading is never revealed, and what a resting order was
stays hidden until it trades.** That is real pre-trade opacity — the definition of a dark pool.

## Live deployment (Starknet MAINNET)

The current full deployment uses the **Pragma STRK/USD oracle**. The earlier Ekubo oracle
deployment is retained in the address history but is not the frontend target.

| Contract | Mainnet address |
| --- | --- |
| AgentRegistry | `0x05b99dcb0d9995a112c1e12ea1695247a43811f586513027bb6d1057bc673e55` |
| PragmaOracle | `0x038d443ba8d1bc4dc914ff2aadf9acbd3c0785c376b66986c7e7520090f5c1af` |
| PerpEngine | `0x00aaa439cf40d1d535e7d58245443461fbff2ce7ed272b441cc09683a741354c` |
| OrderBook | `0x03cc0b36be4110edad405125c38b139907d6da371ab7661161265f29408b514c` |
| MarginGuardVenue | `0x01add9644c5c302745548a67fa65b173f71ecbe9a1ab1c3fcd12dd34515042f0` |
| STRK20 pool (pinned) | `0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

Full address + transaction list in [docs/ADDRESSES.md](docs/ADDRESSES.md). A prior full deploy is
also live on Sepolia (recorded there).

## How this maps to the sprint ideas

- **IDEA-07 · Confidential RFQ for block trades** — closest published match for the dark-pool
  matching engine (no warning).
- **IDEA-08 · Professional trading terminal** — the combined spot + perps + agent dashboard
  framing (no warning).
- **IDEA-21 · Selective disclosure tooling** — the owner→agent viewing grant (no warning).
- **IDEA-02 · Private perpetuals** — cited as *motivation* for the agent-verified risk layer,
  not as architecture (MarginGuard is a native venue, not an aggregator).

Deliberately **not** anchored to IDEA-04 or IDEA-06 — both carry the organizers'
"(not shipped yet: confidential compute)" warning.

## Honest limitations

Stated here and in [SECURITY_ASSUMPTIONS.md](docs/SECURITY_ASSUMPTIONS.md):

- **Open-note amounts are public.** Settlement amounts and PnL are plaintext by STRK20 design.
- **Reveal at action.** Matching, closing, liquidating and adjusting reveal the relevant values
  to the contract at that moment (no user circuit, C2). Pre-trade/pre-action they are shielded;
  ownership stays hidden throughout.
- **Exit triggers are not timing-attack resistant.** Stop-loss / take-profit trigger values are
  hidden from public view and other participants via the viewing-key mechanism — but an observer
  watching *when* the agent submits a close can still infer approximate trigger timing.
  Full protection would require confidential-compute infrastructure that does not yet exist on
  STRK20. This is described precisely as "hidden from public view and other market participants,"
  never as fully confidential.
- **Not audited.** A fund-holding anonymizer warrants an independent audit before real value.

## Repository

```
contracts/   Cairo contracts + tests (scarb build, scarb cairo-test — 115 tests)
scripts/     signature vectors, pool discovery, deploy (starkli + starknet.js)
src/         Next.js frontend, wired to the Sepolia deployment
docs/        ARCHITECTURE_REPORT · ARCHITECTURE · DEPLOYMENT · SECURITY_ASSUMPTIONS · ADDRESSES
```

Docs: [Architecture report (Phase 0)](docs/ARCHITECTURE_REPORT.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) ·
[Security assumptions](docs/SECURITY_ASSUMPTIONS.md) · [Addresses](docs/ADDRESSES.md)
