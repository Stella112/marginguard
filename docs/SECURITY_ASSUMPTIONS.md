# Security Assumptions

What MarginGuard trusts, what it does not, and the limits it states in the open. Read this
alongside the threat model, which is in
[ARCHITECTURE_REPORT.md §5](ARCHITECTURE_REPORT.md#5-threat-model).

## Trust assumptions

| # | We trust | We do NOT trust | Enforced by |
| --- | --- | --- | --- |
| 1 | The STRK20 privacy pool contract | — | It is StarkWare's, pinned by address |
| 2 | The oracle for a fair aggregated price | An instantaneous spot price | Pragma **STRK/USD median**, not spot |
| 3 | Nothing about the agent's honesty | The agent's proposals, identity claim, or key | Contract re-verifies every proposal |
| 4 | The caller to reveal *some* values | That the revealed values are true | Commitment re-derivation on every action |
| 5 | The venue to hold funds mid-transaction | The venue to hold more than it was funded | Credited totals checked against real balance |

## Agent visibility (scoped, not blind)

The agent is **not blind** to the positions it manages, and this is deliberate. It needs the real
margin, size, entry and PnL to compute collateral health, so:

- When the owner opens a position, they grant the registered agent **scoped viewing access** to
  that position, built on STRK20's ECDH-on-the-STARK-curve primitive at the application level
  (STRK20 has no native owner→third-party per-position delegation call; see the README and the
  architecture report for why this is an app-level construction, not a native STRK20 call).
- The agent decrypts the position off-chain with its viewing key and computes health from the
  real numbers. The chain records that a grant exists and that actions were proposed/executed —
  never the underlying values.
- The grant is **scoped** (to that position) and **revocable** (the owner can revoke; the Privacy
  Center shows active grants).

State this precisely everywhere: positions are **hidden from the public and other market
participants, not from the agent that protects them.** The agent has necessary, scoped visibility
to do its job — comparable to a fraud-detection system seeing transactions the public cannot.
This is a documented trust boundary, not a privacy failure.

## Agent assumptions

The agent is **untrusted for authority**, even though it is granted visibility. It signs
proposals; the contracts decide. Visibility lets it *decide what to propose*; it grants no power
to *execute* anything the contract has not independently verified.

- A proposal is applied only if it is signed by the registered key, sits within the agent's
  registered policy bounds, and carries the expected nonce. Any failure reverts the whole call.
- The agent holds **no funds** and **no user key**, and cannot write engine state directly.
- The nonce is **burned** on each executed proposal, so a signature cannot be replayed.
- **A compromised agent key is survivable.** The worst an attacker with the key can do is
  propose actions *within the policy the user set* — trim size, add margin, lower leverage,
  close. It cannot move funds elsewhere, exceed the policy, or fabricate a position's state.
- Revocation is immediate: a revoked agent's signatures stop verifying at once.

Assumption that remains: the user sets a **sane policy**. A policy that permits a 100% size
reduction or a full close gives the agent that power. Policies are upper bounds the contract
enforces, but the contract cannot judge whether a bound is wise.

## Oracle assumptions

- The perp engine values positions, checks margin health, and gates liquidations on
  `IPriceOracle.get_price`. The current mainnet deployment uses Pragma's aggregated STRK/USD
  median; the older Ekubo adapter deployment is superseded.
- **Residual risk:** an aggregated oracle can still be stale, wrong, or manipulated across its
  source set. Liquidations are correct with respect to the oracle, which is the contract's only
  view of price — not necessarily with respect to an instantaneous market.
- The oracle is behind an interface, so it can be re-pointed or swapped (e.g. to Pragma) without
  touching position math.

## Privacy assumptions and limits

Stated plainly, because a privacy claim is only worth what its limits admit.

- **The precise claim:** economics are **hidden from the public and other market participants**,
  not from all parties. The owner sees their own; the registered agent sees the positions it was
  granted. Never phrase this as "hidden from everyone."
- **What is genuinely hidden from the public:** the identity of who is trading (the pool never
  reveals the initiator), and an order's or position's economics **until it is acted on**.
- **Exit triggers are not timing-attack resistant.** An agent-managed stop-loss / take-profit
  relies on the viewing-key mechanism, not confidential compute. The raw trigger value is never
  written to public state and is decryptable only by the owner and the granted agent — but an
  attacker observing *when* the agent submits a close transaction may still infer information
  about approximate trigger timing, even without knowing the price. This is a known, honestly
  documented limitation, **not** a solved problem. Describe it exactly as: "hidden from public
  view and other market participants, using STRK20's viewing-key primitive; full protection
  against timing-based inference would require confidential-compute infrastructure not yet
  available on STRK20." Never call the trigger mechanism fully confidential or timing-attack
  resistant.
- **Open-note amounts are public.** Any amount that reaches a user through an anonymizer — a spot
  claim, a perp settlement — is plaintext by STRK20 protocol design. Settlement amounts and PnL
  are therefore public. This is not an implementation gap; it cannot be engineered around at the
  app layer.
- **Match-time reveal.** Matching requires revealing both orders' price and size to the contract
  (C3 — commitments cannot be compared). Pre-trade the order is opaque; at the moment it trades,
  its terms become public. Ownership stays hidden throughout.
- **Adjustment reveal.** An agent adjustment reveals the position's economics at adjustment time
  (they appear in calldata). A position that is never adjusted stays shielded until it closes; an
  adjusted one is disclosed when it is adjusted. This is the unavoidable consequence of C2 (no
  user-supplied circuit).
- **Edge linkability (STRK20-level, documented by the protocol):** deposits, withdrawals, and
  timing are public; opening a channel and moving funds in tight succession can link a recipient
  to public activity; distinctive amounts shrink the anonymity set. The frontend surfaces these
  as guidance; they are not solvable in-contract.
- **Compliance:** STRK20 escrows each user's viewing key to an auditor key at registration —
  private by default, disclosable under lawful process. MarginGuard inherits this; it adds no
  backdoor of its own and removes none.

## Custody and accounting assumptions

- The venue can never promise more than it holds: credited totals are checked against its real
  ERC-20 balance on every fund, and payouts are computed from recorded fills, never supplied.
- **Buy-side price-improvement surplus is not auto-refunded** in this version. A buyer reserves
  quote at their limit price; if they fill at a better midpoint, the difference stays in the
  venue with its credit released — never double-promised, and the venue stays solvent (asserted
  in the venue tests). A refund path is future work.
- **Perp collateral custody** is the venue's job; the perp engine is the accounting brain that
  records settlement amounts. In this build the two are separate contracts wired at the
  application layer; a fully integrated custody path is future work.
- **No liquidator reward** in this version: liquidation settles residual equity to the owner and
  pays the liquidator nothing. In production a keeper incentive would be added; its absence means
  liquidations rely on the owner or agent (who have the incentive and the knowledge) to call.

## Operational assumptions

- **Deployment bindings are one-time and must be set right after deploy:** the book's
  `initialize_venue`, the registry's `initialize_executor`, and the engine's
  `initialize_agent_registry`. New builds restrict these calls to the deployment caller; existing
  deployments made before this guard must be treated as superseded and should not hold value.
  Until a binding is set, the dependent action is refused (fail-closed).
- **Toolchain:** contracts are built with Scarb 2.18.0 (pinned) and tested with
  `scarb cairo-test` (115 tests). Starknet Foundry has no current Windows build, so `snforge` is
  not used; the built-in runner covers the same ground.
- **Not audited.** This is a hackathon build. An anonymizer contract that holds funds is exactly
  the kind of code that warrants an independent audit before any real value is entrusted to it.
  The STRK20 documentation says as much about app-team anonymizers, and it applies here.
