# MarginGuard — Private Dark Pool & Perpetuals on Starknet, with Agent-Verified Risk Management

**Track:** Privacy DeFi (STRK20 Private Sprint)

**One-line pitch:** A native spot dark pool and perpetuals venue on Starknet, built on STRK20's shielded-note infrastructure, where a registered agent continuously manages each user's collateral health, position size, and exit conditions on a fully hidden position — every adjustment verified by a Cairo circuit before it executes.

---

## The problem

Public order books and AMM pools leak everything before a trade settles — size, direction, and price impact are visible to anyone watching the mempool. STRK20 has made private transfers, swaps, lending, and staking native on Starknet, but there's no private *matching* venue built on it — no dark pool, no private perpetuals using STRK20's own shielded-note primitive. Separately, active risk management (dynamic margin, trailing stops, leverage adjustment) is now standard on public perps platforms like Hyperliquid — but always over fully visible positions, because the agents doing that work need to see the position to protect it. Nobody has combined the two. MarginGuard does.

## What it is

- **Spot dark pool** — hidden limit orders, matched at a circuit-enforced midpoint, settled into shielded STRK20 notes. If no opposing order exists, it falls back to an Ekubo swap (unshield → swap → reshield), so a trade always completes.
- **Perps** — leveraged long/short positions, hidden entry, size, and PnL, settled into shielded notes.
- **Matching engine** — plain, verified logic (not agentic) that pairs opposing spot and perps orders and checks the price is fair. This is deterministic math, not judgment, so it's built as ordinary Cairo logic.
- **Risk-management agent** — the one genuinely agentic piece. For each open perps position, the agent continuously watches collateral health and proposes protective adjustments: trimming size or requesting more margin as health drops, tightening or loosening a trailing exit as price trends, adjusting effective leverage against volatility. Every proposal is a signed action the circuit verifies against the position's real, hidden state before it executes — the agent can suggest a protective move, but it cannot fabricate collateral health, move funds outside what's authorized, or force an action the position doesn't actually warrant.

## What's public vs. shielded

- **Public:** agent identity, action type (adjust margin / trim size / close), timestamp, order-book boolean flags.
- **Shielded:** order size, price, leverage, margin, PnL, exit trigger levels.

## Why this is a fair "first on Starknet" claim, not an overclaim

Dynamic risk management for perps is a mature, common pattern elsewhere (Hyperliquid, SynFutures-adjacent tooling) — this isn't a new job for an agent to do. What's new is doing it over a position nobody else can see, on Starknet specifically, where STRK20's shielded notes make the position private and Starknet's own Account Abstraction and session-key infrastructure (and its live "Chance" agent-transaction-verification system) make policy-bound agent execution a first-class, supported pattern rather than a bolt-on.

## Architecture

- Order/position commitment hashing in Cairo, consistent with STRK20's native Poseidon-based note scheme
- Agent registry contract: register key, verify signature on every proposed adjustment
- Shared order book mapping: live/matched flags only
- Two settlement modules: spot (token-for-token, with Ekubo fallback) and perps (margin/PnL against shielded notes)
- Risk-adjustment verification: circuit checks the agent's signature and checks the proposed action against the position's actual shielded state before executing
- STRK20 shielded notes throughout; viewing keys available for selective disclosure

## Why this fits the judging criteria

- **STRK20 integration depth (30%)** — shielded notes across two settlement types, a real anonymizer-pattern Ekubo fallback, native Poseidon commitment scheme.
- **Working mainnet product (30%)** — spot ships first as a capital-light, fully working checkpoint; perps and the risk agent layer on top.
- **Innovation (25%)** — honest framing: agent-managed risk isn't new, doing it over a shielded position is. First on Starknet, not first anywhere.
- **Documentation (15%)** — README diagrams the agent-verification flow, states the shielded/public split plainly, includes a real mainnet transaction from a working demo.
