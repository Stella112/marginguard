// MarginGuard frontend constants, commitment helpers, and on-chain reads.
//
// The commitment helpers mirror contracts/src/commitments.cairo exactly — same domain tags,
// same Poseidon layout. Parity is asserted by the Cairo test that cross-checks these values
// against scripts/gen_signature_vector.mjs, so what the UI shows is what the contract stores.

import { RpcProvider, hash, shortString, num, ec } from "starknet";

// ─── MAINNET deployment (full system, verified on-chain 2026-08-28) ─────────
export const SEPOLIA_RPC = "https://rpc.starknet.lava.build"; // mainnet (name kept for callers)

// Oracle swapped Ekubo (thin, ~3x off) -> Pragma (accurate); perp + registry redeployed.
export const MG = {
  agentRegistry: "0x05b99dcb0d9995a112c1e12ea1695247a43811f586513027bb6d1057bc673e55",
  oracle: "0x038d443ba8d1bc4dc914ff2aadf9acbd3c0785c376b66986c7e7520090f5c1af",
  perpEngine: "0x00aaa439cf40d1d535e7d58245443461fbff2ce7ed272b441cc09683a741354c",
  orderBook: "0x03cc0b36be4110edad405125c38b139907d6da371ab7661161265f29408b514c",
  venue: "0x01add9644c5c302745548a67fa65b173f71ecbe9a1ab1c3fcd12dd34515042f0",
  pool: "0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
} as const;

// Real STRK/USDC for the mainnet oracle read on the terminal.
export const MARK_BASE = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"; // STRK
export const MARK_QUOTE = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"; // USDC

export const VOYAGER = "https://voyager.online/contract/";

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

/** Live STRK/USDC mark price from the deployed EkuboTwapOracle, in human USDC per STRK. */
export async function readMarkPrice(): Promise<number> {
  const r = await call(MG.oracle, "get_price", [MARK_BASE, MARK_QUOTE]);
  // Oracle returns quote-smallest per base-smallest × 1e18. STRK 18dp, USDC 6dp:
  // human = value / 1e18 × 10^(18-6) = value / 1e6.
  return Number(BigInt(r[0])) / 1e6;
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
