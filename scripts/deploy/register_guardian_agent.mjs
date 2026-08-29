/**
 * Register the MarginGuard guardian signing key from the already-deployed
 * operator account.
 *
 * The guardian is an off-chain STARK signing key. It does not need its own
 * Starknet account or gas. The deployed operator account submits this one
 * registration transaction; later the engine executor submits proposals that
 * are signed by the guardian key.
 */

import { readFileSync } from "node:fs"
import { RpcProvider, Account } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const RPC = process.env.MARGINGUARD_AGENT_RPC || "https://rpc.starknet.lava.build/rpc/v0_9"
const OPERATOR_ACCOUNT = process.env.MARGINGUARD_OPERATOR_ACCOUNT || "C:\\Users\\Admin\\.starkli\\mainnet_oz.json"
const OPERATOR_KEYSTORE = process.env.MARGINGUARD_OPERATOR_KEYSTORE || "C:\\Users\\Admin\\.starkli\\mainnet_keystore.json"
const REGISTRY = process.env.MARGINGUARD_AGENT_REGISTRY || "0x05b99dcb0d9995a112c1e12ea1695247a43811f586513027bb6d1057bc673e55"
const GUARDIAN_KEYSTORE = process.env.MARGINGUARD_GUARDIAN_KEYSTORE || "C:\\Users\\Admin\\.starkli\\marginguard_agent_keystore.json"

function hiddenPassword(prompt) {
  const input = process.stdin
  if (!input.isTTY || !input.setRawMode) throw new Error("Run this command in an interactive terminal")
  process.stdout.write(prompt)
  input.setRawMode(true)
  input.resume()
  return new Promise((resolve, reject) => {
    let value = ""
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") { cleanup(); reject(new Error("Cancelled")); return }
        if (char === "\r" || char === "\n") { cleanup(); process.stdout.write("\n"); resolve(value); return }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1)
        else value += char
      }
    }
    function cleanup() { input.off("data", onData); input.setRawMode(false); input.pause() }
    input.on("data", onData)
  })
}

// Public key only; the private key remains inside the encrypted keystore used
// by the future guardian worker. This value is safe to commit.
const guardianPublicKey = "0x07e54dfa26f4aa4a4f0ce5ab48a8f38ab363e003cb0c333b50c0b9ea24c4d2e9"

const operator = JSON.parse(readFileSync(OPERATOR_ACCOUNT, "utf8"))
const operatorAddress = operator.deployment.address
if (!operatorAddress) throw new Error("Operator account descriptor has no deployed address")

const password = await hiddenPassword("Operator keystore password: ")
const provider = new RpcProvider({ nodeUrl: RPC, specVersion: "0.9.0", retries: 3 })
const account = new Account({ provider, address: operatorAddress, signer: decryptKeystore(OPERATOR_KEYSTORE, password) })

// Policy: up to +50% margin, up to 30% size reduction, max 5x leverage, close allowed.
const result = await account.execute({
  contractAddress: REGISTRY,
  entrypoint: "register_agent",
  calldata: [guardianPublicKey, 5000, 3000, 5, 1],
}, { tip: BigInt(0) })
await provider.waitForTransaction(result.transaction_hash)

console.log(`Guardian registered under operator address: ${operatorAddress}`)
console.log(`Transaction: ${result.transaction_hash}`)
