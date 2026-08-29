# Verified addresses

Everything here was checked against the chain, not copied from documentation.

## MarginGuard — MAINNET deployment (FULL system, live)

Deployed 2026-08-28 via `scripts/deploy/swap_oracle_mainnet.mjs`. The current mainnet perp
engine uses the **Pragma STRK/USD median oracle**, and the earlier Ekubo deployment is retained
below only as superseded history.

| Contract | Mainnet address |
| --- | --- |
| AgentRegistry | `0x05b99dcb0d9995a112c1e12ea1695247a43811f586513027bb6d1057bc673e55` |
| **PragmaOracle** | `0x038d443ba8d1bc4dc914ff2aadf9acbd3c0785c376b66986c7e7520090f5c1af` |
| PerpEngine | `0x00aaa439cf40d1d535e7d58245443461fbff2ce7ed272b441cc09683a741354c` |
| OrderBook | `0x03cc0b36be4110edad405125c38b139907d6da371ab7661161265f29408b514c` |
| MarginGuardVenue | `0x01add9644c5c302745548a67fa65b173f71ecbe9a1ab1c3fcd12dd34515042f0` |
| STRK20 pool (mainnet) | `0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Pragma oracle (source) | `0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b` (STRK/USD) |

> **Oracle swapped to Pragma.** The first mainnet deploy used an Ekubo TWAP adapter, but its
> oracle-extension pool reads ~3x above the real market (thin, un-arbitraged pools). Verified
> against Pragma (11 sources, matches CEX). The oracle was swapped to `PragmaOracle`, which
> required redeploying the perp engine + agent registry (their oracle/executor bindings are
> immutable). `PerpEngine.oracle().get_price(STRK, USDC)` now returns the real ~$0.0248.
> Superseded (still on-chain): AgentRegistry `0x068aba2f…4e608`, EkuboTwapOracle `0x045ec9d0…92e0d7`,
> PerpEngine `0x02c61d3c…352983`.

Deploy account (single-signer OZ): `0x01ba464d9a5855984c58fa851179775963271681d1627945e6e13b0d77e3b097`
Account deploy tx: `0x58f6c9a7ae8cb728ae3f9671ad20673c07810e3e43b770aeea3c48ec9521df4`
Wiring txs: `0x659d7ce9cd26830bc1c36977e5b0757351f1c81fe87d6522392d54386dab3a3`,
`0x3ef1fb374375cd6146ea605dd2937ecca54e5b690bcf33d843efb2e8227932e`,
`0x6d12e0d8cb4f6e06f0fc6647f92c6c499cc7e3db489e32cab713a324639e885`.

## MarginGuard — Sepolia deployment (FULL system, live)

Deployed 2026-08-27 via `scripts/deploy/deploy_full_sjs.mjs` (starknet.js v10.4.0). All five
classes present, and every binding verified on-chain: `book.venue()`, `registry.executor()`,
`perp.agent_registry()`, `perp.oracle()`, and `venue.privacy_pool()` all resolve correctly.

| Contract | Address |
| --- | --- |
| AgentRegistry | `0x064a7c3a09c040fa119990ce0a849e0451e134155389b4debd9fd535319aa487` |
| ManualOracle (Ekubo-TWAP stand-in) | `0x07cb6c35ab8313f2ce9bbe3427504f72fa57288f1180c68af1416567f2673a14` |
| PerpEngine | `0x00579523cbadd6a1228f66ba0265fa86dacf8d2239c0c685ad236860da78a3c5` |
| OrderBook | `0x071960e31d69f11e7a9342124d60b019bce57b8f848174c2a079b509c40aec61` |
| MarginGuardVenue | `0x04c5575b5342aca8a6bce5199e3bfeb70ace94670985dfc21b0120224a0b056e` |
| STRK20 pool (Sepolia) | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |

Deployer account (single-signer OZ, no guardian):
`0x03e7f18a3bc53ec2229a65fdff51659c16e1304e02f0b6db144353a222ace2d1`

Wiring txs: book→venue `0x5ca89008343f3bebd1484095a3d8f02dc0c91012b0aa75999c4202da954270f`,
registry→executor `0x6c346316a02f6c3957241278c2bcfe847deb0acc6938ebdbf3b42d5852cedab`,
perp→registry `0x6c6e01c8a075fc3479784e70caaeba298865c4757fd13416b473e759496b887`.

### Superseded first deployment (spot-only, still live)

The initial spot-only deploy (before the viewing-key grant) remains on-chain but is superseded by
the full system above: AgentRegistry `0x03ed6b59…bdb8`, OrderBook `0x03a7be95…8bb0`,
MarginGuardVenue `0x05c10c42…8a4f`.

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
- [x] Mainnet oracle read interface: Pragma STRK/USD median adapter
- [ ] Ekubo router address, swap selector, and exact calldata shape for the spot fallback

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
