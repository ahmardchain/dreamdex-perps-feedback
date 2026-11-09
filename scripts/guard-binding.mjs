// Offline repro (no network, no keys, no tx): the bot kit's prepared-tx guard signs a
// placeOrder that does something other than what the bot requested, on the SAME pool.
// node guard-binding.mjs <bot-kit>/examples/01-multi-strategy-ai/utils/prepared-tx-guard.js
import { pathToFileURL } from 'node:url';
const g = await import(pathToFileURL(process.argv[2]).href);
const POOL = '0x' + '11'.repeat(20);          // WETH/USDso: the pool the bot approved and asked for
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const order = (isBid, price, qty, type) =>
  g.SELECTORS.placeOrder + w(isBid) + w(0) + w(price) + w(qty) + w(2n ** 63n - 1n) + w(type) + w(0) + w(0) + w(0);
const E18 = 10n ** 18n;
// The bot asks the API for: SELL 0.01 WETH, limit 3,000, postOnly (type 3).
const cases = {
  'what the bot asked for          ': order(0, 3000n * E18, 10n ** 16n, 3),
  'side flipped to BUY             ': order(1, 3000n * E18, 10n ** 16n, 3),
  'BUY 300 WETH at 300,000 (100x)  ': order(1, 300000n * E18, 300n * E18, 2),
  'SELL 300 WETH at 30 (1/100)     ': order(0, 30n * E18, 300n * E18, 2),
};
for (const [name, data] of Object.entries(cases)) {
  try {
    await g.checkPreparedTx({ to: POOL, data, value: '0', chainId: 5031 },
      { allow: [g.SELECTORS.placeOrder], chainId: 5031, isKnownPool: async (a) => a.toLowerCase() === POOL });
    console.log(`${name} -> ACCEPTED (simulated, then signed)`);
  } catch (e) { console.log(`${name} -> rejected: ${e.message}`); }
}
