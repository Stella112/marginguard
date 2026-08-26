/**
 * Discovers the STRK20 privacy pool address on Starknet mainnet, from the chain itself.
 *
 * Why this exists: the vendored documentation publishes only the *Sepolia* pool address
 * (`0x0254a6b2...`). The mainnet address is not in the docs, and MarginGuardVenue is a
 * stateful anonymizer, so per the STRK20 security checklist it must pin the pool address in
 * its constructor and assert the caller — a self-declared `pool_address` parameter is not
 * access control for a contract that holds funds.
 *
 * How: the already-deployed echo helper (cairo/src/lib.cairo, mainnet
 * 0x78ae66...8735b) asserts `pool_address == get_caller_address()` and then emits that
 * caller in its `Invoked` event. So any successful invoke on mainnet is a signed statement,
 * by the pool itself, of the pool's own address.
 *
 * Usage:  node scripts/discover_pool_address.mjs
 */

import { hash } from "starknet"

const HELPER = "0x78ae662e0cc6d1ab2cfeaf2a51ba8783d88e31886f88a794d142f95a6f8735b"

// Public mainnet endpoints, tried in order. No API key required.
const RPCS = [
  "https://starknet-mainnet.public.blastapi.io/rpc/v0_7",
  "https://free-rpc.nethermind.io/mainnet-juno/",
  "https://rpc.starknet.lava.build",
]

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`${url} -> ${JSON.stringify(json.error)}`)
  return json.result
}

async function firstWorking() {
  for (const url of RPCS) {
    try {
      const n = await rpc(url, "starknet_blockNumber", [])
      console.log(`rpc      : ${url} (block ${n})`)
      return { url, head: n }
    } catch (e) {
      console.log(`rpc      : ${url} unavailable — ${e.message}`)
    }
  }
  throw new Error("no working mainnet RPC endpoint")
}

const { url, head } = await firstWorking()

// Has the helper ever run?
const count = await rpc(url, "starknet_call", [
  { contract_address: HELPER, entry_point_selector: selector("get_invoke_count"), calldata: [] },
  "latest",
])
console.log(`invokes  : ${BigInt(count[0])}`)

if (BigInt(count[0]) === 0n) {
  console.log("\nThe helper has never been invoked, so no Invoked event exists to read.")
  console.log("Run one private invoke through it, then re-run this script.")
  process.exit(2)
}

// Walk back for the Invoked event. `caller` is the last field in the event data
// (note_id is the keyed field; data is [amount, caller]).
//
// Public nodes cap the span a single getEvents call may cover, so scan backward in
// windows rather than asking for the whole chain at once.
const WINDOW = 10_000
const MAX_LOOKBACK = 400_000
let found = []

for (let offset = 0; offset < MAX_LOOKBACK && found.length === 0; offset += WINDOW) {
  const to = head - offset
  const from = Math.max(0, to - WINDOW)
  try {
    const page = await rpc(url, "starknet_getEvents", [
      {
        from_block: { block_number: from },
        to_block: { block_number: to },
        address: HELPER,
        chunk_size: 100,
      },
    ])
    if (page.events?.length) {
      found = page.events
      console.log(`window   : blocks ${from}–${to}`)
    }
  } catch (e) {
    console.log(`window   : blocks ${from}–${to} failed — ${e.message}`)
  }
}

if (!found.length) {
  console.log(`\nNo events in the last ${MAX_LOOKBACK} blocks. Raise MAX_LOOKBACK and retry.`)
  process.exit(2)
}

console.log(`events   : ${found.length} found\n`)
const callers = new Set()
for (const ev of found) {
  const caller = ev.data?.[ev.data.length - 1]
  callers.add(caller)
  console.log(`  block ${ev.block_number}  tx ${ev.transaction_hash}`)
  console.log(`  caller: ${caller}`)
}

console.log(`\ndistinct callers: ${callers.size}`)
for (const c of callers) console.log(`  POOL ADDRESS -> ${c}`)

function selector(name) {
  return hash.getSelectorFromName(name)
}
