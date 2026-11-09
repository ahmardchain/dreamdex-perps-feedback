# SDK: `computeBinaryPnl` ignores complete-set mint/merge, so a mint-and-sell position reports phantom profit (+60 on a flat 100-unit trade) and loses the sale proceeds

**Severity:** minor
**Area:** SDK — `@somnia-chain/markets-sdk` 0.32.1, `src/units.ts:413` (`computeBinaryPnl`), with
`binaryFillsFor` / `binaryFillsFromPortfolio` (`units.ts:325`, `:371`)

## Summary

The SDK exports two binary PnL engines from the package root:

- `computePositionPnL` (bigint, `derivedReads.ts:521`), used by `getBinaryPositionPnL`. It folds
  order-book fills **and** `MintCompleteSet` / `MergeCompleteSet` router actions.
- `computeBinaryPnl` (number, `units.ts:413`), documented as the "PURE helper" for binary PnL and fed
  by `binaryFillsFor` / `binaryFillsFromPortfolio`. Its input type (`BinaryPnlFill`) has **no way to
  carry a mint or merge**, and its feeders read fills only.

Minting a complete set and selling one leg on the book is the standard way to take a binary
position or quote both sides. For that, `computeBinaryPnl`:

1. never sees the mint, so the kept leg has **zero cost** and its whole mark value shows as
   unrealized profit;
2. clamps the sale of the other leg to the (zero) quantity it saw bought, so the **sale proceeds
   vanish**: no realized PnL, no cost released.

The two engines return different answers for the same position. Nothing in `computeBinaryPnl`'s
docs says that complete sets are out of scope.

## Steps to reproduce

Offline, no network:

```
node findings/scripts/binary-pnl-mint.mjs
```

Position (18-decimal collateral): mint **100** complete sets (cost 100), sell the **100 NO** on the
book at YES = 0.60 (NO = 0.40, proceeds 40), keep **100 YES** marked at 0.60 (value 60).
True PnL = 40 + 60 − 100 = **0**.

The script passes the same fill (and, to the bigint engine, the mint) to both exported engines.

## Expected

Both engines report total PnL ≈ 0 for this flat trade. If `computeBinaryPnl` deliberately takes
fills only, it should say so and refuse (or warn) when holdings exceed what the fills explain,
instead of costing them at zero.

## Actual

```
computeBinaryPnl   (number, fills only): realized 0  unrealized 60  total 60
computePositionPnL (bigint, fills+mints): realized -10  unrealized 10  total 0
```

`computeBinaryPnl` reports **+60** (60% of the capital) on a trade that made nothing. The NO sale's
40 of proceeds appear nowhere. `computePositionPnL` gets it right.

## Evidence

- `evidence/12/binary-pnl-mint.out`: the output above (SDK 0.32.1 `dist/units.js` and
  `dist/derivedReads.js`).
- Code: `units.ts:325-347` (`binaryFillsFor`: fills only); `units.ts:413-467` (`computeBinaryPnl`
  sell branch: `sold = Math.min(qty, b.qty)` with `b.qty = 0` for a minted leg; unrealized
  `(mark - avg) * held` with `avg = 0`). Compare `derivedReads.ts:569-612`, where the bigint engine
  folds `mint` / `merge` as half-cost per leg.
- Both are root exports (`index.ts:844-846`). Neither is marked deprecated.

## Suggested fix

- Let `computeBinaryPnl` take complete-set events (a `kind: "mint" | "merge"` entry, or an optional
  `routerActions` argument) and fold them the way `computePositionPnL` does; or
- reimplement it as a thin `toHuman` wrapper over `computePositionPnL`, so the SDK has one PnL
  engine; or at least
- document that it ignores mints/merges and flag (or throw) when `balances` exceed the fills-derived
  holding, rather than costing the difference at zero.

## Related but not duplicate

- Prior reviews called `computeBinaryPnl` correct. **jack0xdev** (`VERIFICATION.md`:
  "`computePositionPnL`, `computeBinaryPnl` — correct avg-cost roll, exact cost release, no
  double-rounding") and **ZubeidHendricks/settled** (`SDK-FEEDBACK.md`: "`computeBinaryPnl` … exist
  and do the right thing"). Neither tested complete-set mint/merge, which is the input this report
  is about. Their checks of the avg-cost roll on fill-only input still stand.
- **Chibey-max/Pulse #4** is about `computePositionPnL` ignoring *redemptions*. This report is about
  `computeBinaryPnl` ignoring *mints/merges* (the bigint engine handles mints correctly).
- Local **finding 11** is about rows *dropped by a fetch cap* in the client methods. This report is
  about an *event kind* the pure helper can't take, at any history size.

Checked against all 335 locally mirrored dreamdex repos under `prior/all/` and a fresh GitHub repo
search (333 results on 2026-11-09). No duplicate found.

## Environment

`@somnia-chain/markets-sdk` 0.32.1 (`dist/` from the published tarball), Node 24, offline. 2026-11-09.
