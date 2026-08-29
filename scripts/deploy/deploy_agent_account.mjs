/**
 * Deploy the MarginGuard guardian account with starknet.js.
 *
 * This is intentionally separate from the full protocol deployer because the
 * installed starkli release has trouble estimating fresh accounts against the
 * modern Mainnet RPC pending state.
 *
 * The keystore password is entered locally with terminal echo disabled. It is
 * never placed in an environment variable, command line, or log.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { RpcProvider, Account, hash } from "starknet"
import { decryptKeystore } from "./lib_keystore.mjs"

const RPC = process.env.MARGINGUARD_AGENT_RPC || "https://rpc.starknet.lava.build/rpc/v0_8"
const ACCOUNT_PATH = process.env.MARGINGUARD_AGENT_ACCOUNT || "C:\\Users\\Admin\\.starkli\\marginguard_agent_oz.json"
const KEYSTORE_PATH = process.env.MARGINGUARD_AGENT_KEYSTORE || "C:\\Users\\Admin\\.starkli\\marginguard_agent_keystore.json"

function hiddenPassword(prompt) {
  const input = process.stdin
  if (!input.isTTY || !input.setRawMode) {
    throw new Error("Run this command in an interactive terminal")
  }

  process.stdout.write(prompt)
  input.setRawMode(true)
  input.resume()

  return new Promise((resolve, reject) => {
    let password = ""
    const onData = (chunk) => {
      const text = chunk.toString("utf8")
      for (const char of text) {
        if (char === "\u0003") {
          cleanup()
          reject(new Error("Cancelled"))
          return
        }
        if (char === "\r" || char === "\n") {
          cleanup()
          process.stdout.write("\n")
          resolve(password)
          return
        }
        if (char === "\u007f" || char === "\b") {
          password = password.slice(0, -1)
        } else {
          password += char
        }
      }
    }
    function cleanup() {
      input.off("data", onData)
      input.setRawMode(false)
      input.pause()
    }
    input.on("data", onData)
  })
}

const config = JSON.parse(readFileSync(ACCOUNT_PATH, "utf8"))
const address = config.deployment.address || hash.calculateContractAddressFromHash(
  config.deployment.salt,
  config.deployment.class_hash,
  [config.variant.public_key],
  0,
)

const provider = new RpcProvider({ nodeUrl: RPC })
const deployed = await provider.getClassHashAt(address).then(() => true).catch(() => false)

if (deployed) {
  console.log(`Guardian account is already deployed: ${address}`)
  process.exit(0)
}

const password = await hiddenPassword("Guardian keystore password: ")
const signer = decryptKeystore(KEYSTORE_PATH, password)
const account = new Account({ provider, address, signer })

console.log(`Deploying guardian account: ${address}`)
const result = await account.deployAccount({
  classHash: config.deployment.class_hash,
  constructorCalldata: [config.variant.public_key],
  addressSalt: config.deployment.salt,
}, { blockIdentifier: "latest", tip: BigInt(0) })

await provider.waitForTransaction(result.transaction_hash)

config.deployment.status = "deployed"
config.deployment.address = address
writeFileSync(ACCOUNT_PATH, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })

console.log(`Guardian account deployed: ${address}`)
console.log(`Transaction: ${result.transaction_hash}`)
