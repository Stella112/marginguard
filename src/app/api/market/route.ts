import { NextResponse } from "next/server";

const ASSETS: Record<string, string> = {
  STRK: "starknet",
  ETH: "ethereum",
  BTC: "bitcoin",
  SOL: "solana",
};

export async function GET(request: Request) {
  const asset = new URL(request.url).searchParams.get("asset")?.toUpperCase() ?? "STRK";
  const id = ASSETS[asset];
  if (!id) return NextResponse.json({ error: "Unsupported market" }, { status: 400 });

  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1&interval=hourly`, {
      next: { revalidate: 60 },
      headers: { accept: "application/json" },
    });
    if (!response.ok) return NextResponse.json({ error: "Market feed unavailable" }, { status: 502 });
    const payload = await response.json() as { prices?: [number, number][] };
    const prices = payload.prices ?? [];
    const first = prices[0]?.[1];
    const current = prices[prices.length - 1]?.[1];
    const change24h = first && current ? ((current - first) / first) * 100 : null;
    return NextResponse.json({ asset, prices, current: current ?? null, change24h, source: "CoinGecko public market feed" });
  } catch {
    return NextResponse.json({ error: "Market feed unavailable" }, { status: 502 });
  }
}
