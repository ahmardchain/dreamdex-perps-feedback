// Offline repro (no network, no keys, no tx): in the default backtest mode a GTC (Normal) limit order
// placed during bar t is filled against bar t's own high/low, i.e. against prices that printed BEFORE
// the bot's decision (the bot only sees bar t's close). Runs the kit's real `backtest()` runner.
// node backtest-same-bar-fill.mjs <bot-kit>/packages/backtest/dist/index.js
import { pathToFileURL } from 'node:url';
globalThis.fetch = async () => { throw new Error('offline repro: network disabled'); };
const { backtest } = await import(pathToFileURL(process.argv[2]).href);

const NORMAL = 0, POST_ONLY = 3; // ORDER_TYPE in packages/core/src/gotchas.ts
const MIN = 60_000, T0 = Date.UTC(2026, 10, 1);
const bar = (i, o, h, l, c) => ({ timestamp: T0 + i * MIN, open: String(o), high: String(h), low: String(l), close: String(c), volume: '1000' });
// Bar 0 wicks down to 90 and closes at 100. Every later bar trades only at 100.
const candles = [bar(0, 100, 100, 90, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 100, 100, 100), bar(3, 100, 100, 100, 100)];

// On its first bar the bot sees the book (mid = close = 100) and bids 1 unit at 91, 9% under it.
const bidOnce = (orders) => async (pool) => {
  let done = false;
  return { async onBar() {
    if (done) return; done = true;
    const book = await pool.topOfBook();
    for (const o of orders) await pool.place({ isBid: true, price: o.price ?? 91, qty: o.qty ?? 1, orderType: o.type });
    console.log(`    bot saw bestBid ${book.bestBid} / bestAsk ${book.bestAsk} on bar 0, placed ${orders.map((o) => `${o.type === NORMAL ? 'GTC' : 'PostOnly'} bid @ ${o.price ?? 91}`).join(' + ')}`);
  } };
};

const cases = [
  ['GTC bid @ 91, default mode', [{ type: NORMAL }], {}],
  ['PostOnly bid @ 91 (control)', [{ type: POST_ONLY }], {}],
  ['GTC bid @ 91, --queue-position (control)', [{ type: NORMAL }], { queuePosition: true }],
  ['PostOnly bid @ 91, then a GTC bid @ 50', [{ type: POST_ONLY }, { type: NORMAL, price: 50, qty: 0.01 }], {}],
];
for (const [name, orders, extra] of cases) {
  console.log(`\n${name}`);
  const r = await backtest({ label: 'repro', createBot: bidOnce(orders), symbol: 'WETH:USDso', interval: '1m',
    since: T0, until: T0 + 4 * MIN, candles, quiet: true, includeDetails: true, quoteUsdso: 1000, markoutBars: 0, ...extra });
  const fills = r.fills.map((f) => `${f.role} ${f.isBid ? 'buy' : 'sell'} ${f.qty} @ ${f.price} in bar ${(f.timestamp - T0) / MIN}`);
  console.log(`    fills: ${fills.length ? fills.join('; ') : 'none'}`);
  console.log(`    totalPnl ${r.metrics.totalPnl.toFixed(4)} on a market that opened and closed at 100`);
}
