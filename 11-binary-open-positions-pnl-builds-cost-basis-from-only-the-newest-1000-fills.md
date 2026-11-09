# SDK: `getOpenPositionsWithPnL` and `getBinaryPositionPnL` build cost basis from only the newest 1000 fills, so a busy wallet gets a wrong cost basis and wrong realized PnL with no warning (one live wallet: 143 of 144 markets wrong, positions shown as zero-cost profit)

**Severity:** normal
**Area:** SDK — `@somnia-chain/markets-sdk` 0.32.1, `src/createClient.ts:609-716` (binary PnL reads)

## Summary

Both binary PnL methods fetch the account's fills and router actions (mints/merges) with a hard
`limit: 1000`. The fetch is **newest-first** (`Fill` ordered `timestamp desc, blockNumber desc`;
`RouterActionRecord` ordered `timestamp desc`). When an account has more rows than that, the
**oldest** rows are the ones dropped. Those are the buys and mints that set the position's cost
basis. The avg-cost fold then:

- treats a leg whose opening buys were cut off as **zero-cost**, so the whole mark value is reported
  as unrealized profit;
- clamps sells of tokens it never saw bought to zero, so their realization disappears.

Neither method tells the caller. `BinaryPositionPnL` / `OpenPositionPnL` have no truncation flag and
nothing is thrown. Elsewhere the SDK does signal this: `getPortfolio` returns `tradesTruncated`, and
`getClaimable` throws `IncompletePortfolioError` instead of returning a partial answer.

`getOpenPositionsWithPnL` is the worse of the two. Its single 1000-row fills read is shared across
**every** open market at once (`getUserFills(account, { markets: marketIds, limit: 1000 })`), so a
wallet with a few hundred open markets only needs a few fills per market to go over.

## Live example — Shannon wallet `0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc`

`getOpenPositionsWithPnL` sees **1000 of the wallet's 84,946 fills** in its open markets. Comparing
the SDK's result with the same SDK fold run on the full history:

| | SDK result (1000-row cap) | Same fold, full history |
|---|---|---|
| Markets returned | 144 | 144 |
| Markets with wrong `costBasis` or `realizedPnl` | **143** | — |
| Σ `costBasis` error | **−13,794.64 USDC** (understated) | — |
| Σ `realizedPnl` error | **+2,347.16 USDC** | — |

Two of the wrong rows (6-decimal collateral, raw values in `evidence/11/`):

| Market | SDK `costBasis` / `realizedPnl` / `unrealizedPnl` | True `costBasis` / `realizedPnl` / `unrealizedPnl` |
|---|---|---|
| `…0052` | **0** / 0 / **+356.00** | 123.75 / −475.25 / +232.25 |
| `…0051` | **0** / 0 / **+349.00** | 115.24 / −322.84 / +233.76 |

On `…0052` the SDK shows a zero-cost position worth +356. In fact the wallet is down about 243 in
that market. The sign of total PnL is wrong, not just the size.

Other wallets in the same run:

| Wallet | Open markets | Fills SDK saw / in history | Markets wrong | Σ costBasis error |
|---|---|---|---|---|
| `0xe11825b1…aeb4` | 188 | 1000 / 2,361 | 142 | −589.49 USDC |
| `0x2aef6b1f…7b` | 200 | 1000 / 1,140 | 15 | −118.43 USDC |
| `0x93e30060…cf` (control) | 200 | 986 / 986 | 0 | 0 |

The control wallet is under the cap and matches exactly. This shows the method is right whenever it
sees the whole history, and the cap alone causes the error.

## Steps to reproduce

Read-only, indexer GraphQL only. No wallet, signature or transaction.

```
cd dreamdex   # sdk-latest/package = the 0.32.1 tarball, with its deps available
node findings/scripts/binary-open-pnl-cap.mjs 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
```

The script imports the SDK's own `getPortfolio`, `getUserFills`, `getRouterActions` and
`computeOpenPositionsPnL` from the 0.32.1 `dist/`. It makes the **exact calls**
`client.getOpenPositionsWithPnL` makes (`createClient.ts:662-716`: portfolio with
`ordersLimit/tradesLimit 0`, then fills + router actions scoped to the open markets with
`limit: 1000`). It folds them, then folds again with the full history paged in 1000-row offsets, and
diffs the two per market. Book tops are `{}`, which is the documented indexer-only mark (lastPrice).
This keeps the comparison free of chain reads, and the mark is identical on both sides of the diff.

`getBinaryPositionPnL(account, marketId)` (`createClient.ts:648-649`) uses the same
`limit: 1000` newest-first fetches, scoped to one market. It fails the same way once a single market
has more than 1000 of the account's fills (e.g. a market maker on a 24h market).

## Expected

One of:
- page through the account's full fill and router-action history in the scoped markets before
  folding (the fold needs every row back to the opening trade; a cap can only ever drop the rows that
  matter most); or
- if a cap is kept, report it: set a `truncated` / `historyComplete: false` flag on each result, or
  throw like `getClaimable` does (`IncompletePortfolioError`) instead of returning a confident wrong
  number.

## Actual

The newest 1000 rows are folded as if they were the complete history. Opening buys and mints older
than the cutoff are missing, so legs show `costBasis: 0` and their full mark value appears as profit.
Sells of those tokens are clamped to zero, so their realized PnL is lost. Nothing in the result shows
that history was cut.

## Evidence

- `evidence/11/<wallet>.json`: full per-wallet output (counts, Σ errors, example rows) for the four
  wallets above. Captured 2026-11-09 ~03:05 UTC against `https://dev.smk.somnia.host/v1/graphql`.
- `evidence/11/p17-open-positions-fills.mjs`: the read-only scan used to find wallets whose own fills
  across their open markets exceed 1000. Several of the 8,140 wallets with open positions do.
- Code: `createClient.ts:648-649` (`getBinaryPositionPnL`, `limit: 1000` each);
  `createClient.ts:712-713` (`getOpenPositionsWithPnL`, one `limit: 1000` read across all open
  markets); `fills.ts:1395` (`order_by: [{timestamp: desc}, {blockNumber: desc}]`);
  `router.ts:133` (`order_by: {timestamp: desc}`). The SDK comment at `createClient.ts:674-675`
  already notes that "Capped at 1000, an account-wide read drops the OLDEST rows first — the buys
  and mints that establish the basis". Scoping the read to open markets narrows the problem but does
  not remove it.

## Suggested fix

- Page `getUserFills` / `getRouterActions` to exhaustion (offset or the existing `getUserFillsPage`
  cursor) inside both methods, with a sane overall bound.
- If a bound is hit, mark the affected rows (`historyComplete: false`) or throw, as `getClaimable`
  does. Never return a cost basis built from a partial history without saying so.
- Document the history requirement on both methods.

## Related but not duplicate

- **Chibey-max/Pulse #4** ("`getOpenPositionsWithPnL` cannot express realized P&L") is about
  **redemptions**: `computePositionPnL` ignores `Redeem` router actions, so a held-to-settlement
  position never shows the payout as realized. That is a missing *event kind*, and it happens on
  every wallet. This report is about **missing rows**: the 1000-row newest-first cap drops the
  oldest fills and mints, so cost basis and sell realization are wrong even on wallets that never
  redeem. It only happens past the cap. Fixing either one does not fix the other.
- **Alike001/claimrail** ("Portfolio and claimable discovery stop at 200 positions") reported the
  200-position cap on `getPortfolio` / `getClaimable`. 0.32.1 fixed it there (`getClaimable` throws
  `IncompletePortfolioError`, `getClaimablePage` added), but `getOpenPositionsWithPnL` still calls
  `getPortfolio` with the default `positionsLimit` (200) and never checks `positionsNextOffset`. So
  it also silently drops positions past the 200th (e.g. `0x93e30060…cf` has 2,387 open markets and
  gets 200 rows back). That cap belongs to claimrail's report and is only noted here. The fills cap
  above happens *within* the 200 positions that are returned.
- shreyas-sovani/Window #7 (fills grouped by pool in `computeOpenPositionsPnL`) is a grouping-key
  bug that 0.32.1 has since fixed (fills now group by market id). It is unrelated to row limits.

Checked against all 335 locally mirrored dreamdex repos under `prior/all/` and a fresh GitHub repo
search (333 results on 2026-11-09; the 4 new repos were cloned and searched). No duplicate found.

## Environment

`@somnia-chain/markets-sdk` 0.32.1 (`dist/` from the published tarball). Somnia Shannon testnet
(chain 50312) indexer `https://dev.smk.somnia.host/v1/graphql`. Node 24. Read-only GraphQL reads,
2026-11-09.
