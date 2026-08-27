# Mainnet deployment runbook

Deploys the full MarginGuard system to Starknet **mainnet**, with the real **Ekubo TWAP oracle**.
You run the signing (real funds); Claude prepares the commands and verifies on-chain.

## Cost

Mainnet L2 gas price ≈ Sepolia's, so budget **~40–70 STRK** (declares dominate). Fund the deploy
account with **~80 STRK** for headroom. This is real money — a modest but genuine spend.

## Verified mainnet inputs

| Thing | Value |
| --- | --- |
| RPC | `https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_8` |
| STRK20 pool | `0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Ekubo oracle extension | `0x005e470ff654d834983a46b8f29dfa99963d5044b993cb7b9c92243a69dab38f` |
| TWAP period | `1800` (30 min) |

## Step 1 — a fresh single-signer keystore (you)

Argent/Ready accounts carry a guardian (two signatures) and can't be driven by a single-key
signer, so we make a fresh key just for deployment. In your own terminal:

```
C:\Users\Admin\tools\starkli\starkli.exe signer keystore new C:\Users\Admin\.starkli\mainnet_keystore.json
```

Set a **brand-new password you have never used and will not screenshot**. It prints a public key.

## Step 2 — the deploy account address (you)

```
C:\Users\Admin\tools\starkli\starkli.exe account oz init C:\Users\Admin\.starkli\mainnet_oz.json --keystore C:\Users\Admin\.starkli\mainnet_keystore.json
```

It prints an address like `0x…`. That is your **mainnet deploy account**. Paste it back to Claude.

## Step 3 — fund it (you)

Send **~80 STRK** from your mainnet wallet to that address. Tell Claude "sent" — Claude verifies
the balance landed.

## Step 4 — deploy the account (you)

```
C:\Users\Admin\tools\starkli\starkli.exe account deploy C:\Users\Admin\.starkli\mainnet_oz.json --keystore C:\Users\Admin\.starkli\mainnet_keystore.json --rpc https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_8
```

Enter your keystore password when prompted.

## Step 5 — deploy the full system (you)

```powershell
$env:STARKNET_ACCOUNT="C:\Users\Admin\.starkli\mainnet_oz.json"
$env:STARKNET_KEYSTORE="C:\Users\Admin\.starkli\mainnet_keystore.json"
$env:STARKNET_KEYSTORE_PASSWORD="<your fresh password>"
$env:STARKNET_RPC="https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_8"
$env:POOL="0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
$env:EKUBO_ORACLE="0x005e470ff654d834983a46b8f29dfa99963d5044b993cb7b9c92243a69dab38f"
$env:TWAP_PERIOD="1800"
node C:\stark\scripts\deploy\deploy_full_sjs.mjs
```

It declares and deploys all five contracts (with the **EkuboTwapOracle** on mainnet), wires the
three bindings, and prints a `DEPLOYED — FULL (mainnet)` block, also saved to
`scripts/deploy/deploy-result-full.txt`.

## Step 6 — record (Claude)

Paste the DEPLOYED block back. Claude verifies every binding on-chain, records the mainnet
addresses in ADDRESSES.md and strk20.json, and points the frontend at the mainnet deployment.

> Password note: setting `STARKNET_KEYSTORE_PASSWORD` puts it in your shell history. On mainnet,
> prefer to omit it and type the password at each prompt. If you do set it, clear your history
> afterwards.
