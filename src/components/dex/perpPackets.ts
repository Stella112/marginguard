/**
 * A position's private economics, held in this browser so it can be revealed at close.
 *
 * The chain stores only the Poseidon commitment, so these values are the sole way to
 * satisfy `close_position` / `liquidate`. Session storage keeps them out of the URL and
 * clears them when the tab closes.
 */
export type PerpPacket = {
  /** Derivation index. The owner secret, salt and id all come from the wallet seed. */
  index: number;
  positionId: string;
  side: number;
  size: string;
  entryPrice: string;
  margin: string;
  leverage: number;
  openTx: string;
};

const KEY = "marginguard.perp-positions";
/** Order entry and the positions panel are siblings, so they sync through this event. */
export const PERP_EVENT = "marginguard:positions";

/**
 * Position economics, cached locally.
 *
 * No secret is stored here any more. The owner secret, salt and position id are derived
 * from a wallet signature (see utils/keyvault), so this cache holds only the committed
 * economics - the same figures that become public when the position closes. Losing it is
 * recoverable: the ids are derivable, so open positions can be found by scanning the chain.
 *
 * Stealing this file therefore gains an attacker nothing spendable.
 */
export function readPackets(): PerpPacket[] {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed as PerpPacket[] : [];
    }
    // Migrate anything still held by the previous session-scoped build.
    const legacy = sessionStorage.getItem(KEY);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) return [];
    localStorage.setItem(KEY, legacy);
    return parsed as PerpPacket[];
  } catch {
    return [];
  }
}

export function writePackets(next: PerpPacket[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store must not lose the packet silently.
    sessionStorage.setItem(KEY, JSON.stringify(next));
  }
  window.dispatchEvent(new Event(PERP_EVENT));
}

export function parseUnits(value: string, decimals: number) {
  const [whole, fraction = ""] = value.trim().split(".");
  if (!whole && !fraction) return 0n;
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatUnits(raw: bigint, decimals: number, places = 2) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, places);
  return `${whole}.${frac}`;
}

/** The engine scales every price by 1e18: quote_value = size * price / PRICE_SCALE. */
export const PRICE_SCALE = 10n ** 18n;
export const STRK_DECIMALS = 18;
export const USDC_DECIMALS = 6;

/**
 * Formats a quote-token amount as USD, widening precision below a dollar.
 *
 * A 1 STRK position is worth about $0.026, so its margin and PnL both round away
 * entirely at two decimals and read as $0.00 - which looks like the figure is not
 * being computed at all. Sub-dollar amounts therefore get five places, mirroring the
 * adaptive precision the price formatter already uses.
 */
export function formatUsd(raw: bigint, decimals = USDC_DECIMALS) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const places = abs < 10n ** BigInt(decimals) ? 5 : 2;
  return `${negative ? "-" : ""}$${formatUnits(abs, decimals, places)}`;
}

/** Mirrors PerpEngine: MAINTENANCE_BPS = 5000 against BPS_DENOMINATOR = 10000. */
export const MAINTENANCE_BPS = 5000n;
export const BPS_DENOMINATOR = 10000n;
const SIDE_LONG = 0;

/**
 * Unrealised PnL, equity and liquidation risk for an open position.
 *
 * PerpEngine exposes no view for any of this - `equity_of` and `loss_of` are internal
 * free functions - so it is recomputed from the committed values and the live oracle
 * mark, using the engine's own `quote_value(size, price) = size * price / PRICE_SCALE`.
 *
 * Kept here rather than in the panel so the parity check in `scripts/` can exercise the
 * same code the UI renders, against the contract's own test vectors.
 */
export function riskOf(packet: Pick<PerpPacket, "side" | "size" | "entryPrice" | "margin">, mark: bigint) {
  const size = BigInt(packet.size);
  const entry = BigInt(packet.entryPrice);
  const margin = BigInt(packet.margin);
  const entryValue = (size * entry) / PRICE_SCALE;
  const nowValue = (size * mark) / PRICE_SCALE;
  const delta = packet.side === SIDE_LONG ? nowValue - entryValue : entryValue - nowValue;
  const loss = delta < 0n ? -delta : 0n;
  // The engine floors equity at zero, so a loss can never exceed posted margin.
  const equity = loss >= margin ? 0n : margin + delta;
  return {
    pnl: equity - margin,
    equity,
    liquidatable: loss > 0n && equity < (margin * MAINTENANCE_BPS) / BPS_DENOMINATOR,
  };
}

/**
 * Spot reveal packets, held in localStorage.
 *
 * These carry the owner secret and salt that `match_orders` and the venue claim need.
 * Session-scoped storage loses them when the tab closes, which strands a live order
 * with no way to match or claim it - the same failure that stranded a perp position.
 */
const SPOT_KEY = "marginguard.spot-orders";

export function readSpotOrders(): any[] {
  try {
    const stored = localStorage.getItem(SPOT_KEY) ?? sessionStorage.getItem(SPOT_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    localStorage.setItem(SPOT_KEY, stored);
    return parsed;
  } catch {
    return [];
  }
}

export function writeSpotOrders(next: any[]) {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(next));
  } catch {
    sessionStorage.setItem(SPOT_KEY, JSON.stringify(next));
  }
}
