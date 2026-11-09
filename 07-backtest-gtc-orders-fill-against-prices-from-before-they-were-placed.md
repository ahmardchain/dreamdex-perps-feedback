# bot kit (4e75896): in the default backtest mode a GTC limit order fills against its own bar's high/low, prices that printed before the bot placed it

**Severity:** normal
**Area:** bot kit (`packages/backtest`: `FillEngine.place`, replay runner)

## Summary

The replay runner shows a strategy each bar after the bar has closed: `setCandle` builds the book from the bar's close (`replay/runner.ts:215`), then `onBar()` runs (`:217`). Anything the bot places is therefore placed after that bar's high and low already happened.

In the default mode (no `--queue-position`), `FillEngine.place` handles a Normal/GTC order by resting the remainder and then immediately re-matching every resting order against **the same bar** (`sim/fill-engine.ts:116-119`). A GTC bid therefore fills whenever the bar's low reached it, and a GTC ask whenever the bar's high reached it. Those prices are already in the past when the order exists. The fill is booked at the limit price, so the backtest buys the bar's wick for free.

On a market that opens and closes at 100, a GTC bid placed at 91 after a bar that wicked to 90 is filled at 91 and reports **+9 PnL**. A PostOnly order at the same price, or the same GTC order with `--queue-position`, correctly does not fill. The re-match covers every resting order, so one GTC placement also gives PostOnly orders placed earlier in the same `onBar()` a same-bar fill.

## Steps to reproduce

1. Check out `somnia-chain/dreamdex-bot-kit` at `4e75896` and `npm install` (builds `packages/backtest/dist`).
2. Run the attached offline repro against the kit's own engine (no network: `fetch` is stubbed to throw, so no key and nothing sent):
   ```sh
   node scripts/backtest-same-bar-fill.mjs <bot-kit>/packages/backtest/dist/index.js
   ```
   It calls the kit's real `backtest()` with four in-memory 1m candles. Bar 0 is O100 H100 L90 C100, and bars 1–3 trade only at 100. On its first `onBar()` the bot reads the book (bid 99.95 / ask 100.05) and places a 1-unit bid at 91.
3. Read `sim/fill-engine.ts:109-122`. The comment says the queue-mode branch skips the re-match to avoid "double-counting bar volume", but the legacy branch still runs it. The legacy branch is the default, used by `npm run backtest -- run|review` unless `--queue-position` is passed.

## Expected

An order placed during bar *t*'s `onBar()` can only fill against bars after *t*, as PostOnly orders already do: they are matched in the next `setCandle`. With no later bar trading at 91 it never fills, and PnL is 0.

## Actual

```
GTC bid @ 91, default mode                  -> maker buy 1 @ 91 in bar 0, totalPnl +9.0000
PostOnly bid @ 91 (control)                 -> no fill,                   totalPnl  0.0000
GTC bid @ 91, --queue-position (control)    -> no fill,                   totalPnl  0.0000
PostOnly bid @ 91, then a GTC bid @ 50      -> maker buy 1 @ 91 in bar 0, totalPnl +9.0000
```

**Impact.** Any strategy that rests GTC orders, which `docs/backtesting.md` lists as a modelled order type, is backtested with perfect hindsight on every wick. Resting bids below and asks above the close fill at the bar's extremes and then mark back to the close, so the backtest reports profit and positive markout on a flat market. This is the classic way a backtest makes a strategy look good that loses live. The shipped strategies use IOC and PostOnly only, so their numbers are not affected unless one of them is changed to GTC. The 4th case shows that mixing in a single GTC order also contaminates the PostOnly orders placed before it in the same callback.

## Suggested fix

Drop the legacy same-bar re-match in `FillEngine.place`. Rest the remainder and let the next `setCandle` → `matchRestingAgainstBar` match it, exactly as queue mode and PostOnly already do:

```ts
// Normal / GTC: try cross then rest remainder
const fills = this.tryCross(orderId, args, book, ts, "taker");
const rem = args.qty - fills.reduce((s, f) => s + f.qty, 0);
if (rem > 1e-12) this.resting.set(orderId, this.buildResting(orderId, args, rem, queueCtx));
return { orderId, fills };
```

The rule is already tested for queue mode only: `tests/fill-engine.test.ts:217`, "queue mode does not rematch Normal/GTC on the placement bar". Add the same test without a `queueCtx`, using the first case above: a GTC bid below the close on a bar whose low reached it must not fill in that bar.

## Related, not duplicate

- z0mb1eez kit2-01 (`FillEngine.tryCross` applies slippage after clamping to the limit price, so IOC orders fill past their own limit) and kit4-05 (`SimPool.place` does not snap price/qty to the tick/lot grid) are different fill-engine bugs. One is the **price** a taker fill gets, the other the **grid** an order is placed on. This report is about **when** a resting GTC order may fill: against its own bar's high/low, which printed before it was placed. Fixing either of those leaves this one in place.
- rohan911438 NORMAL-25 is about the SDK's `fetchTrades`/`fetchOHLCV` ignoring `since`, not about the fill model.
- Checked against all 331 public repos returned by GitHub's search for "dreamdex". No other report covers the same-bar re-match in `FillEngine.place`.

## Evidence

- [`scripts/backtest-same-bar-fill.mjs`](scripts/backtest-same-bar-fill.mjs) (attached). It loads the kit's own `backtest()` and prints the result above.
- Full run output, with the kit commit, Node version and sha256 of the script and engine files: [`evidence/07/backtest-same-bar-fill-20261106T014916Z.txt`](evidence/07/backtest-same-bar-fill-20261106T014916Z.txt).

## Environment

- dreamdex-bot-kit `4e75896` (`packages/backtest` and `packages/core` unchanged since `2579866`)
- Node 24.14.0, Windows 11 (no Python used; both repros are Node-only)
- Offline: no RPC, API or wallet used
