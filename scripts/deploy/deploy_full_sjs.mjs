/**
 * Full MarginGuard deployment via starknet.js — spot + perps + agent + oracle.
 *
 * Deploys AgentRegistry, ManualOracle, PerpEngine, OrderBook, MarginGuardVenue, then wires:
 *   - book.initialize_venue(venue)
 *   - registry.initialize_executor(perp)
 *   - perp.initialize_agent_registry(registry)
 *
 * ManualOracle is the documented testnet stand-in for the mainnet Ekubo TWAP adapter.
 *
 * Env: STARKNET_RPC, STARKNET_ACCOUNT, STARKNET_KEYSTORE, STARKNET_KEYSTORE_PASSWORD, POOL.
 * The key is decrypted in-memory only.
 */

import { readFileSync, writeFileSync } from "fs"
import { RpcProvider, Account, CallData } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const RPC = process.env.STARKNET_RPC || "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_8"
const ACCOUNT = must("STARKNET_ACCOUNT")
const KEYSTORE = must("STARKNET_KEYSTORE")
const PASSWORD = must("STARKNET_KEYSTORE_PASSWORD")
const POOL = must("POOL")
const INITIAL_PRICE = 1500n * 10n ** 18n // 1500, scaled 1e18

const DEV = new URL("../../contracts/target/dev/", import.meta.url)

function must(n) {
  const v = process.env[n]
  if (!v) {
    console.error(`Set ${n}`)
    process.exit(1)
  }
  return v
}
function artifacts(name) {
  return {
    sierra: JSON.parse(readFileSync(new URL(`marginguard_${name}.contract_class.json`, DEV))),
    casm: JSON.parse(readFileSync(new URL(`marginguard_${name}.compiled_contract_class.json`, DEV))),
  }
}

const provider = new RpcProvider({ nodeUrl: RPC })
const accountJson = JSON.parse(readFileSync(ACCOUNT, "utf8"))
const address = accountJson.deployment.address
const account = new Account({ provider, address, signer: decryptKeystore(KEYSTORE, PASSWORD) })

console.log(`RPC     : ${RPC}`)
console.log(`account : ${address}`)
console.log(`pool    : ${POOL}\n`)

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

// Oracle: a real Ekubo TWAP adapter when EKUBO_ORACLE is set (mainnet), else the owner-settable
// ManualOracle stand-in (testnet, where the Ekubo STRK/USDC pool may not exist).
const EKUBO = process.env.EKUBO_ORACLE
const TWAP_PERIOD = process.env.TWAP_PERIOD || "1800"
const oracleName = EKUBO ? "EkuboTwapOracle" : "ManualOracle"

const registryClass = await declare("AgentRegistry")
const oracleClass = await declare(oracleName)
const perpClass = await declare("PerpEngine")
const bookClass = await declare("OrderBook")
const venueClass = await declare("MarginGuardVenue")

const registry = await deploy("AgentRegistry", registryClass, [])
const oracle = await deploy(
  oracleName,
  oracleClass,
  EKUBO
    ? CallData.compile({ ekubo_oracle: EKUBO, period: TWAP_PERIOD })
    : CallData.compile({ owner: address, initial_price: INITIAL_PRICE.toString() }),
)
if (EKUBO) console.log(`    (Ekubo TWAP oracle: ${EKUBO}, period ${TWAP_PERIOD}s)`)
const perp = await deploy("PerpEngine", perpClass, CallData.compile({ oracle }))
const book = await deploy("OrderBook", bookClass, [])
const venue = await deploy(
  "MarginGuardVenue",
  venueClass,
  CallData.compile({ privacy_pool: POOL, order_book: book }),
)

await invoke("book.initialize_venue", book, "initialize_venue", [venue])
await invoke("registry.initialize_executor", registry, "initialize_executor", [perp])
await invoke("perp.initialize_agent_registry", perp, "initialize_agent_registry", [registry])

const netName = RPC.includes("mainnet") ? "mainnet" : "sepolia"
const summary = [
  "",
  `============ DEPLOYED — FULL (${netName}) ============`,
  `AgentRegistry    : ${registry}`,
  `${oracleName.padEnd(16)} : ${oracle}`,
  `PerpEngine       : ${perp}`,
  `OrderBook        : ${book}`,
  `MarginGuardVenue : ${venue}`,
  `privacy pool     : ${POOL}`,
  "==================================================",
].join("\n")
console.log(summary)
writeFileSync(new URL("deploy-result-full.txt", import.meta.url), summary)
