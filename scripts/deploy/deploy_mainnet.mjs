/**
 * One-shot MAINNET deployment via starknet.js — deploys the OZ account (if needed), then the
 * full MarginGuard system with the real Ekubo TWAP oracle.
 *
 * Uses starknet.js throughout because starkli 0.4.2 can't talk to the modern mainnet nodes
 * (spec/`pending`-tag mismatches). starknet.js manages block tags itself and is proven against
 * spec 0.8.1 (rpc.starknet.lava.build).
 *
 * Env:
 *   STARKNET_RPC                (default lava 0.8.1)
 *   STARKNET_ACCOUNT            path to the OZ account json (address/class/salt/pubkey)
 *   STARKNET_KEYSTORE           encrypted keystore
 *   STARKNET_KEYSTORE_PASSWORD  to decrypt it
 *   POOL                        mainnet STRK20 pool
 *   EKUBO_ORACLE               Ekubo oracle extension (mainnet)
 *   TWAP_PERIOD                 seconds (default 1800)
 *
 * The private key is decrypted in-memory only, never printed or written.
 */

import { readFileSync, writeFileSync } from "fs"
import { RpcProvider, Account, CallData, hash } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const RPC = process.env.STARKNET_RPC || "https://rpc.starknet.lava.build"
const ACCOUNT = must("STARKNET_ACCOUNT")
const KEYSTORE = must("STARKNET_KEYSTORE")
const PASSWORD = must("STARKNET_KEYSTORE_PASSWORD")
const POOL = must("POOL")
const EKUBO = must("EKUBO_ORACLE")
const TWAP_PERIOD = process.env.TWAP_PERIOD || "1800"

const DEV = new URL("../../contracts/target/dev/", import.meta.url)

function must(n) {
  const v = process.env[n]
  if (!v) { console.error(`Set ${n}`); process.exit(1) }
  return v
}
function artifacts(name) {
  return {
    sierra: JSON.parse(readFileSync(new URL(`marginguard_${name}.contract_class.json`, DEV))),
    casm: JSON.parse(readFileSync(new URL(`marginguard_${name}.compiled_contract_class.json`, DEV))),
  }
}

const provider = new RpcProvider({ nodeUrl: RPC })
const accJson = JSON.parse(readFileSync(ACCOUNT, "utf8"))
const address = accJson.deployment.address || hash.calculateContractAddressFromHash(
  accJson.deployment.salt,
  accJson.deployment.class_hash,
  [accJson.variant.public_key],
  0,
)
const account = new Account({ provider, address, signer: decryptKeystore(KEYSTORE, PASSWORD) })

console.log(`RPC     : ${RPC}`)
console.log(`account : ${address}`)
console.log(`pool    : ${POOL}`)
console.log(`ekubo   : ${EKUBO} (TWAP ${TWAP_PERIOD}s)\n`)

// ── Deploy the account if it isn't on chain yet ──────────────────────────────
let deployed = false
try {
  await provider.getClassHashAt(address)
  deployed = true
} catch {
  deployed = false
}
if (!deployed) {
  console.log("==> deploying OZ account")
  const res = await account.deployAccount({
    classHash: accJson.deployment.class_hash,
    constructorCalldata: [accJson.variant.public_key],
    addressSalt: accJson.deployment.salt,
  })
  await provider.waitForTransaction(res.transaction_hash)
  console.log(`    account live (tx ${res.transaction_hash})\n`)
} else {
  console.log("==> account already deployed\n")
}

// ── Declare + deploy the system ──────────────────────────────────────────────
async function declare(name) {
  const { sierra, casm } = artifacts(name)
  console.log(`==> declaring ${name}`)
  const res = await account.declareIfNot({ contract: sierra, casm })
  if (res.transaction_hash) await provider.waitForTransaction(res.transaction_hash)
  console.log(`    class ${res.class_hash}`)
  return res.class_hash
}
async function deploy(name, classHash, constructorCalldata) {
  console.log(`==> deploying ${name}`)
  const res = await account.deployContract({ classHash, constructorCalldata })
  await provider.waitForTransaction(res.transaction_hash)
  console.log(`    ${name} : ${res.contract_address}`)
  return res.contract_address
}
async function invoke(label, contractAddress, entrypoint, calldata) {
  console.log(`==> ${label}`)
  const res = await account.execute({ contractAddress, entrypoint, calldata })
  await provider.waitForTransaction(res.transaction_hash)
  console.log(`    tx ${res.transaction_hash}`)
}

const registryClass = await declare("AgentRegistry")
const oracleClass = await declare("EkuboTwapOracle")
const perpClass = await declare("PerpEngine")
const bookClass = await declare("OrderBook")
const venueClass = await declare("MarginGuardVenue")

const registry = await deploy("AgentRegistry", registryClass, [])
const oracle = await deploy("EkuboTwapOracle", oracleClass, CallData.compile({ ekubo_oracle: EKUBO, period: TWAP_PERIOD }))
const perp = await deploy("PerpEngine", perpClass, CallData.compile({ oracle }))
const book = await deploy("OrderBook", bookClass, [])
const venue = await deploy("MarginGuardVenue", venueClass, CallData.compile({ privacy_pool: POOL, order_book: book }))

await invoke("book.initialize_venue", book, "initialize_venue", [venue])
await invoke("registry.initialize_executor", registry, "initialize_executor", [perp])
await invoke("perp.initialize_agent_registry", perp, "initialize_agent_registry", [registry])

const summary = [
  "",
  "============ DEPLOYED — FULL (MAINNET) ============",
  `AgentRegistry    : ${registry}`,
  `EkuboTwapOracle  : ${oracle}`,
  `PerpEngine       : ${perp}`,
  `OrderBook        : ${book}`,
  `MarginGuardVenue : ${venue}`,
  `privacy pool     : ${POOL}`,
  `ekubo oracle     : ${EKUBO} (TWAP ${TWAP_PERIOD}s)`,
  "==================================================",
].join("\n")
console.log(summary)
writeFileSync(new URL("deploy-result-mainnet.txt", import.meta.url), summary)
