/**
 * Decrypts a starkli (eth-keystore v3) keystore to its private key.
 *
 * Format: scrypt KDF + aes-128-ctr, MAC = keccak256(derivedKey[16:32] || ciphertext).
 * Used only to let starknet.js sign the Sepolia deploy; the key is never printed or written.
 */

import { readFileSync } from "fs"
import { scrypt } from "@noble/hashes/scrypt.js"
import { keccak_256 } from "@noble/hashes/sha3.js"
import { ctr } from "@noble/ciphers/aes.js"
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js"

export function decryptKeystore(path, password) {
  const ks = JSON.parse(readFileSync(path, "utf8"))
  const c = ks.crypto
  if (c.kdf !== "scrypt") throw new Error(`unsupported kdf: ${c.kdf}`)
  if (c.cipher !== "aes-128-ctr") throw new Error(`unsupported cipher: ${c.cipher}`)

  const { n, r, p, dklen, salt } = c.kdfparams
  const derived = scrypt(new TextEncoder().encode(password), hexToBytes(salt), {
    N: n,
    r,
    p,
    dkLen: dklen,
  })

  const ciphertext = hexToBytes(c.ciphertext)
  // MAC verification: keccak256(derived[16:32] || ciphertext).
  const mac = bytesToHex(keccak_256(new Uint8Array([...derived.slice(16, 32), ...ciphertext])))
  if (mac.toLowerCase() !== c.mac.toLowerCase()) {
    throw new Error("MAC mismatch — wrong keystore password")
  }

  const key = derived.slice(0, 16)
  const iv = hexToBytes(c.cipherparams.iv)
  const plain = ctr(key, iv).decrypt(ciphertext)
  return "0x" + bytesToHex(plain)
}
