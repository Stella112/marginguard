# MarginGuard — Phase 0 Architecture Report

**Status:** Research complete. Awaiting approval before Phase 1.
**Date:** 2026-08-26
**Sprint deadline:** 2026-08-31 (STRK20 Private Sprint, Aug 14–31)

Sources: the vendored official STRK20 documentation snapshots in `.agents/skills/`
(`strk20-privacy`, `strk20-anonymizer-contracts`, `strk20-wallet-api`,
`strk20-privacy-sdk`), pinned by `skills-lock.json` to `welttowelt/strk20-skills`,
snapshot 2026-08-16. No primitive below is invented, and none is imported from
Aztec, Aleo, Tornado Cash, Railgun, or Zcash.

---

## 1. STRK20 primitive analysis

### 1.1 Note structure

A note is an immutable record of exactly three fields:

| Field | Type | Notes |
| --- | --- | --- |
| Owner | `ContractAddress` | Spend authorised by account signature **plus** knowledge of the private viewing key |
| Token | `ContractAddress` | ERC-20 address, stored masked |
| Amount | `u128` | Stored masked (encrypted notes) or plaintext (open notes) |

UTXO semantics: notes are **spent whole**. Paying 30 from a 100 note consumes
the note and creates two outputs (30 to the payee, 70 change). Amounts balance
under a STARK proof without being revealed.

### 1.2 Open notes — the load-bearing constraint

An open note deliberately **skips amount masking**, using protocol-reserved salt
`OPEN_NOTE_SALT = 1` (encrypted notes use salt >= 2). Its token address and its
filled amount are stored **in the clear**.

Open notes exist precisely because a DeFi output amount is not known at proving
time: the anonymizer contract measures it on-chain and fills the note afterwards.
The documentation states the trade explicitly — open notes trade amount privacy
for that late binding, while ownership and subsequent spends remain private.

**Consequence for MarginGuard:** every amount that reaches a user through an
anonymizer contract is public at settlement. This is protocol-level and cannot be
engineered around. See §4 and §7.

### 1.3 Commitment format (`note_id`)

Note storage location is derived, not listed:

```
note_id = h(NOTE_ID_TAG, channel_key, token, index, 0)
```

Poseidon, domain-separated. Indices are dense and sequential within a per-token
subchannel; every cell is WriteOnce. Without the channel key, note locations are
indistinguishable from random storage slots.

### 1.4 Nullifier format

```
nullifier = h(NULLIFIER_TAG, channel_key, token, index, 0, owner_private_key)
```

Deterministic (no double-spend under a second nullifier), unique (repeats
rejected), unlinkable (unmatchable to a note without the viewing key). Because
the **owner's** private viewing key is an input, the sender who created a note
cannot compute its nullifier — senders cannot watch their payment being spent.

### 1.5 Viewing-key architecture

Keypair `K = k·G` on the STARK curve. `k` is held only by the user; `K` is
registered once via `SetViewingKey` and is **immutable** — all channel discovery
derives from it.

- **Symmetric masking** inside a channel, domain-separated Poseidon plus per-use salt:
  `enc_amount = (h(ENC_AMOUNT_TAG, channel_key, token, index, 0, salt) + amount) mod 2^128`
- **Asymmetric setup** via ephemeral ECDH on the STARK curve: sender picks random
  `r`, publishes `rG`, computes `shared = r·K`; recipient recovers `k·(rG) = r·K`.
- **Auditor escrow:** at registration `k` is also encrypted to the auditor's
  public key under the same ECDH pattern. A viewing key can read, never spend.

Registration is a **prerequisite**: both sender and recipient must be registered
before a private transfer, and only the recipient can register themselves.

### 1.5.1 Owner→agent scoped viewing delegation (verified gap + chosen construction)

The risk agent must read a position's real economics to compute health. The brief
assumes a native STRK20 primitive for an owner to grant a chosen third party scoped
view of one position. **Verified against the docs: no such primitive exists.** STRK20
documents exactly two viewing paths:

1. **Owner self-view** — the owner holds `k` and decrypts their own notes.
2. **Auditor escrow** — at registration, `k` is encrypted *once* to a
   **governance-fixed auditor** public key via ECDH. Whole-key, not per-position, and
   to a key the owner does not choose.

Neither is owner→agent, per-position, or owner-chosen. Per the rules ("do not assume
STRK20 internals; do not invent encryption systems"), this is flagged rather than
assumed.

**Chosen construction (app-level, on STRK20's own ECDH primitive).** STRK20's entire
viewing system is ephemeral **ECDH on the STARK curve** — `sender picks r; publishes
rG; shared = r·K; enc = h(TAG, shared.x) + data`, used for both channels and the
auditor escrow. MarginGuard reuses *that exact scheme* at the application level:

- The agent registers a **viewing public key** `K_agent` in the registry.
- At `open_position` the owner picks ephemeral `r`, publishes `rG`, computes
  `shared = r·K_agent`, and stores `enc = h(GRANT_TAG, shared.x) + capability`
  on-chain alongside the position, plus a revocable grant flag.
- The agent recovers `shared = k_agent · rG`, decrypts the capability, and reads the
  position off-chain.

This invents no cryptography — it is STRK20's documented ECDH masking applied to a new
recipient. It is **documented everywhere as an app-level construction, never as a
native STRK20 call.** It maps to **IDEA-21 (Selective disclosure tooling)**, an
organizer-listed idea with no warning.

**What the chain records:** that a grant exists and that actions were proposed and
executed for a position — never the underlying values. **What it does not defend:**
timing-correlation on *when* the agent acts (see the limitation in §7 and
SECURITY_ASSUMPTIONS.md). Confidential-compute would be required to close that, and it
is not available on STRK20 — so IDEA-04 and IDEA-06 (both carrying the organizers'
confidential-compute warning) are deliberately not anchored to.

### 1.6 Channels and discovery

```
channel_key = h(CHANNEL_KEY_TAG, sender_addr, sender_private_key,
                recipient_addr, recipient_public_key)
```

Channels are directional sender→recipient lanes; a deposit is a self-channel.
Per-token subchannels hold dense note indices. Discovery = scan channels
addressed to you, walk subchannels to the first empty slot, walk note indices,
skip nullified notes. Cost scales with **your own** activity, not pool volume.

### 1.7 Shielding / unshielding flow — the phase table

A transaction is a batch of actions in strictly non-decreasing phase order:

| Phase | Action | Temp balance |
| --- | --- | --- |
| 0 | `SetViewingKey` | — |
| 1 | `OpenChannel` | — |
| 2 | `OpenSubchannel` | — |
| 3 | `Deposit` (shield) | + amount |
| 4 | `UseNote` | + note amount |
| 5 | `CreateEncNote` / `CreateOpenNote` | − amount |
| 6 | `Withdraw` (unshield) | − amount |
| 7 | `InvokeExternal` / `ComputeAndInvoke` | **at most one, jointly** |

**Balance invariant:** per-token temporary balance may never go negative and must
end at exactly zero.

**Proving:** virtual Starknet execution anchored to a recent block, then Stwo
(~29 s on 12-core / 46 GiB, hardware-dependent). On-chain checks before apply:
program variant `VIRTUAL_SNOS`, anchor within `proof_validity_blocks` of the tip
(default 450, ≈15 min), and proven message hash == submitted actions.

**Deposit screening:** FPI screens the shielding address and signs every deposit;
the pool verifies that signature on-chain. Protocol-level since v0.14.3 — no
route bypasses it, self-hosted provers included.

### 1.8 The anonymizer (`privacy_invoke`) contract surface

The atomic sandwich: `withdraw from pool → helper acts → deposit result to open note`.

```cairo
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}
```

Five rules, all enforced by the pool:

1. Return **exactly** `Span<OpenNoteDeposit>` — trailing garbage is rejected.
2. **Approve, do not transfer** — the pool executes the pull itself.
3. **An empty span is valid** — "credit nothing" (the escrow deposit leg).
4. **Measure output by balance delta**, never trust an external return value.
5. **One external invoke per transaction** — protocol-enforced.

Dapp side, one STRK20 transaction carrying two actions:

```ts
const actions: STRK20_ACTION[] = [
  { type: "transfer", token: tokenOut, amount: "OPEN", recipient: userAddress },
  { type: "invoke", contract: helperAddress,
    calldata: [/* ... */, "${openNoteIds[0]}"] },
]
await account.strk20InvokeTransaction(actions)
```

Placeholders `${openNoteIds[N]}` and `${poolAddress}` are resolved by the wallet.
`strk20PrepareInvoke(actions, true)` dry-runs without submitting.

---

## 2. Three constraints that reshape the product

These are derived from the documentation above, not from preference.

### C1 — One invoke per transaction ⇒ settlement must be claim-driven

Phase 7 permits **at most one** `InvokeExternal` per pool transaction. A spot
match has two beneficiaries, each needing their own open note, and an open note
is created by the `transfer: "OPEN"` action inside *its owner's own* transaction.
Two counterparties therefore cannot be paid inside one pool transaction.

**Design consequence:** MarginGuard is a three-step state machine, following the
documented stateful-escrow pattern:

```
1. FUND    (per user, 1 pool tx)   pool withdraws to venue → venue credits an
                                   internal balance, returns EMPTY span
2. PLACE   (per user, 0 pool txs)  commitment only; NO funds move
3. MATCH   (public, 0 pool txs)    deterministic Cairo matching; no funds move
4. CLAIM   (per user, 1 pool tx)   claimant proves entitlement → venue approves
                                   pool → returns OpenNoteDeposit → open note
```

Each side claims its own leg in its own transaction. This respects the one-invoke
rule exactly and requires no protocol change.

**Why funding is decoupled from placement.** The pool's withdraw leg to a helper
is a plain **public** ERC-20 transfer. If funds moved in the same transaction
that created the order, the transferred amount would be publicly linkable to that
order and order size would be public at placement — not merely at match. Funding
the venue balance separately breaks that link: a funding transfer is tied to no
particular order, and placement afterwards moves no funds at all, so a resting
order leaks neither size nor price. Deposit-once, trade-many.

### C2 — There is no user-supplied circuit

The STRK20 proof system proves **pool transactions** over the fixed action set
(`VIRTUAL_SNOS` + Stwo). It is not a general-purpose zkVM exposed to application
developers: an app cannot add a custom circuit to the pool's proof.

**Design consequence:** "the circuit verifies the agent's proposal" is not
implementable as stated. What *is* implementable — and is what the brief's own
numbered flow specifies at step 5 — is that the **contract** verifies: registered
agent identity, signature validity, position state validity, policy compliance.
Enforcement is Cairo contract logic against stored state, executed on Starknet.
See §7 (Q2): the brief's section heading and its numbered flow disagree.

### C3 — Hidden values cannot be compared on-chain

Starknet contract storage is public. A price or size stored in the clear is
public; a value hidden behind a Poseidon commitment cannot be compared by Cairo
(`bid >= ask` over two commitments is not computable without a circuit, and C2
rules out a circuit).

**Design consequence:** orders rest as **commitments** (pre-trade opacity — what
a dark pool actually provides) and are **revealed to the contract at match
time**, where `poseidon(ORDER_TAG, side, price, size, salt)` is checked against
the stored commitment and the crossing condition is then evaluated in the clear.
Pre-trade hidden, at-match revealed, **ownership hidden throughout**.

---

## 3. Contract architecture

```
                    ┌──────────────────────────────┐
                    │   STRK20 Privacy Pool        │  (StarkWare, deployed)
                    │   withdraw / invoke / notes  │
                    └──────┬────────────────┬──────┘
                    invoke │                │ pull on approve
                           ▼                │
   ┌───────────────────────────────────────────────────────────┐
   │  MarginGuardVenue  (stateful anonymizer, pool-pinned)      │
   │  privacy_invoke(operation, ...) -> Span<OpenNoteDeposit>   │
   │                                                            │
   │  operations: PlaceOrder | ClaimFill | OpenPosition         │
   │              | ClaimSettlement | RouteEkubo                │
   └────┬──────────────┬───────────────┬────────────────┬───────┘
        │              │               │                │
        ▼              ▼               ▼                ▼
  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐
  │ OrderBook│  │ Matching   │  │ PerpEngine │  │ AgentRegistry│
  │ commits, │  │determinis- │  │ positions, │  │ pubkeys,     │
  │ live /   │  │tic midpoint│  │ margin,    │  │ policy,      │
  │ matched  │  │ no agent   │  │ liquidation│  │ sig verify   │
  └──────────┘  └────────────┘  └────────────┘  └──────────────┘
                                       │                │
                                       ▼                ▼
                                ┌────────────┐  ┌──────────────┐
                                │ EkuboOracle│  │ RiskVerifier │
                                │ price read │  │ proposal →   │
                                └────────────┘  │ policy check │
                                                └──────────────┘
```

Module responsibilities:

- **MarginGuardVenue** — the single `privacy_invoke` entry point. Pool address
  pinned in the constructor, `CALLER_NOT_PRIVACY` asserted on every call
  (mandatory: the venue is stateful and holds funds across transactions).
- **OrderBook** — `Map<felt252, OrderEntry>`; public fields are `live` and
  `matched` flags plus the token pair. Price and size live only inside the
  commitment until reveal.
- **Matching** — plain deterministic Cairo. Opposite side, `bid >= ask`, midpoint
  execution. No agent, no LLM, no judgment.
- **PerpEngine** — position lifecycle, initial and maintenance margin
  (maintenance = 50% of initial), long/short PnL, permissionless liquidation
  gated on an oracle read.
- **AgentRegistry** — `register_agent`, `revoke_agent`, `is_registered_agent`;
  stores the agent's STARK-curve public key and its policy bounds.
- **RiskVerifier** — verifies a signed proposal against registered identity,
  signature, live position state, and policy bounds, then executes. The agent
  never holds funds and never writes state directly.
- **EkuboOracle** — price read used for PnL, margin health, liquidation, and
  position valuation. See §7 (Q3) — spot reads are manipulable.

Agent signature verification uses the STARK curve natively
(`core::ecdsa::check_ecdsa_signature`), the same curve the pool already uses.

---

## 4. Public vs shielded — as actually achievable

| Value | Brief requires | Achievable | Why |
| --- | --- | --- | --- |
| User identity / ownership | Shielded | **Shielded ✅** | Notes; the pool never reveals the initiator |
| Order existence, matched flag | Public | Public ✅ | By design |
| Agent identity, action type, timestamp | Public | Public ✅ | By design |
| Limit price (pre-match) | Shielded | **Shielded ✅** | Poseidon commitment |
| Order size (pre-match) | Shielded | **Shielded ✅** | Poseidon commitment |
| Limit price (at match) | Shielded | **Public ⚠️** | C3 — must be revealed to evaluate crossing |
| Order size (at match) | Shielded | **Public ⚠️** | C3 |
| Settlement amount | Shielded | **Public ⚠️** | §1.2 — open-note amounts are plaintext by protocol |
| Position size / margin / entry (while open) | Shielded | **Shielded ✅** | Commitment |
| PnL at settlement | Shielded | **Public ⚠️** | §1.2 — arrives through an open note |
| Liquidation threshold | Shielded | **Public ⚠️** | Must be checkable by any liquidator |

Four rows cannot meet the brief. This is a protocol property, not an
implementation shortfall — see §7 (Q1).

The honest, defensible claim for the submission is:

> **Who is trading is never revealed. What the resting order was stays hidden
> until it trades.**

That is real pre-trade opacity — the actual definition of a dark pool — and it is
fully deliverable.

---

## 5. Threat model

| # | Threat | Mitigation |
| --- | --- | --- |
| T1 | Direct call to `privacy_invoke`, bypassing the pool | Pool address pinned in constructor; `assert(get_caller_address() == privacy_addr)`. Mandatory for a stateful helper |
| T2 | Double-claim of a filled order | `claimed` flag flips exactly once; `ALREADY_CLAIMED` |
| T3 | False reveal at match (lying about price or size) | Contract recomputes `poseidon(ORDER_TAG, side, price, size, salt)` and compares against the stored commitment |
| T4 | Commitment grinding / cross-context replay | Domain-separated tags per the STRK20 convention; caller-supplied salt with sufficient entropy |
| T5 | Malicious or compromised agent | The agent only signs. The contract re-derives health from stored state plus oracle and rejects any proposal outside policy bounds. The agent holds no funds and no user key |
| T6 | Replay of a previously valid agent proposal | Per-position nonce bound into the signed message |
| T7 | Oracle manipulation (flash loan against Ekubo spot) | **Open — see §7 (Q3).** Spot reads are manipulable within a block |
| T8 | External call return-value spoofing | Balance-delta measurement only (rule 4); never trust a protocol's return value |
| T9 | Channel-open linkability | Documented STRK20 limitation: separate channel setup from fund movement in time; surface in the UI |
| T10 | Distinctive amounts shrinking the anonymity set | Documented limitation; surface in the UI, not solvable in-contract |
| T11 | Attributing pool activity to the transaction sender | Never do this: private transactions are relayed, so the sender is the relayer for every user. Read per-user activity from the pool's `Deposit` event |
| T12 | Stale proof / anchor drift | Protocol-enforced: the anchor must be within `proof_validity_blocks` (~15 min) |

---

## 6. What ships, in survival order

Per the brief's Hackathon Survival Rule, with ~5 days remaining:

| # | Deliverable | Phase | Risk |
| --- | --- | --- | --- |
| 1 | Shielded spot dark pool (place → match → claim) | 2 | Medium |
| 2 | Ekubo fallback routing | 2 | Medium — live AMM calldata shape |
| 3 | Agent registry | 1 | Low |
| 4 | Agent verification flow | 4 | Low — pure Cairo plus ECDSA |
| 5 | Perpetuals | 3 | High |
| 6 | Advanced risk management | 4 | High |

Note that items 3 and 4 are *lower* risk than items 1 and 2 — the agent layer is
straightforward Cairo signature and policy checking. The genuinely hard,
schedule-driving work is the venue state machine and the live Ekubo integration.

---

## 7. Decisions taken (resolved 2026-08-26)

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Shielded-state gap | **Accept the achievable split in §4 and document it precisely.** The README states the true claim; no overclaim survives into the submission |
| Q2 | Circuit vs contract verification | **Contract-enforced verification**, described in those words throughout. No claim of a circuit that does not exist |
| Q3 | Liquidation oracle | **Ekubo TWAP.** Defeats single-block manipulation while remaining Ekubo-canonical per the brief |
| Q4 | Toolchain | **Install the full toolchain**: Scarb 2.18.0, Starknet Foundry (snforge/sncast), starkli |
| Q5 | Stack corrections | **Both applied.** starknet.js `WalletAccountV6` (not starknet-react); target Ready + Xverse with capability detection (not Braavos) |

Q3 supersedes T7 in §5: the mitigation is now a time-weighted read rather than an
accepted open risk.

The original blocking questions are preserved below for the record.

---

## 7a. Blocking questions (resolved — see §7)

**Q1. The shielded-state table cannot be met in full.** Settlement amounts and
PnL are public because open-note amounts are plaintext by protocol design
(§1.2); match-time price and size are public because hidden values cannot be
compared on-chain (C3). Options: (a) accept the achievable split in §4 and
document it precisely — my recommendation, since accuracy about a privacy claim
is itself a judging asset; or (b) have me spend further research time on the
`ComputeAndInvoke` / `privacy_compute` sub-account path before committing.

**Q2. "The Circuit Verifies" vs "Contract verifies".** The brief's heading says
circuit; its own numbered flow at step 5 says contract. C2 says only the contract
is possible. Confirm I should implement contract-enforced verification and
describe it in those words throughout the docs — the submission should not claim
a circuit that does not exist.

**Q3. Ekubo spot as liquidation oracle is manipulable.** A single-block price
push can trigger liquidations. Options: (a) Ekubo spot as specified, documented
as a known assumption; (b) Ekubo TWAP; (c) Pragma. The brief specifies Ekubo, so
I default to (a) unless told otherwise, though (b) is meaningfully safer for
roughly an hour of extra work.

**Q4. Toolchain is absent.** `scarb`, `snforge`, `sncast`, and `starkli` are all
missing from this machine; only Node 26.4.0 and npm are present.
`cairo/.tool-versions` pins Scarb 2.18.0. Nothing can compile, be tested, or be
deployed until these are installed. Approval needed to install.

**Q5. Two stack items in the brief conflict with the STRK20 route.**

- *Starknet React:* the STRK20 wallet methods (`strk20InvokeTransaction`,
  `strk20Balances`, `strk20PrepareInvoke`) live on `WalletAccountV6` in
  starknet.js 10.4.0. starknet-react does not surface them. Recommend staying on
  the starknet.js path already wired into this repo.
- *Braavos:* the documentation states Braavos is **not** privacy-enabled. The
  privacy wallets are Ready (formerly Argent X) and Xverse. Recommend targeting
  Ready plus Xverse, detecting capability rather than inferring it from brand.

---

## 8. Verification still owed

Per the documentation's own launch checklist, and because the vendored snapshot
is dated 2026-08-16:

- [ ] Live mainnet pool contract address and current Wallet API version
- [ ] Ekubo mainnet router address, swap selector, and exact calldata shape
- [ ] Connected wallet's actual STRK20 capability (detect, do not infer)
- [ ] Run `.agents/skills/strk20-privacy/scripts/check_freshness.py` before
      quoting any version, address, or status in the final README
