// MarginGuard frontend constants, commitment helpers, and on-chain reads.
//
// The commitment helpers mirror contracts/src/commitments.cairo exactly — same domain tags,
// same Poseidon layout. Parity is asserted by the Cairo test that cross-checks these values
// against scripts/gen_signature_vector.mjs, so what the UI shows is what the contract stores.

import { RpcProvider, hash, shortString, num } from "starknet";

// ─── Sepolia deployment (live, verified on-chain 2026-08-27) ────────────────
export const SEPOLIA_RPC = "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_8";

export const MG = {
  agentRegistry: "0x03ed6b59a2eb92151f4bb1c86764b877851e193c0219b36ebbf4a4b2bfd5bdb8",
  orderBook: "0x03a7be95529ca4c28271bd4b017d582a14f799dec47696495ce6e10b698e8bb0",
  venue: "0x05c10c42f661b328c6f75a1acba641029b9080938c50922de1c79beacb2f8a4f",
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
