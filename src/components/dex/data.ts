// Mock market data for the MarginGuard DEX views.
//
// The mark price is read live from the deployed Pragma oracle on Starknet mainnet; the book,
// candles and account rows are deterministic mocks (there is no public trade tape — resting
// orders are shielded commitments, which is the point of the venue).

export const MARKETS = [
  { symbol: "STRK-PERP", base: "STRK", maxLev: 10 },
  { symbol: "ETH-PERP", base: "ETH", maxLev: 10 },
  { symbol: "BTC-PERP", base: "BTC", maxLev: 10 },
] as const;

export type Market = (typeof MARKETS)[number];

/** Deterministic PRNG so the mock book/candles don't churn between renders. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export type Candle = { o: number; h: number; l: number; c: number; t: number };

export function buildCandles(mark: number, n = 90): Candle[] {
  const r = rng(20260828);
  const out: Candle[] = [];
  let p = mark * 0.9;
  for (let i = 0; i < n; i++) {
    const o = p;
    const drift = (mark - p) * 0.06;
    const c = o + drift + (r() - 0.47) * mark * 0.02;
    out.push({
      o,
      c,
      h: Math.max(o, c) + r() * mark * 0.008,
      l: Math.min(o, c) - r() * mark * 0.008,
      t: i,
    });
    p = c;
  }
  if (out.length) out[out.length - 1].c = mark;
  return out;
}

export type Level = { price: number; size: number; total: number };

/** Orderbook levels around a mark. Sizes are shielded in reality — shown here as depth. */
export function buildBook(mark: number, levels = 11) {
  const r = rng(777);
  const tick = Math.max(mark * 0.0004, 1e-6);
  const asks: Level[] = [];
  const bids: Level[] = [];
  let at = 0;
  let bt = 0;
  for (let i = 0; i < levels; i++) {
    const asz = 4000 + r() * 26000;
    at += asz;
    asks.push({ price: mark + tick * (i + 1), size: asz, total: at });
    const bsz = 4000 + r() * 26000;
    bt += bsz;
    bids.push({ price: mark - tick * (i + 1), size: bsz, total: bt });
  }
  return { asks: asks.reverse(), bids, maxTotal: Math.max(at, bt) };
}

export type Position = {
  market: string;
  side: "LONG" | "SHORT";
  size: string;
  entry: string;
  mark: string;
  liq: string;
  pnl: number;
  lev: number;
};

export const POSITIONS: Position[] = [
  { market: "STRK-PERP", side: "LONG", size: "184,200", entry: "0.02318", mark: "0.02463", liq: "0.01204", pnl: 267.09, lev: 5 },
  { market: "ETH-PERP", side: "SHORT", size: "12.40", entry: "2,486.10", mark: "2,420.18", liq: "3,110.55", pnl: 817.41, lev: 2 },
];

export type OpenOrder = {
  market: string;
  type: string;
  side: "BUY" | "SELL";
  size: string;
  price: string;
  status: string;
};

export const ORDERS: OpenOrder[] = [
  { market: "STRK-PERP", type: "LIMIT", side: "BUY", size: "50,000", price: "0.02310", status: "SHIELDED" },
  { market: "STRK-PERP", type: "STOP", side: "SELL", size: "184,200", price: "0.01950", status: "SHIELDED" },
  { market: "ETH-PERP", type: "LIMIT", side: "SELL", size: "6.00", price: "2,530.00", status: "SHIELDED" },
];

export type AgentLog = {
  time: string;
  action: string;
  market: string;
  detail: string;
  verdict: "VERIFIED" | "REJECTED";
};

export const AGENT_LOGS: AgentLog[] = [
  { time: "17:42:08", action: "REDUCE_SIZE", market: "STRK-PERP", detail: "−20% size · health 1.41 → 1.68", verdict: "VERIFIED" },
  { time: "16:55:31", action: "INCREASE_MARGIN", market: "ETH-PERP", detail: "+25% margin · policy cap 50%", verdict: "VERIFIED" },
  { time: "16:12:04", action: "ADJUST_LEVERAGE", market: "STRK-PERP", detail: "10x → 5x on volatility spike", verdict: "VERIFIED" },
  { time: "15:03:47", action: "CLOSE_POSITION", market: "ETH-PERP", detail: "exceeded policy · may_close = false", verdict: "REJECTED" },
  { time: "14:20:19", action: "REDUCE_SIZE", market: "STRK-PERP", detail: "stale nonce · replay refused", verdict: "REJECTED" },
];

export const SPOT_BALANCES = [
  { asset: "USDC", balance: "24,180.55", value: 24180.55, apy: "4.20%" },
  { asset: "STRK", balance: "184,200.00", value: 4536.85, apy: "—" },
  { asset: "ETH", balance: "3.2140", value: 7778.47, apy: "1.10%" },
];

export const fmtUsd = (n: number, dp = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const fmtPrice = (p: number) => {
  if (!p) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
};
