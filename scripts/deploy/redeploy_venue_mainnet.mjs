/**
 * Redeploys the OrderBook and the MarginGuardVenue on MAINNET, then binds them.
 *
 * Why both: the venue gained Withdraw and Cancel, so it must be redeployed - but the book's
 * `initialize_venue` asserts `venue.is_zero()` and is therefore one-time. The live book is
 * already bound to the old venue, so a new venue needs a new book to bind to.
 *
 * Nothing else moves. AgentRegistry, PragmaOracle and PerpEngine are untouched and keep
 * their current addresses; only spot trading is affected.
 *
 * The old venue keeps whatever it holds. Balances do not migrate, and the old venue has no
 * Withdraw, so anything reserved there stays reserved. Deploying does not make that worse -
 * it is already unreachable - but it does not fix it either.
 *
 * Env:
 *   STARKNET_RPC                (default lava 0.8.1)
 *   STARKNET_ACCOUNT            path to the OZ account json
 *   STARKNET_KEYSTORE           encrypted keystore
 *   STARKNET_KEYSTORE_PASSWORD  to decrypt it
 *   POOL                        mainnet STRK20 pool
 *
 * The private key is decrypted in memory only, never printed or written.
 */

import { readFileSync, writeFileSync } from "fs"
import { RpcProvider, Account } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const DEV = new URL("../../contracts/target/dev/", import.meta.url)
const RPC = process.env.STARKNET_RPC || "https://rpc.starknet.lava.build"

function must(n) {
  const v = process.env[n]
  if (!v) {
    console.error(`Set ${n}`)
    process.exit(1)
  }
  return v
}

const ACCOUNT = must("STARKNET_ACCOUNT")
const KEYSTORE = must("STARKNET_KEYSTORE")
const PASSWORD = must("STARKNET_KEYSTORE_PASSWORD")
const POOL = must("POOL")

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

const bookClass = await declare("OrderBook")
const venueClass = await declare("MarginGuardVenue")

const book = await deploy("OrderBook", bookClass, [])
// The venue's constructor takes the book, so the book is deployed first and bound after.
const venue = await deploy("MarginGuardVenue", venueClass, [POOL, book])
await invoke("binding book -> venue", book, "initialize_venue", [venue])

const bound = await provider.callContract({ contractAddress: book, entrypoint: "venue", calldata: [] })
const ok = BigInt(bound[0]) === BigInt(venue)
console.log(`\nbinding verified: ${ok ? "yes" : "NO - do not use this deployment"}`)

const result = [
  `orderBook = ${book}`,
  `venue     = ${venue}`,
  `pool      = ${POOL}`,
  `bound     = ${ok}`,
  ``,
  `Update MG.orderBook and MG.venue in src/utils/marginguard.ts, then docs/ADDRESSES.md.`,
  `AgentRegistry, PragmaOracle and PerpEngine are unchanged.`,
].join("\n")

writeFileSync(new URL("redeploy-venue-result.txt", import.meta.url), result + "\n")
console.log(`\n${result}`)
if (!ok) process.exit(1)
