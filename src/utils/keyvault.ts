import { hash, num, type TypedData } from "starknet";

/**
 * Wallet-derived trading keys.
 *
 * The venue and the engine both treat the owner secret as a bearer credential -
 * `do_claim` and `close_position` check `compute_trader_commitment(owner_secret)` rather
 * than a caller address, deliberately, so an order is never linked to a wallet. That made
 * the reveal packet something that had to be kept, and anything kept in a browser can be
 * stolen or lost.
 *
 * Nothing needs keeping if the keys can be recomputed. Every secret, salt and id here is
 * derived from one signature over a fixed message, so:
 *   - no secret is ever written to disk, which removes the theft risk entirely
 *   - the same wallet reproduces the same keys on any machine, in any browser
 *   - ids are derived too, so open positions can be found by scanning the chain rather
 *     than by trusting local state
 *
 * The seed lives in memory for the session only. It is never persisted, never logged and
 * never leaves the page.
 */

/**
 * The chain id is pinned rather than read from the wallet.
 *
 * It is part of the signed message, so the derived keys change if it ever changes. Reading
 * it at runtime would make the whole key tree depend on a lookup that can differ between
 * wallet builds - or fail outright, as `account.getChainId` did. This app is mainnet-only,
 * so the value is a constant and the derivation is stable forever.
 */
const CHAIN_ID = "SN_MAIN";

/** Fixed, human-readable, and free of nonces or timestamps, so the signature is stable. */
export function keyMessage(chainId: string = CHAIN_ID): TypedData {
  return {
    domain: { name: "MarginGuard", version: "1", chainId },
    types: {
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
      TradingKey: [
        { name: "purpose", type: "felt" },
        { name: "version", type: "felt" },
      ],
    },
    primaryType: "TradingKey",
    message: { purpose: "MarginGuard trading keys", version: "1" },
  };
}

const SEED_TAG = hash.starknetKeccak("MG_KEY_SEED:V1").toString();
const SECRET_TAG = hash.starknetKeccak("MG_OWNER_SECRET:V1").toString();
const SALT_TAG = hash.starknetKeccak("MG_SALT:V1").toString();
const POSITION_TAG = hash.starknetKeccak("MG_POSITION_ID:V1").toString();
const ORDER_TAG = hash.starknetKeccak("MG_ORDER_ID:V1").toString();

/** Normalizes the several shapes wallets return a signature in. */
function signatureParts(signature: unknown): [string, string] {
  const raw: any = signature;
  if (Array.isArray(raw)) {
    // Some wallets prefix the array with a length or a signer count.
    const felts = raw.map((v) => num.toHex(v));
    if (felts.length === 2) return [felts[0], felts[1]];
    if (felts.length > 2) return [felts[felts.length - 2], felts[felts.length - 1]];
  }
  if (raw?.r !== undefined && raw?.s !== undefined) return [num.toHex(raw.r), num.toHex(raw.s)];
  throw new Error("The wallet returned a signature this app could not read.");
}

/** poseidon(SEED_TAG, r, s) - the root every other key hangs off. */
export function seedFromSignature(signature: unknown): string {
  const [r, s] = signatureParts(signature);
  return hash.computePoseidonHashOnElements([SEED_TAG, r, s]);
}

export type DerivedKeys = { id: string; ownerSecret: string; salt: string };

/** Deterministic keys for the nth position of this wallet. */
export function derivePosition(seed: string, index: number): DerivedKeys {
  const i = num.toHex(index);
  return {
    id: hash.computePoseidonHashOnElements([POSITION_TAG, seed, i]),
    ownerSecret: hash.computePoseidonHashOnElements([SECRET_TAG, POSITION_TAG, seed, i]),
    salt: hash.computePoseidonHashOnElements([SALT_TAG, POSITION_TAG, seed, i]),
  };
}

/** Deterministic keys for the nth spot order of this wallet. */
export function deriveOrder(seed: string, index: number): DerivedKeys {
  const i = num.toHex(index);
  return {
    id: hash.computePoseidonHashOnElements([ORDER_TAG, seed, i]),
    ownerSecret: hash.computePoseidonHashOnElements([SECRET_TAG, ORDER_TAG, seed, i]),
    salt: hash.computePoseidonHashOnElements([SALT_TAG, ORDER_TAG, seed, i]),
  };
}

/**
 * Session-scoped seed cache, keyed by address so switching wallets cannot reuse a seed.
 * A module-level Map, not storage: it dies with the page.
 */
const seeds = new Map<string, string>();

export function cachedSeed(address: string): string | undefined {
  return seeds.get(BigInt(address).toString());
}

export function cacheSeed(address: string, seed: string) {
  seeds.set(BigInt(address).toString(), seed);
}

export function forgetSeeds() {
  seeds.clear();
}

/**
 * Returns the wallet's seed, asking for the signature only if it is not already cached.
 *
 * Signing is deterministic ECDSA in every Starknet wallet built on the standard curve
 * implementation, so the same wallet and message reproduce the same seed. If a wallet ever
 * signed non-deterministically, the derived ids would simply not match anything on-chain -
 * a visible failure to recover, never a silent loss of funds.
 */
export async function unlockSeed(account: any): Promise<string> {
  const address = account?.address;
  if (!address) throw new Error("Connect a wallet first.");
  const existing = cachedSeed(address);
  if (existing) return existing;
  const signature = await account.signMessage(keyMessage());
  const seed = seedFromSignature(signature);
  cacheSeed(address, seed);
  return seed;
}
