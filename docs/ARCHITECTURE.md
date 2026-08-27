# MarginGuard Architecture

MarginGuard is a privacy-preserving trading venue on Starknet built on STRK20 shielded notes.
It has two products — a spot dark pool and private perpetuals — plus an agent risk layer that
adjusts live positions under contract-enforced verification.

This document describes how the contracts fit together and why the design takes the shape it
does. The forces that shaped it are recorded in [ARCHITECTURE_REPORT.md](ARCHITECTURE_REPORT.md)
(the Phase 0 research); the three that matter most are summarised here.

## Three constraints, restated

- **C1 — one external invoke per pool transaction.** STRK20's phase table permits at most one
  `InvokeExternal` per pool transaction, and an open note is created inside its own owner's
  transaction. Two counterparties cannot be paid in one transaction, so settlement is
  **claim-driven**: each side claims its own leg.
- **C2 — no user-supplied circuit.** STRK20 proves *pool transactions* over a fixed action set;
  an app cannot add a circuit. Every MarginGuard guarantee is therefore **contract-enforced**,
  never circuit-enforced. Nothing in the code or docs claims otherwise.
- **C3 — hidden values cannot be compared on-chain.** A value behind a Poseidon commitment
  cannot be compared to another on-chain. So orders and positions **rest as commitments** and
  are **revealed to the contract at action time**, which re-derives the commitment before
  trusting any number.

## Contract map

```
                       ┌──────────────────────────────┐
                       │  STRK20 Privacy Pool          │  (StarkWare, mainnet
                       │  withdraw / invoke / notes    │   0x40337b1a…812a)
                       └───────┬───────────────┬───────┘
                    invoke via │               │ pull on approve
                 INVOKE_SELECTOR▼               │
   ┌──────────────────────────────────────────────────────────────┐
   │  MarginGuardVenue  (stateful anonymizer, pool-pinned)         │
   │  privacy_invoke(Fund | Claim)  +  place_order                 │
   └───────────────┬──────────────────────────────────────────────┘
                   │ place / cancel (gated)
                   ▼
             ┌───────────┐        deterministic, permissionless match
             │ OrderBook │  ◄─────────────────────────────────────────
             │ live /    │
             │ matched   │
             └───────────┘

   ┌──────────────┐   consume_proposal (executor-gated)   ┌──────────────┐
   │ AgentRegistry│ ◄───────────────────────────────────  │  PerpEngine  │
   │ keys, policy,│                                        │ positions,   │
   │ nonce        │   register / revoke / verify           │ PnL, liq.    │
   └──────────────┘                                        └──────┬───────┘
                                                                  │ get_price
                                                                  ▼
                                                           ┌──────────────┐
                                                           │ IPriceOracle │
                                                           │ (Ekubo TWAP) │
                                                           └──────────────┘
```

## Modules

| Module | File | Role |
| --- | --- | --- |
| `commitments` | [commitments.cairo](../contracts/src/commitments.cairo) | Domain-separated Poseidon commitments, one tag per purpose |
| `types` | [types.cairo](../contracts/src/types.cairo) | Shared value types, storage-free |
| `AgentRegistry` | [agent_registry.cairo](../contracts/src/agent_registry.cairo) | Agent identity, policy bounds, signature verification, nonce burn |
| `OrderBook` | [order_book.cairo](../contracts/src/order_book.cairo) | Resting orders (flags + commitment only), deterministic matching |
| `MarginGuardVenue` | [venue.cairo](../contracts/src/venue.cairo) | Stateful anonymizer: fund, place, claim |
| `PerpEngine` | [perp.cairo](../contracts/src/perp.cairo) | Positions, PnL, liquidation, agent adjustments |
| `IPriceOracle` | [oracle.cairo](../contracts/src/oracle.cairo) | Price interface (Ekubo TWAP adapter on mainnet) |

## Spot dark pool: fund → place → match → claim

The venue is a **stateful anonymizer**, so it pins the pool address in its constructor and
asserts it on every `privacy_invoke` (STRK20's security checklist for a fund-holding helper).

1. **Fund** (one pool tx). The pool withdraws tokens to the venue; the venue credits an internal
   balance keyed by `trader_commitment`, and returns an empty span. Funding is **separate from
   placement** because the withdraw leg is a public ERC-20 transfer — funding inside the placing
   transaction would publish the order's size. Deposit-once, trade-many.
2. **Place** (no funds move). The venue reserves part of the funded balance and writes an order
   to the book carrying only a commitment and the token pair. Placement is gated to the venue,
   because only the venue reserves the backing funds; an unbacked order would grief a matcher.
3. **Match** (deterministic, permissionless). Anyone may call `match_orders`. Both orders are
   revealed; the contract re-derives each commitment (so a false reveal cannot match), checks
   `bid >= ask`, and records a fill at the midpoint with the smaller size. No agent, no judgment.
4. **Claim** (one pool tx per side). Each side reveals its `owner_secret` and terms; the venue
   re-derives the trader and order commitments, then approves the pool to pull the payout into
   an open note. Payout is computed from the recorded fill — never supplied by the caller.

If no counterparty exists, the order can instead route through an Ekubo swap (unshield → swap →
reshield). That fallback is the one remaining external integration (its live interface is still
to be verified — see [ADDRESSES.md](ADDRESSES.md)).

## Perpetuals: open → (adjust) → close / liquidate

A position's economics — side, size, entry, margin, leverage — live in a Poseidon commitment
while open. Every action reveals them and the contract re-derives the commitment first.

- **open_position** stores only public state (existence, market, flags) plus the commitment.
- **close_position** settles equity (margin + PnL, floored at zero) in quote; entitlement is the
  `owner_secret` preimage.
- **liquidate** is permissionless in authorization but reveal-gated: a caller reveals committed
  values, and the contract independently reads the oracle and confirms the maintenance breach
  (equity < 50% of posted margin). Neither the position state nor the price can be faked.
- **adjust_position** is the agent path — see below.

PnL uses no signed arithmetic: profit and loss are separated by which of entry-value and
current-value is larger, so nothing underflows. Physical collateral custody reuses the venue's
fund/claim rails; the perp engine records the settlement amount those rails pay out.

## Agent risk layer: propose → verify → enforce

The trust model is exact: **the agent proposes, the contract verifies, the contract enforces.**

1. An agent registers a STARK-curve public key and a set of policy bounds (max margin increase,
   max size reduction, max leverage, may-close). It signs proposals off-chain.
2. To apply one, `PerpEngine.adjust_position` reveals the position (engine re-derives the
   commitment), then calls `AgentRegistry.consume_proposal`, which verifies identity, signature,
   policy and nonce and **burns the nonce** — reverting the whole call on any failure.
3. The engine then enforces the effect and re-commits under a fresh salt (or settles, for a
   close).

`consume_proposal` is **executor-gated** to the perp engine: the nonce burn and the position
change must be atomic, or a replayed signature could desync the nonce from the engine. The two
contracts are bound to each other once at deploy time, mirroring the order book's venue binding.

The agent supplies only a signature. It never holds funds, never writes state directly, and can
never push a position past its policy — so a **compromised agent key is survivable** (see the
threat model in [SECURITY_ASSUMPTIONS.md](SECURITY_ASSUMPTIONS.md)).

### How the agent sees the position (viewing-key delegation)

Step 1 above — "the agent observes the position" — is not magic and not a privacy hole. Positions
are hidden **from the public and other market participants, not from the agent that protects
them.**

STRK20's viewing system is ECDH on the STARK curve. It documents the owner's self-view and a
single whole-key escrow to a governance-fixed auditor — but no native owner→chosen-third-party
per-position delegation. MarginGuard builds that grant at the **application level on STRK20's own
ECDH primitive**:

- The agent registers a **viewing public key** in `AgentRegistry` (alongside its signing key).
- At `open_position`, the owner ECDH-encrypts the position's viewing capability to the agent's
  viewing key and records the grant on-chain: the ephemeral public key `rG` and the masked
  capability, exactly the shape STRK20 uses for channels and the auditor escrow.
- The agent recovers the shared secret (`k_agent · rG`), decrypts the capability off-chain, and
  reads the real margin / size / entry / PnL to compute health.
- The grant is scoped to the position and **revocable** by the owner.

The chain records only that a grant exists and that actions were proposed and executed — never
the underlying values. This is IDEA-21 (selective disclosure tooling) built on the real
primitive; it is documented as an app-level construction, not a native STRK20 call, because that
call does not exist. Its one honest limit: it does not defend against timing-correlation on when
the agent acts — see SECURITY_ASSUMPTIONS.md.

## What is public and what is shielded

Full table in [ARCHITECTURE_REPORT.md §4](ARCHITECTURE_REPORT.md). In short:

- **Shielded from the public and other traders:** who is trading (never revealed), and an order's
  or position's economics **until it is acted on**. A position's economics are additionally
  visible to the owner and to the agent the owner granted — never to the public.
- **Public:** existence and lifecycle flags, the market, agent identity and action type, and —
  once a leg settles — the settlement amount (an open-note amount is plaintext by protocol).

The defensible one-line claim: *who is trading is never revealed, and what a resting order was
stays hidden until it trades.* That is genuine pre-trade opacity — the real definition of a dark
pool — and it is what the contracts deliver.

## Settlement flow summary

```
SPOT
  Fund:   pool → withdraw → venue.balance[commitment] += amount        (public leg)
  Place:  venue.balance → reserve;  book += commitment                  (no funds move)
  Match:  reveal + verify;  book records midpoint fill                  (no funds move)
  Claim:  reveal + verify → venue.approve(pool) → open note credited    (public amount)

PERP
  Open:   commitment stored
  Close:  reveal + verify → equity = margin + PnL → settlement recorded
  Liq.:   reveal + verify + oracle breach → residual settlement recorded
  Adjust: reveal + verify + registry.consume → re-commit / settle
```
