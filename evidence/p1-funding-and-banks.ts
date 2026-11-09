// Read-only: per market, compare the market-row funding (what perp-doctor and
// fundingSide() use) with the pool's live funding (what perp-funding trades on),
// and list the distinct MarginBank / quote decimals.
import { createExchange, perpMarkets, fundingApr, liveFunding, liveMark, markOf, shutdown } from "../dreamdex-bot-kit/packages/perp-core/src/index.ts";

const ctx = createExchange();
const markets = await perpMarkets(ctx.exchange, true, { includeHalted: true });
const banks = new Set<string>();
console.log(`${new Date().toISOString()} markets=${markets.length}`);
for (const m of markets) {
  banks.add(m.info.marginBank.toLowerCase());
  const row = fundingApr(m.info);
  const live = await liveFunding(ctx.exchange, m);
  const lm = await liveMark(ctx.exchange, m);
  console.log(
    `${m.display.padEnd(14)} row=${(row.apr * 100).toFixed(3)}%/${row.paidSide} win=${row.windowSec}s int=${row.intervalSec}s | ` +
      `pool=${(live.apr * 100).toFixed(3)}%/${live.paidSide} win=${live.windowSec}s int=${live.intervalSec}s known=${live.known} | ` +
      `rowMark=${markOf(m.info)} liveMark=${lm} baseDec=${m.info.baseDecimals} quoteDec=${m.info.quoteDecimals} active=${m.market.active}`,
  );
}
console.log("distinct marginBanks:", [...banks]);
await shutdown(ctx);
process.exit(0);
