# Verified addresses

Everything here was checked against Starknet mainnet, not copied from documentation.
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
