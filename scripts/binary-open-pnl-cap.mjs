// Read-only (indexer GraphQL only). Run: node findings/scripts/binary-open-pnl-cap.mjs <account> [indexerUrl]
// Re-runs the exact inputs client.getOpenPositionsWithPnL fetches (sdk 0.32.1 createClient.ts:663-714):
// getPortfolio(ordersLimit 0, tradesLimit 0) -> getUserFills/getRouterActions({markets, limit: 1000})
// -> computeOpenPositionsPnL; then the same fold with the account's FULL history in those markets.
import * as P from "../../sdk-latest/package/dist/binary/portfolio.js";
import * as F from "../../sdk-latest/package/dist/fills.js";
import * as R from "../../sdk-latest/package/dist/router.js";
const acct = process.argv[2], url = process.argv[3] ?? "https://dev.smk.somnia.host/v1/graphql";
const src = { url, chainId: 50312 };
const { positions } = await P.getPortfolio(acct, { ordersLimit: 0, tradesLimit: 0 }, src);
const markets = [...new Set(positions.map((p) => p.market.id))];
const capped = { fills: await F.getUserFills(acct, { markets, limit: 1000 }, src), acts: await R.getRouterActions(acct, { markets, limit: 1000 }, src) };
const full = { fills: [], acts: [] };
for (let off = 0; ; off += 1000) { const r = await F.getUserFills(acct, { markets, limit: 1000, offset: off }, src); full.fills.push(...r); if (r.length < 1000) break; }
for (let off = 0; ; off += 1000) { const r = await R.getRouterActions(acct, { markets, limit: 1000, offset: off }, src); full.acts.push(...r); if (r.length < 1000) break; }
const a = P.computeOpenPositionsPnL(acct, positions, capped.fills, capped.acts, {});
const b = P.computeOpenPositionsPnL(acct, positions, full.fills, full.acts, {});
const key = (r) => r.market.id.toLowerCase(); const bm = new Map(b.map((r) => [key(r), r]));
let differ = 0, sumCost = 0n, sumReal = 0n; const ex = [];
for (const r of a) { const t = bm.get(key(r)); if (!t) continue;
  if (r.costBasis !== t.costBasis || r.realizedPnl !== t.realizedPnl) { differ++; sumCost += r.costBasis - t.costBasis; sumReal += r.realizedPnl - t.realizedPnl;
    if (ex.length < 4) ex.push({ market: r.market.id, decimals: r.market.quoteDecimals, sdk: { costBasis: r.costBasis, realizedPnl: r.realizedPnl, unrealizedPnl: r.unrealizedPnl }, fullHistory: { costBasis: t.costBasis, realizedPnl: t.realizedPnl, unrealizedPnl: t.unrealizedPnl } }); } }
console.log(JSON.stringify({ account: acct, indexer: url, openPositionRows: positions.length, openMarkets: markets.length,
  fillsSdkSaw: capped.fills.length, fillsInHistory: full.fills.length, routerActionsSdkSaw: capped.acts.length, routerActionsInHistory: full.acts.length,
  marketsReturned: a.length, marketsWithWrongCostOrRealized: differ, sumCostBasisError: sumCost, sumRealizedError: sumReal, examples: ex },
  (k, v) => typeof v === "bigint" ? v.toString() : v, 1));
