/**
 * MarginGuard deployment via starknet.js v10.4.0.
 *
 * Why not starkli: starkli 0.4.2 computes the compiled-class-hash with a formula older than
 * Starknet 0.14.3, so its DECLARE is rejected with a class-hash mismatch. starknet.js v10.4.0
 * uses the current formula (verified to match the network exactly), so it declares cleanly.
 *
 * Scope: AgentRegistry, OrderBook, MarginGuardVenue, then OrderBook.initialize_venue.
 *
 * Env:
 *   STARKNET_RPC       (default: Cartridge Sepolia v0_8)
 *   STARKNET_ACCOUNT   path to the starkli account json (address + variant)
 *   STARKNET_KEYSTORE  path to the encrypted keystore
 *   STARKNET_KEYSTORE_PASSWORD  to decrypt it
 *   POOL               STRK20 privacy pool address for the target network
 *
 * The private key is decrypted in-memory only, never printed or written.
 */

import { readFileSync, writeFileSync } from "fs"
import { RpcProvider, Account, CallData } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const RPC = process.env.STARKNET_RPC || "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_8"
const ACCOUNT = must("STARKNET_ACCOUNT")
const KEYSTORE = must("STARKNET_KEYSTORE")
const PASSWORD = must("STARKNET_KEYSTORE_PASSWORD")
const POOL = must("POOL")

const DEV = new URL("../../contracts/target/dev/", import.meta.url)

function must(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Set ${name}`)
    process.exit(1)
  }
  return v
}

function artifacts(name) {
  const sierra = JSON.parse(readFileSync(new URL(`marginguard_${name}.contract_class.json`, DEV)))
  const casm = JSON.parse(
    readFileSync(new URL(`marginguard_${name}.compiled_contract_class.json`, DEV)),
  )
  return { sierra, casm }
}

const provider = new RpcProvider({ nodeUrl: RPC })
const accountJson = JSON.parse(readFileSync(ACCOUNT, "utf8"))
const address = accountJson.deployment.address
const pk = decryptKeystore(KEYSTORE, PASSWORD)
// starknet.js v10: Account takes a single options object.
const account = new Account({ provider, address, signer: pk })

console.log(`RPC     : ${RPC}`)
console.log(`account : ${address}`)
console.log(`pool    : ${POOL}\n`)

async function declare(name) {
  const { sierra, casm } = artifacts(name)
  console.log(`==> declaring ${name}`)
  // declareIfNot skips the network call if the class is already declared.
  const res = await account.declareIfNot({ contract: sierra, casm })
  if (res.transaction_hash) {
    await provider.waitForTransaction(res.transaction_hash)
    console.log(`    declared, class ${res.class_hash}`)
  } else {
    console.log(`    already declared, class ${res.class_hash}`)
  }
  return res.class_hash
}

async function deploy(name, classHash, constructorCalldata) {
  console.log(`==> deploying ${name}`)
  const res = await account.deployContract({ classHash, constructorCalldata })
  await provider.waitForTransaction(res.transaction_hash)
  console.log(`    ${name} : ${res.contract_address}`)
  return res.contract_address
}

const registryClass = await declare("AgentRegistry")
const bookClass = await declare("OrderBook")
const venueClass = await declare("MarginGuardVenue")

const registryAddr = await deploy("AgentRegistry", registryClass, [])
const bookAddr = await deploy("OrderBook", bookClass, [])
const venueAddr = await deploy(
  "MarginGuardVenue",
  venueClass,
  CallData.compile({ privacy_pool: POOL, order_book: bookAddr }),
)

console.log(`==> OrderBook.initialize_venue(${venueAddr})`)
const wire = await account.execute({
  contractAddress: bookAddr,
  entrypoint: "initialize_venue",
  calldata: [venueAddr],
})
await provider.waitForTransaction(wire.transaction_hash)
console.log(`    wired (tx ${wire.transaction_hash})`)

const summary = [
  "",
  "================ DEPLOYED (Sepolia) ================",
  `AgentRegistry    : ${registryAddr}`,
  `OrderBook        : ${bookAddr}`,
  `MarginGuardVenue : ${venueAddr}`,
  `privacy pool     : ${POOL}`,
  "===================================================",
].join("\n")

console.log(summary)
writeFileSync(new URL("deploy-result.txt", import.meta.url), summary)
