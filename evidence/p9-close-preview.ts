// Read-only. For every position of OWNER_ADDRESS: position size (fetchPositions)
// vs previewPerpClosePnl().closedQuantity — the number closePosition() (perp-guard
// flatten/reduce, perp-funding exit) actually sends — and the account's resting
// orders on that pool.
import { createExchange, perpMarkets, shutdown } from "../dreamdex-bot-kit/packages/perp-core/src/index.ts";

const ctx = createExchange();
const acct = ctx.config.owner!;
const markets = await perpMarkets(ctx.exchange, true, { includeHalted: true });
const positions = await ctx.exchange.fetchPositions();
console.log(`${new Date().toISOString()} account=${acct} positions=${positions.length}`);
for (const p of positions) {
  const m = markets.find((x) => x.symbol === p.symbol)!;
  const prev = await ctx.exchange.client.previewPerpClosePnl({ pool: m.info.poolAddress, marginBank: m.info.marginBank, account: acct });
  const closed = prev.priceable ? Number(prev.closedQuantity) / 10 ** m.info.baseDecimals : NaN;
  let open = "";
  try {
    const oo: any[] = await (ctx.exchange.client as any).getOpenOrdersOnchain([m.info.poolAddress], acct);
    open = oo.map((o) => `${o.isBid ? "bid" : "ask"} ${Number(o.quantityRemaining ?? o.quantity ?? 0n) / 10 ** m.info.baseDecimals}`).join(",");
  } catch (e: any) { open = `(open orders unreadable: ${String(e?.message).slice(0, 60)})`; }
  const flag = prev.priceable && Math.abs(closed - p.contracts) > 1e-12 ? "  <-- MISMATCH" : "";
  console.log(`${m.display.padEnd(14)} ${p.side} ${p.contracts} | preview.closedQuantity=${closed} placeable=${(prev as any).placeable} | resting=[${open}]${flag}`);
}
await shutdown(ctx, 300);
process.exit(0);
