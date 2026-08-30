/**
 * A position's private economics, held in this browser so it can be revealed at close.
 *
 * The chain stores only the Poseidon commitment, so these values are the sole way to
 * satisfy `close_position` / `liquidate`. Session storage keeps them out of the URL and
 * clears them when the tab closes.
 */
export type PerpPacket = {
  positionId: string;
  ownerSecret: string;
  salt: string;
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

export function readPackets(): PerpPacket[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as PerpPacket[] : [];
  } catch {
    return [];
  }
}

export function writePackets(next: PerpPacket[]) {
  sessionStorage.setItem(KEY, JSON.stringify(next));
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
