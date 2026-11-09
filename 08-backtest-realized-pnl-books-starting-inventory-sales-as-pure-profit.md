# bot kit (4e75896): the backtest's `realizedPnl` books the full sale price of starting inventory (`--base`) as profit

**Severity:** minor
**Area:** bot kit (`packages/backtest`: `PortfolioLedger`)

## Summary

`PortfolioLedger` starts its position at `initialBase`, but with an average entry of `0` (`sim/ledger.ts:30-31`). When the strategy later sells that inventory, `realizedPnl += (price - avgEntry) * closed` (`:54`) counts the **whole sale price** as realized profit. When it buys more first, the zero cost basis is averaged in (`:45`) and understates the entry of every later unit.

The runner itself values the same inventory at the first close (`replay/runner.ts:248`, `initialEquity = initialQuote + initialBase * firstClose`). So in one result, `totalPnl` is right and `realizedPnl` is off by the value of the starting inventory. With `--base 1` on a flat market at 100, selling the unit at the bid reports `totalPnl -0.05` and `realizedPnl +99.95`.

## Steps to reproduce

1. Check out `somnia-chain/dreamdex-bot-kit` at `4e75896` and `npm install` (builds `packages/backtest/dist`).
2. Run the attached offline repro against the kit's own engine (no network: `fetch` is stubbed to throw, so no key and nothing sent):
   ```sh
   node scripts/backtest-realized-pnl.mjs <bot-kit>/packages/backtest/dist/index.js
   ```
   Case 1 calls the kit's real `backtest()` with `base: 1, quoteUsdso: 0` (the CLI's `--base 1 --quote-usdso 0`) on three flat 1m candles at 100. The bot sells its 1 unit IOC at the bid on the first bar. Case 2 drives `PortfolioLedger` directly: start with 1 unit, buy 1 more at 100, sell 2 at 100.
3. `realizedPnl` is part of `BacktestMetrics` and is written to the `--out` JSON report (`report/export.ts`, `formatJsonReport`).

## Expected

Starting inventory carries a cost basis, the first close that the runner already uses for `initialEquity`. Case 1: `realizedPnl ≈ -0.05`, the half-spread paid, matching `totalPnl`. Case 2: `realizedPnl = 0`.

## Actual

```
Run starts with 1 WETH worth 100 (--base 1), sells it at the bid on a flat market:
  trades 1, totalPnl -0.0500 (equity-based, correct: the spread paid)
  realizedPnl 99.9500   <- whole sale price booked as profit

Start with 1 unit, buy 1 more @ 100, sell both @ 100 (no fees, no price change):
  realizedPnl 100.0000   (expected 0)
```

**Impact.** Any run started with `--base` (a documented CLI flag, "Starting balances" in `docs/backtesting.md`) reports a `realizedPnl` inflated by the market value of the inventory it sells. A strategy that liquidates inventory at a loss shows a large realized profit in the JSON report. `totalPnl`, `finalEquity` and the review table are equity-based and not affected.

## Suggested fix

Give the starting inventory the same cost basis the runner uses for `initialEquity`:

```ts
// ledger.ts
constructor(initialQuote: number, initialBase = 0, initialBasePrice = 0) {
  this.quote = initialQuote;
  this.base = initialBase;
  this.positionBase = initialBase;
  this.avgEntry = initialBase > 0 ? initialBasePrice : 0;
}
// runner.ts: compute firstClose before building the ledger
const ledger = new PortfolioLedger(initialQuote, initialBase, firstClose);
```

Add case 1 to the tests: with a starting base and a flat market, `realizedPnl` equals `totalPnl` (fees and spread only).

## Related, not duplicate

- z0mb1eez kit2-04: the sim never checks balances, so a strategy can sell base it does **not** own. This report is about base the strategy **does** own, given through the documented `--base`. It has no cost basis, so its full sale price counts as profit. No naked sell is involved, and a balance check would not change the result.
- z0mb1eez kit2-03: `winRate` uses only the last buy as the entry. That is a different metric, and its repro starts flat with `realizedPnl` as the correct reference.
- mobilelegenddz11-art `backtest-ledger-pnl`: the same `realizedPnl` is wrong for **shorts and long→short flips**, because the sell branch never opens a short and the buy branch never realizes. Those are different branches (`ledger.ts:41-64`), reached only through oversells. This report is the constructor's zero cost basis for owned starting inventory (`ledger.ts:30-31`), with no short at any point. Fixing short accounting leaves case 1 at +99.95.
- The live-PnL reports (swiftbotlabs #30 and #35, anto #001, devorun #006) concern the SDK's and app's position PnL, not the backtest ledger.
- Checked against all 331 public repos returned by GitHub's search for "dreamdex".

## Evidence

- [`scripts/backtest-realized-pnl.mjs`](scripts/backtest-realized-pnl.mjs) (attached). It loads the kit's own `backtest()` and `PortfolioLedger` and prints the result above.
- Full run output, with the kit commit, Node version and sha256 of the script and engine files: [`evidence/08/backtest-realized-pnl-20261106T014916Z.txt`](evidence/08/backtest-realized-pnl-20261106T014916Z.txt).

## Environment

- dreamdex-bot-kit `4e75896` (`packages/backtest` and `packages/core` unchanged since `2579866`)
- Node 24.14.0, Windows 11 (no Python used; both repros are Node-only)
- Offline: no RPC, API or wallet used
