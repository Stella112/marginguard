"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, Loader2, Check, ShieldCheck } from "lucide-react";
import { fmtUsd, fmtPrice } from "./data";

type Side = "long" | "short";
type OrderType = "Market" | "Limit" | "Stop";
type Phase = "idle" | "proving" | "done";

const TIERS = [2, 5, 10] as const;
const FREE_COLLATERAL = 18420.55;

const PROOF_STEPS = [
  "Building shielded note inputs",
  "Generating STARK proof (Stwo)",
  "Submitting to STRK20 pool",
];

export function OrderEntry({ mark }: { mark: number }) {
  const [side, setSide] = useState<Side>("long");
  const [type, setType] = useState<OrderType>("Limit");
  const [size, setSize] = useState("50000");
  const [price, setPrice] = useState("");
  const [lev, setLev] = useState<(typeof TIERS)[number]>(5);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (mark && !price) setPrice(mark.toFixed(5));
  }, [mark, price]);

  // Mocked ZK-proof generation, then confirm.
  useEffect(() => {
    if (phase !== "proving") return;
    if (step < PROOF_STEPS.length - 1) {
      const t = setTimeout(() => setStep((s) => s + 1), 850);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPhase("done"), 900);
    return () => clearTimeout(t);
  }, [phase, step]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => {
      setPhase("idle");
      setStep(0);
    }, 2200);
    return () => clearTimeout(t);
  }, [phase]);

  const sizeN = Number(size) || 0;
  const priceN = Number(price) || mark;
  const notional = sizeN * priceN;
  const margin = lev ? notional / lev : 0;
  const accent = side === "long" ? "#00e5ff" : "#9d4edd";

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto bg-[#121319]">
      {/* Long / Short */}
      <div className="grid shrink-0 grid-cols-2">
        {(["long", "short"] as Side[]).map((sd) => {
          const on = side === sd;
          const c = sd === "long" ? "#00e5ff" : "#9d4edd";
          return (
            <button
              key={sd}
              onClick={() => setSide(sd)}
              className="relative h-11 text-[13px] font-bold uppercase tracking-wide transition-colors"
              style={{ color: on ? c : "rgba(255,255,255,0.35)", background: on ? `${c}14` : "transparent" }}
            >
              {sd}
              {on && <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: c }} />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-white/10 p-3">
        {/* Order type */}
        <div className="flex items-center gap-1 rounded-md bg-[#18191e] p-0.5">
          {(["Market", "Limit", "Stop"] as OrderType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 rounded px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
                type === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Size */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10.5px] uppercase tracking-[0.06em] text-white/35">
            <span>Size</span>
            <span className="tnum">≈ {fmtUsd(notional)}</span>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-[#18191e] px-2.5 focus-within:border-white/25">
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="tnum h-9 w-full bg-transparent text-[13.5px] text-white outline-none"
            />
            <span className="text-[11px] text-white/35">STRK</span>
            <button
              onClick={() => setSize(String(Math.floor((FREE_COLLATERAL * lev) / (priceN || 1))))}
              className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-bold text-white/60 transition-colors hover:bg-white/15 hover:text-white"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Price */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10.5px] uppercase tracking-[0.06em] text-white/35">
            <span>{type === "Stop" ? "Trigger price" : "Price"}</span>
            {type === "Market" && <span className="text-white/25">market</span>}
          </div>
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-[#18191e] px-2.5 focus-within:border-white/25">
            <input
              value={type === "Market" ? "" : price}
              placeholder={type === "Market" ? fmtPrice(mark) : ""}
              disabled={type === "Market"}
              onChange={(e) => setPrice(e.target.value)}
              className="tnum h-9 w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-white/25 disabled:cursor-not-allowed"
            />
            <span className="text-[11px] text-white/35">USDC</span>
          </div>
        </div>

        {/* Leverage tiers — locked to exactly 2x / 5x / 10x */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10.5px] uppercase tracking-[0.06em] text-white/35">
            <span>Leverage Tier</span>
            <span className="tnum font-bold" style={{ color: accent }}>{lev}x</span>
          </div>
          <div className="relative px-1">
            <div className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded bg-white/10" />
            <div
              className="absolute left-1 top-1/2 h-0.5 -translate-y-1/2 rounded transition-all"
              style={{
                background: accent,
                width: `${(TIERS.indexOf(lev) / (TIERS.length - 1)) * 100}%`,
              }}
            />
            <div className="relative flex justify-between">
              {TIERS.map((t) => {
                const on = lev === t;
                const passed = TIERS.indexOf(t) <= TIERS.indexOf(lev);
                return (
                  <button key={t} onClick={() => setLev(t)} className="flex flex-col items-center gap-1.5 py-1">
                    <span
                      className="size-3 rounded-full border-2 transition-all"
                      style={{
                        borderColor: passed ? accent : "rgba(255,255,255,0.2)",
                        background: on ? accent : "#121319",
                      }}
                    />
                    <span
                      className="tnum text-[10.5px] font-semibold"
                      style={{ color: on ? accent : "rgba(255,255,255,0.35)" }}
                    >
                      {t}x
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Shielded collateral */}
        <div className="rounded-md border border-white/10 bg-[#18191e] p-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-white/45">
              <Lock className="size-3 text-[#9d4edd]" />
              Shielded Free Collateral
            </span>
            <span className="tnum text-[12.5px] font-bold text-white">{fmtUsd(FREE_COLLATERAL)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-white/[0.07] pt-2 text-[11px]">
            <span className="text-white/35">Initial margin</span>
            <span className="tnum text-white/70">{fmtUsd(margin)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="text-white/35">Est. liq. price</span>
            <span className="tnum text-white/70">
              {fmtPrice(side === "long" ? priceN * (1 - 0.5 / lev) : priceN * (1 + 0.5 / lev))}
            </span>
          </div>
        </div>

        {/* Submit */}
        <button
          disabled={phase !== "idle"}
          onClick={() => {
            setStep(0);
            setPhase("proving");
          }}
          className="relative h-12 w-full overflow-hidden rounded-md text-[13.5px] font-bold uppercase tracking-wide text-[#06121a] transition-opacity disabled:cursor-wait"
          style={{ background: accent }}
        >
          <AnimatePresence mode="wait">
            {phase === "idle" && (
              <motion.span
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2"
              >
                <ShieldCheck className="size-4" />
                Place Shielded Order
              </motion.span>
            )}
            {phase === "proving" && (
              <motion.span
                key="proving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2"
              >
                <Loader2 className="size-4 animate-spin" />
                Generating proof…
              </motion.span>
            )}
            {phase === "done" && (
              <motion.span
                key="done"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2"
              >
                <Check className="size-4" />
                Order Shielded
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Proof progress */}
        <AnimatePresence>
          {phase !== "idle" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden rounded-md border border-white/10 bg-[#18191e]"
            >
              <div className="flex flex-col gap-1.5 p-2.5">
                {PROOF_STEPS.map((s, i) => {
                  const active = phase === "proving" && i === step;
                  const complete = phase === "done" || i < step;
                  return (
                    <div key={s} className="flex items-center gap-2 text-[11px]">
                      {complete ? (
                        <Check className="size-3 text-[#00e5ff]" />
                      ) : active ? (
                        <Loader2 className="size-3 animate-spin text-white/60" />
                      ) : (
                        <span className="size-3 rounded-full border border-white/15" />
                      )}
                      <span className={complete || active ? "text-white/75" : "text-white/30"}>{s}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-[10px] leading-relaxed text-white/25">
          Size and price never reach public state — only a Poseidon commitment does. Settlement
          lands in a shielded STRK20 note.
        </p>
      </div>
    </div>
  );
}

export default OrderEntry;
