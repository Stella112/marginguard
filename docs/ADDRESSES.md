# Verified addresses

Everything here was checked against the chain, not copied from documentation.

## MarginGuard — Sepolia deployment (live)

Deployed 2026-08-27 via `scripts/deploy/deploy_sjs.mjs` (starknet.js v10.4.0) and verified
on-chain: all three classes present, `book.venue()` returns the venue, and
`venue.privacy_pool()` returns the Sepolia pool.

| Contract | Address |
| --- | --- |
| AgentRegistry | `0x03ed6b59a2eb92151f4bb1c86764b877851e193c0219b36ebbf4a4b2bfd5bdb8` |
| OrderBook | `0x03a7be95529ca4c28271bd4b017d582a14f799dec47696495ce6e10b698e8bb0` |
| MarginGuardVenue | `0x05c10c42f661b328c6f75a1acba641029b9080938c50922de1c79beacb2f8a4f` |
| STRK20 pool (Sepolia) | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |

Deployer account (single-signer OZ, no guardian):
`0x03e7f18a3bc53ec2229a65fdff51659c16e1304e02f0b6db144353a222ace2d1`

Wiring tx: `0x1a6298cbd6a912b754f76e0749972fabf951b6c3c98dc304d0977de63e5cff7`

> **Deployment tooling note.** starkli 0.4.2 could not declare these: its compiled-class-hash
> formula predates Starknet 0.14.3 (rejected with a class-hash mismatch), and its Sierra
> compiler predates 1.8.0. starknet.js v10.4.0 computes the current hash (verified equal to the
> network's) and declared cleanly. The starkli path and its workarounds are kept in
> DEPLOYMENT.md for reference; `deploy_sjs.mjs` is the working path.

## STRK20 privacy pool — mainnet

Reproduce with `node scripts/discover_pool_address.mjs`.

## STRK20 privacy pool — mainnet

```
0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

**How this was established.** The vendored STRK20 documentation publishes only the *Sepolia*
pool (`0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`); the mainnet
address is not in the docs, and `strk20-by-example.org` has no deployments page.

MarginGuardVenue is a **stateful** anonymizer, so the STRK20 security checklist requires the
pool address to be pinned in the constructor and asserted against the caller. A self-declared
`pool_address` parameter is not access control for a contract that holds funds across
transactions, so the real address had to be established rather than assumed.

It was read off the chain instead. This project's already-deployed echo helper
(`cairo/src/lib.cairo`) does this before emitting anything:

```cairo
let caller = get_caller_address();
assert(pool_address == caller, errors::BAD_POOL);
```

and then emits that caller in its `Invoked` event. So each event is the pool asserting its own
address on-chain. All 17 recorded invokes resolve to one distinct caller.

## MarginGuard echo helper — mainnet

| Item | Value |
| --- | --- |
| Contract | `0x78ae662e0cc6d1ab2cfeaf2a51ba8783d88e31886f88a794d142f95a6f8735b` |
| Class hash | `0x2a4482a13cb7f70dce6f7ba99c4ee6ce404379abeddd9b831b6bf24eb71e137` |
| Invokes to date | 17 |

## Mainnet transactions through the helper

Real STRK20 private invokes, each an atomic withdraw → `privacy_invoke` → open-note deposit:

| Block | Transaction |
| --- | --- |
| 13680193 | `0x1d6dc36e95456923d773b7d2f381ea7557ecdbbdf5a8b1807113c5d80646ba4` |
| 13680282 | `0x4e9bdb6368afb6ae8613e994361acb7737cf48ef0fe6dd1525cc30f0c6820a3` |
| 13680299 | `0x7f96fbdf92b465b97286f95dc9c2553d2af557ca8e3b2cbe67acb3acf211f51` |

## Tokens

| Token | Address |
| --- | --- |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |

## Still unverified

- [ ] Ekubo mainnet router address, swap selector, and exact calldata shape (needed for the
      Phase 2 fallback route; until this is confirmed the fallback is not real)
- [ ] Ekubo TWAP read interface, for the Phase 3 liquidation oracle (decision Q3)

## Working RPC endpoints

Public mainnet endpoints, no API key. Checked 2026-08-27:

| Endpoint | Status |
| --- | --- |
| `https://rpc.starknet.lava.build` | working |
| `https://starknet-mainnet.public.blastapi.io/rpc/v0_7` | HTTP 403 |
| `https://free-rpc.nethermind.io/mainnet-juno/` | unreachable |

`getEvents` on the public node caps the block span per call, so
`discover_pool_address.mjs` scans backward in 10k-block windows rather than requesting a
single wide range.
