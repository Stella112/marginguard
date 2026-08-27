// MarginGuard frontend constants, commitment helpers, and on-chain reads.
//
// The commitment helpers mirror contracts/src/commitments.cairo exactly — same domain tags,
// same Poseidon layout. Parity is asserted by the Cairo test that cross-checks these values
// against scripts/gen_signature_vector.mjs, so what the UI shows is what the contract stores.

import { RpcProvider, hash, shortString, num, ec } from "starknet";

// ─── Sepolia deployment (live, verified on-chain 2026-08-27) ────────────────
export const SEPOLIA_RPC = "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_8";

// Full-system deployment (spot + perps + agent + oracle), verified on-chain 2026-08-27.
export const MG = {
  agentRegistry: "0x064a7c3a09c040fa119990ce0a849e0451e134155389b4debd9fd535319aa487",
  oracle: "0x07cb6c35ab8313f2ce9bbe3427504f72fa57288f1180c68af1416567f2673a14",
  perpEngine: "0x00579523cbadd6a1228f66ba0265fa86dacf8d2239c0c685ad236860da78a3c5",
  orderBook: "0x071960e31d69f11e7a9342124d60b019bce57b8f848174c2a079b509c40aec61",
  venue: "0x04c5575b5342aca8a6bce5199e3bfeb70ace94670985dfc21b0120224a0b056e",
  pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
} as const;

export const VOYAGER = "https://sepolia.voyager.online/contract/";

// ─── Commitment scheme (must match commitments.cairo) ───────────────────────
const ORDER_TAG = shortString.encodeShortString("MG_ORDER_COMMIT:V1");
const TRADER_TAG = shortString.encodeShortString("MG_TRADER_COMMIT:V1");
const POSITION_TAG = shortString.encodeShortString("MG_POSITION_COMMIT:V1");
const PROPOSAL_TAG = shortString.encodeShortString("MG_PROPOSAL:V1");

export const SIDE_BUY = 0;
export const SIDE_SELL = 1;

const felt = (v: string | number | bigint) => num.toHex(v);

/** poseidon(ORDER_TAG, side, price, size, salt) */
export function orderCommitment(side: number, price: bigint, size: bigint, salt: string): string {
  return hash.computePoseidonHashOnElements([ORDER_TAG, felt(side), felt(price), felt(size), salt]);
}

/** poseidon(TRADER_TAG, owner_secret) */
export function traderCommitment(ownerSecret: string): string {
  return hash.computePoseidonHashOnElements([TRADER_TAG, ownerSecret]);
}

/** poseidon(POSITION_TAG, side, size, entry, margin, leverage, salt) */
export function positionCommitment(
  side: number,
  size: bigint,
  entry: bigint,
  margin: bigint,
  leverage: number,
  salt: string,
): string {
  return hash.computePoseidonHashOnElements([
    POSITION_TAG,
    felt(side),
    felt(size),
    felt(entry),
    felt(margin),
    felt(leverage),
    salt,
  ]);
}

/// Domain tag for the owner→agent viewing grant mask (app-level, on STRK20's ECDH scheme).
const GRANT_TAG = shortString.encodeShortString("MG_VIEW_GRANT:V1");
const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

/** Browser-safe bytes → 0x-hex (no Buffer dependency). */
function bytesToHex(b: Uint8Array): string {
  let h = "0x";
  for (const x of b) h += x.toString(16).padStart(2, "0");
  return h;
}

/**
 * Full owner→agent grant round-trip, for the Privacy Center demo. The owner encrypts a viewing
 * `capability` to the agent's key; the agent recovers it from its private key and the ephemeral
 * point. Proves the mechanism end to end — real STARK-curve ECDH, real Poseidon masking.
 */
export function grantRoundTrip(
  capability: string,
  agentPriv: string,
): {
  agentPub: string;
  ephemeralOnChain: string;
  ciphertext: string;
  sharedX: string;
  recovered: string;
  ok: boolean;
} {
  const compressed = ec.starkCurve.getPublicKey(agentPriv); // bytes
  const agentPub = bytesToHex(compressed);
  // Owner side. getSharedSecret takes the pubkey as raw bytes.
  const r = randomFelt();
  const rG = ec.starkCurve.getPublicKey(r); // bytes
  const sOwner = ec.starkCurve.getSharedSecret(r, compressed);
  const sharedX = num.toHex(BigInt(bytesToHex(sOwner.slice(1, 33))) % STARK_PRIME);
  const mask = hash.computePoseidonHashOnElements([GRANT_TAG, sharedX]);
  const ciphertext = num.toHex((BigInt(capability) + BigInt(mask)) % STARK_PRIME);
  const ephemeralOnChain = num.toHex(BigInt(bytesToHex(rG.slice(1, 33))) % STARK_PRIME);
  // Agent side: recover the shared secret from its private key and the full ephemeral point.
  const sAgent = ec.starkCurve.getSharedSecret(agentPriv, rG);
  const sharedX2 = num.toHex(BigInt(bytesToHex(sAgent.slice(1, 33))) % STARK_PRIME);
  const mask2 = hash.computePoseidonHashOnElements([GRANT_TAG, sharedX2]);
  const recovered = num.toHex((BigInt(ciphertext) - BigInt(mask2) + STARK_PRIME) % STARK_PRIME);
  return {
    agentPub,
    ephemeralOnChain,
    ciphertext,
    sharedX,
    recovered,
    ok: BigInt(recovered) === BigInt(capability),
  };
}

/** poseidon(PROPOSAL_TAG, position_id, kind, value, nonce) */
export function proposalDigest(positionId: string, kind: number, value: bigint, nonce: bigint): string {
  return hash.computePoseidonHashOnElements([
    PROPOSAL_TAG,
    positionId,
    felt(kind),
    felt(value),
    felt(nonce),
  ]);
}

/** A cryptographically-random felt salt/secret. Never a timestamp. */
export function randomFelt(): string {
  const bytes = new Uint8Array(31); // < field size
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return num.toHex(BigInt(hex));
}

export function short(hex: string): string {
  if (!hex) return "…";
  let h: string;
  try {
    h = num.toHex(hex);
  } catch {
    return "…";
  }
  return h.length <= 13 ? h : `${h.slice(0, 8)}…${h.slice(-4)}`;
}

// ─── On-chain reads (no wallet needed) ──────────────────────────────────────
let _provider: RpcProvider | null = null;
export function readProvider(): RpcProvider {
  if (!_provider) _provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  return _provider;
}

async function call(contract: string, entrypoint: string, calldata: string[] = []): Promise<string[]> {
  const res = await readProvider().callContract({
    contractAddress: contract,
    entrypoint,
    calldata,
  });
  return res as unknown as string[];
}

export type VenueStatus = {
  pool: string;
  orderBook: string;
  bookVenue: string;
  wired: boolean;
};

/** Reads the live wiring: the venue's pinned pool, and that the book points back at the venue. */
export async function readVenueStatus(): Promise<VenueStatus> {
  const [pool] = await call(MG.venue, "privacy_pool");
  const [orderBook] = await call(MG.venue, "order_book");
  const [bookVenue] = await call(MG.orderBook, "venue");
  return {
    pool,
    orderBook,
    bookVenue,
    wired: BigInt(bookVenue) === BigInt(MG.venue) && BigInt(pool) === BigInt(MG.pool),
  };
}

export type AgentInfo = {
  registered: boolean;
  publicKey: string;
  nonce: string;
  policy: {
    maxMarginIncreaseBps: number;
    maxSizeReductionBps: number;
    maxLeverage: number;
    mayClose: boolean;
  } | null;
};

/** Looks up an agent in the live registry. */
export async function readAgent(address: string): Promise<AgentInfo> {
  const [isReg] = await call(MG.agentRegistry, "is_registered_agent", [address]);
  const registered = BigInt(isReg) === 1n;
  const [publicKey] = await call(MG.agentRegistry, "agent_public_key", [address]);
  const [nonce] = await call(MG.agentRegistry, "agent_nonce", [address]);
  // agent_policy returns AgentPolicy: (u16, u16, u8, bool)
  let policy: AgentInfo["policy"] = null;
  try {
    const p = await call(MG.agentRegistry, "agent_policy", [address]);
    policy = {
      maxMarginIncreaseBps: Number(BigInt(p[0])),
      maxSizeReductionBps: Number(BigInt(p[1])),
      maxLeverage: Number(BigInt(p[2])),
      mayClose: BigInt(p[3]) === 1n,
    };
  } catch {
    policy = null;
  }
  return { registered, publicKey, nonce, policy };
}

export type ViewGrant = {
  agent: string;
  ephemeral: string;
  ciphertext: string;
  active: boolean;
};

/** Reads a position's on-chain viewing grant from the perp engine. */
export async function readViewGrant(positionId: string): Promise<ViewGrant> {
  // get_view_grant returns ViewGrant { agent, ephemeral, ciphertext, active }
  const r = await call(MG.perpEngine, "get_view_grant", [positionId]);
  return {
    agent: r[0],
    ephemeral: r[1],
    ciphertext: r[2],
    active: BigInt(r[3]) === 1n,
  };
}

/** The agent's registered viewing public key (x-coordinate reference), or 0 if none. */
export async function readAgentViewingKey(agent: string): Promise<string> {
  const [vk] = await call(MG.agentRegistry, "agent_viewing_key", [agent]);
  return vk;
}

/** Live mark price from the deployed oracle (scaled 1e18 → number). */
export async function readMarkPrice(): Promise<number> {
  // get_price(base, quote); ManualOracle ignores the args and returns the set price.
  const r = await call(MG.oracle, "get_price", [MG.pool, MG.pool]);
  return Number(BigInt(r[0])) / 1e18;
}

export type PositionView = {
  exists: boolean;
  open: boolean;
  liquidated: boolean;
  baseToken: string;
  quoteToken: string;
  commitment: string;
};

/** Reads a perp position's public state by id. */
export async function readPosition(positionId: string): Promise<PositionView> {
  // get_position returns PositionEntry { trader_commitment, commitment, base, quote, open, liquidated }
  const r = await call(MG.perpEngine, "get_position", [positionId]);
  const commitment = r[1];
  return {
    exists: BigInt(commitment) !== 0n,
    open: BigInt(r[4]) === 1n,
    liquidated: BigInt(r[5]) === 1n,
    baseToken: r[2],
    quoteToken: r[3],
    commitment,
  };
}
