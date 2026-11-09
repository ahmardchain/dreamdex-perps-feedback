// Offline repro (no network, no keys, no tx): the backtest's `realizedPnl` metric books the whole sale
// price as profit when the run starts with base inventory (`--base`), because the ledger gives that
// inventory an average entry of 0. Runs the kit's real `backtest()` runner and `PortfolioLedger`.
// node backtest-realized-pnl.mjs <bot-kit>/packages/backtest/dist/index.js
import { pathToFileURL } from 'node:url';
globalThis.fetch = async () => { throw new Error('offline repro: network disabled'); };
const { backtest, PortfolioLedger } = await import(pathToFileURL(process.argv[2]).href);

const IOC = 2; // ORDER_TYPE.ImmediateOrCancel in packages/core/src/gotchas.ts
const MIN = 60_000, T0 = Date.UTC(2026, 10, 1);
const bar = (i, c) => ({ timestamp: T0 + i * MIN, open: String(c), high: String(c), low: String(c), close: String(c), volume: '1000' });
const candles = [bar(0, 100), bar(1, 100), bar(2, 100)]; // flat market at 100

// 1. `--base 1 --quote-usdso 0`: the bot sells its 1 unit into the bid on the first bar.
const sellAll = async (pool) => {
  let done = false;
  return { async onBar() {
    if (done) return; done = true;
    const book = await pool.topOfBook();
    await pool.place({ isBid: false, price: book.bestBid, qty: await pool.walletBase(), orderType: IOC });
  } };
};
const r = await backtest({ label: 'repro', createBot: sellAll, symbol: 'WETH:USDso', interval: '1m', since: T0,
  until: T0 + 3 * MIN, candles, quiet: true, quoteUsdso: 0, base: 1, markoutBars: 0 });
const m = r.metrics;
console.log('Run starts with 1 WETH worth 100 (--base 1), sells it at the bid on a flat market:');
console.log(`  trades ${m.trades}, totalPnl ${m.totalPnl.toFixed(4)} (equity-based, correct: the spread paid)`);
console.log(`  realizedPnl ${m.realizedPnl.toFixed(4)}   <- whole sale price booked as profit`);

// 2. Same ledger, adding to starting inventory: the average entry is diluted by the zero cost basis.
const l = new PortfolioLedger(1000, 1);
l.applyFill({ orderId: 1n, isBid: true, price: 100, qty: 1, fee: 0, timestamp: T0, role: 'taker' });
l.applyFill({ orderId: 2n, isBid: false, price: 100, qty: 2, fee: 0, timestamp: T0, role: 'taker' });
console.log('\nStart with 1 unit, buy 1 more @ 100, sell both @ 100 (no fees, no price change):');
console.log(`  realizedPnl ${l.realizedPnl.toFixed(4)}   (expected 0)`);
