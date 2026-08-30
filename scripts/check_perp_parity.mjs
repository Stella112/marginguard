/**
 * Parity check: the UI's PnL must agree with PerpEngine.
 *
 * The engine exposes no view for equity or PnL, so the terminal recomputes it in the
 * browser. That is only trustworthy if it reproduces what the contract actually settles,
 * so this runs the UI's own `riskOf` - imported, not copied - against the vectors
 * asserted in contracts/src/tests/test_perp.cairo.
 *
 * Run with:  npm run check:perp
 */
import { riskOf } from "../src/components/dex/perpPackets.ts";

const SCALE = 10n ** 18n;
// const SIZE = 100; const ENTRY = 1500 * SCALE; const MARGIN = 50000; const LEV = 2;
const base = { size: "100", entryPrice: (1500n * SCALE).toString(), margin: "50000" };

const cases = [
  {
    test: "closing_in_profit_settles_margin_plus_gain",
    packet: { ...base, side: 0 },
    mark: 1600n * SCALE,
    equity: 60000n,
    liquidatable: false,
  },
  {
    test: "closing_in_loss_settles_margin_minus_loss",
    packet: { ...base, side: 0 },
    mark: 1300n * SCALE,
    equity: 30000n,
    liquidatable: false,
  },
  {
    test: "a_short_profits_when_the_market_falls",
    packet: { ...base, side: 1 },
    mark: 1400n * SCALE,
    equity: 60000n,
    liquidatable: false,
  },
  {
    test: "liquidation_closes_the_position_and_settles_residual",
    packet: { ...base, side: 0 },
    mark: 1200n * SCALE,
    equity: 20000n,
    liquidatable: true,
  },
];

let failed = 0;
for (const { test, packet, mark, equity, liquidatable } of cases) {
  const actual = riskOf(packet, mark);
  const ok = actual.equity === equity && actual.liquidatable === liquidatable;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${test}\n` +
    `      equity ${actual.equity} (contract asserts ${equity}), ` +
    `liquidatable ${actual.liquidatable} (expected ${liquidatable})`,
  );
}

console.log(`\n${cases.length - failed}/${cases.length} match the contract's asserted settlements`);
if (failed) {
  console.error("\nThe terminal would show a PnL the contract does not settle.");
  process.exit(1);
}
