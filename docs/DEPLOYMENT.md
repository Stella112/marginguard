# Deployment

MarginGuard deploys three contracts: `AgentRegistry`, `OrderBook`, and `MarginGuardVenue`.
The venue is pinned to the STRK20 privacy pool for its network, and the book is wired to the
venue after both are live.

The plan is **Sepolia first, then mainnet** — a testnet run proves the scripts and de-risks the
mainnet gas spend.

## What you do vs. what the script does

**You**, once: install a wallet, fund it, and export an account descriptor and an encrypted
keystore for `starkli`. Your private key stays in the encrypted keystore on your machine.
Claude never sees it, never asks for it, and never types it.

**The script** (`scripts/deploy/deploy.ps1`): declares the three classes, deploys the two that
need addresses, and calls `initialize_venue`. It signs by pointing `starkli` at your keystore,
which prompts *you* for the keystore password at signing time.

## Toolchain (already installed)

| Tool | Location | Purpose |
| --- | --- | --- |
| Scarb 2.18.0 | `C:\Users\Admin\tools\scarb-…\bin\scarb.exe` | build the contracts |
| starkli 0.4.2 | `C:\Users\Admin\tools\starkli\starkli.exe` | declare / deploy / invoke |

Build the artifacts before deploying:

```bash
cd contracts && scarb build
```

This writes `contracts/target/dev/marginguard_*.contract_class.json`, which the deploy script
consumes.

---

## Step 1 — a funded account (you)

### Sepolia (dry run)

1. Install **Ready** (formerly Argent X) or **Braavos** as a browser extension, create an
   account, and switch it to the **Sepolia** network.
2. Fund it from a faucet — e.g. the Starknet Sepolia faucet — with a small amount of test STRK.
   Deployment costs a fraction of a token.

### Mainnet (after the dry run succeeds)

Same wallet, mainnet network, funded with a small amount of real ETH or STRK for gas.

## Step 2 — expose the account to starkli (you)

`starkli` needs two files: an **account descriptor** and an **encrypted keystore**. The clean
path that never exposes a raw key:

```bash
# Create an encrypted keystore from the account's signing key. starkli prompts for the
# private key (paste it into starkli, not into chat) and a password to encrypt it with.
starkli signer keystore from-key C:\Users\Admin\.starkli\keystore.json

# Fetch the account descriptor for your already-deployed wallet address.
starkli account fetch <YOUR_WALLET_ADDRESS> \
  --rpc <RPC_URL> \
  --output C:\Users\Admin\.starkli\account.json
```

> The keystore is encrypted at rest with your password. That is the only place the key lives.
> Do not paste the private key into this chat — paste it only into the `starkli` prompt.

## Step 3 — set environment and run (you, with the prepared script)

Pick the RPC and pool for the target network:

| Network | RPC (public, no key) | STRK20 pool |
| --- | --- | --- |
| Sepolia | `https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_8` | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Mainnet | `https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_8` | `0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

> **RPC spec matters.** starkli 0.4.2 speaks JSON-RPC **0.8**. Most public nodes now default
> to 0.9–0.10 and reject starkli's requests with `Invalid block id`. Use a `…/rpc/v0_8`
> versioned path. Cartridge's, above, serves spec 0.8.1 and needs no API key. Verify any
> substitute with `starknet_specVersion` before relying on it.

> **Account must be deployed first.** On Starknet, receiving funds does not create the account
> contract — it is deployed by its first outgoing transaction. Activate the account in the
> wallet (send any small amount, or use the wallet's "Activate/Deploy account" action) before
> `account fetch`, or it returns `Contract not found`.

```powershell
$env:STARKNET_ACCOUNT  = "C:\Users\Admin\.starkli\account.json"
$env:STARKNET_KEYSTORE = "C:\Users\Admin\.starkli\keystore.json"
$env:STARKNET_RPC      = "https://free-rpc.nethermind.io/sepolia-juno/"

powershell -File scripts\deploy\deploy.ps1 -Pool 0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91
```

The script prints each class hash and address, then a summary block. `starkli` will prompt for
the keystore password when it signs.

## Step 4 — record the addresses

Copy the deployed addresses into [`ADDRESSES.md`](ADDRESSES.md) and, for mainnet, into
[`strk20.json`](../strk20.json) alongside the transaction hashes.

## Sepolia pool addresses reference

The Sepolia STRK20 privacy pool (v2.0) is documented at
`0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`. The mainnet pool address
is not published in the STRK20 docs and was established from chain data — see
[`ADDRESSES.md`](ADDRESSES.md) for how.

## After deployment: the private end-to-end flow

Deploying the contracts is necessary but not the whole demo. Driving a real *private* trade
means the pool calls the venue via `InvokeExternal`, which requires the STRK20 Wallet API /
SDK (proving included). That flow — fund, place, match, both sides claim into open notes — is
the frontend's job and is wired in Phase 5. The contracts above are what it targets.
