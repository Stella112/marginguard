/**
 * MAINNET oracle swap: Ekubo (thin, ~3x off) -> Pragma (accurate, multi-source).
 *
 * The perp engine's oracle and the registry↔engine binding are set at construction and are
 * immutable, so switching oracles means redeploying the PragmaOracle + a new PerpEngine (using
 * the already-declared class, pointed at Pragma) + a new AgentRegistry, then re-wiring those two.
 * The OrderBook and MarginGuardVenue are oracle-independent and stay as they are.
 *
 * Only the PragmaOracle is a new class declare; the perp/registry classes are already declared
 * on mainnet, so their redeploys are cheap.
 *
 * Env: STARKNET_RPC, STARKNET_ACCOUNT, STARKNET_KEYSTORE, STARKNET_KEYSTORE_PASSWORD.
 */

import { readFileSync, writeFileSync } from "fs"
import { RpcProvider, Account, CallData, shortString } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const RPC = process.env.STARKNET_RPC || "https://rpc.starknet.lava.build"
const ACCOUNT = must("STARKNET_ACCOUNT")
const KEYSTORE = must("STARKNET_KEYSTORE")
const PASSWORD = must("STARKNET_KEYSTORE_PASSWORD")

// Verified mainnet inputs.
const PRAGMA = "0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b"
const PAIR_ID = shortString.encodeShortString("STRK/USD")
const BASE_DECIMALS = "18" // STRK
const QUOTE_DECIMALS = "6" // USDC

const DEV = new URL("../../contracts/target/dev/", import.meta.url)

function must(n) { const v = process.env[n]; if (!v) { console.error(`Set ${n}`); process.exit(1) } return v }
function artifacts(name) {
  return {
    sierra: JSON.parse(readFileSync(new URL(`marginguard_${name}.contract_class.json`, DEV))),
    casm: JSON.parse(readFileSync(new URL(`marginguard_${name}.compiled_contract_class.json`, DEV))),
  }
}

const provider = new RpcProvider({ nodeUrl: RPC })
const accJson = JSON.parse(readFileSync(ACCOUNT, "utf8"))
const account = new Account({ provider, address: accJson.deployment.address, signer: decryptKeystore(KEYSTORE, PASSWORD) })

console.log(`RPC     : ${RPC}`)
console.log(`account : ${accJson.deployment.address}`)
console.log(`pragma  : ${PRAGMA} (STRK/USD)\n`)

async function declare(name) {
  const { sierra, casm } = artifacts(name)
  console.log(`==> declaring ${name}`)
  const res = await account.declareIfNot({ contract: sierra, casm })
  if (res.transaction_hash) await provider.waitForTransaction(res.transaction_hash)
  console.log(`    class ${res.class_hash}`)
  return res.class_hash
}
async function deploy(name, classHash, calldata) {
  console.log(`==> deploying ${name}`)
  const res = await account.deployContract({ classHash, constructorCalldata: calldata })
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

const oracleClass = await declare("PragmaOracle")
const registryClass = await declare("AgentRegistry")
const perpClass = await declare("PerpEngine")

const oracle = await deploy(
  "PragmaOracle",
  oracleClass,
  CallData.compile({ pragma: PRAGMA, pair_id: PAIR_ID, base_decimals: BASE_DECIMALS, quote_decimals: QUOTE_DECIMALS }),
)
const registry = await deploy("AgentRegistry", registryClass, [])
const perp = await deploy("PerpEngine", perpClass, CallData.compile({ oracle }))

await invoke("registry.initialize_executor", registry, "initialize_executor", [perp])
await invoke("perp.initialize_agent_registry", perp, "initialize_agent_registry", [registry])

const summary = [
  "",
  "======== ORACLE SWAP — MAINNET (Pragma) ========",
  `PragmaOracle   : ${oracle}`,
  `PerpEngine     : ${perp}   (new, Pragma-fed)`,
  `AgentRegistry  : ${registry}   (new, bound to new perp)`,
  "OrderBook / MarginGuardVenue: unchanged",
  "================================================",
].join("\n")
console.log(summary)
writeFileSync(new URL("swap-oracle-result.txt", import.meta.url), summary)
