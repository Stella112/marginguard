// Display-only market metadata for the MarginGuard spot venue.

export const MARKETS = [
  { symbol: "STRK/USDC", base: "STRK", maxLev: 1 },
  { symbol: "ETH/USDC", base: "ETH", maxLev: 1 },
  { symbol: "BTC/USDC", base: "BTC", maxLev: 1 },
] as const;

export type Market = (typeof MARKETS)[number];

export type Candle = { o: number; h: number; l: number; c: number; t: number };

export const fmtUsd = (n: number, dp = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const fmtPrice = (p: number) => {
  if (!p) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
};
