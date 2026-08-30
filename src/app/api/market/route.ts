import { NextResponse } from "next/server";

const ASSETS: Record<string, string> = {
  STRK: "starknet",
  ETH: "ethereum",
  BTC: "bitcoin",
  SOL: "solana",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Timeframe -> how much history to request, and how wide each candle is.
 *
 * CoinGecko's free market_chart endpoint picks granularity from `days`: 1 day returns
 * roughly 5-minute points, 2-90 days returns hourly, and beyond that daily. Each bucket
 * below is therefore at or coarser than what the range actually provides, so a candle is
 * always aggregated from real points rather than interpolated. There is no 1m option for
 * the same reason: the feed's finest resolution is 5 minutes, so a 1m button could only
 * duplicate 5m.
 */
const TIMEFRAMES: Record<string, { days: number; bucket: number }> = {
  "5m": { days: 1, bucket: 5 * MINUTE },
  "15m": { days: 1, bucket: 15 * MINUTE },
  "1h": { days: 7, bucket: HOUR },
  "4h": { days: 30, bucket: 4 * HOUR },
  "1D": { days: 180, bucket: DAY },
  "1W": { days: 365, bucket: 7 * DAY },
};

type Candle = { t: number; o: number; h: number; l: number; c: number };

/** Groups raw (timestamp, price) points into OHLC candles of `bucket` milliseconds. */
function toCandles(points: [number, number][], bucket: number): Candle[] {
  const byBucket = new Map<number, Candle>();
  for (const [ts, price] of points) {
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    const start = Math.floor(ts / bucket) * bucket;
    const existing = byBucket.get(start);
    if (!existing) {
      byBucket.set(start, { t: start, o: price, h: price, l: price, c: price });
    } else {
      existing.h = Math.max(existing.h, price);
      existing.l = Math.min(existing.l, price);
      existing.c = price;
    }
  }
  return [...byBucket.values()].sort((a, b) => a.t - b.t);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const asset = params.get("asset")?.toUpperCase() ?? "STRK";
  const tf = params.get("tf") ?? "1h";
  const id = ASSETS[asset];
  if (!id) return NextResponse.json({ error: "Unsupported market" }, { status: 400 });
  const frame = TIMEFRAMES[tf];
  if (!frame) return NextResponse.json({ error: "Unsupported timeframe" }, { status: 400 });

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${frame.days}`,
      { next: { revalidate: 60 }, headers: { accept: "application/json" } },
    );
    if (!response.ok) return NextResponse.json({ error: "Market feed unavailable" }, { status: 502 });

    const payload = await response.json() as { prices?: [number, number][] };
    const points = payload.prices ?? [];
    const candles = toCandles(points, frame.bucket).slice(-90);
    const current = points.at(-1)?.[1] ?? null;

    // 24h change is measured from the feed itself, not from the visible window, so it
    // stays the same figure whichever timeframe is selected.
    const cutoff = Date.now() - DAY;
    const dayAgo = points.find(([ts]) => ts >= cutoff)?.[1] ?? points[0]?.[1];
    const change24h = dayAgo && current ? ((current - dayAgo) / dayAgo) * 100 : null;

    return NextResponse.json({
      asset,
      tf,
      candles,
      current,
      change24h,
      source: "CoinGecko public market feed",
    });
  } catch {
    return NextResponse.json({ error: "Market feed unavailable" }, { status: 502 });
  }
}
