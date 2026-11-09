# dreamDEX Perps Builder Bounty: feedback reports (bot kit, SDK and REST API)

Reports 01–05 were tested live against Somnia Hideki testnet (chain 50383) on 2026-10-28, dreamdex-bot-kit @ `25798660`
(perp-core resolves `@somnia-chain/markets-sdk` 0.31.0). Reports 06–13 are against dreamdex-bot-kit @ `4e75896` /
`@somnia-chain/markets-sdk` 0.32.1 and the dreamDEX REST API. Each report is deduplicated against 330+ public dreamdex
repos on GitHub and has a "Related but not duplicate" section.

| # | Title | Severity | Area |
|---|---|---|---|
| 01 | perp-guard exits on a single RPC read timeout with every feed live (2 crashes / 30 min at default settings) | major | SDK (bot kit) |
| 02 | perp-funding market-closes a position it never opened, on its first poll | major | SDK (bot kit) |
| 03 | `DRY_RUN=0` trades live but skips the live-mode safety gates | normal | SDK (bot kit) |
| 04 | perp-funding `PERP_FUNDING_MAX_POSITION_USDSO` is never enforced | normal | SDK (bot kit) |
| 05 | perp-guard read-only mode promises health output, prints nothing | normal | SDK (bot kit) |
| 06 | Prepared-tx guard never checks the order matches the request (side, price, size, pool unchecked) — input-validation/hardening gap; worst case bounded by the band + liquidity (see 09) | normal | bot kit examples (`4e75896`) |
| 07 | Backtest GTC orders fill against their own bar's high/low, prices from before they were placed | normal | bot kit `packages/backtest` (`4e75896`) |
| 08 | Backtest `realizedPnl` books the sale of starting inventory (`--base`) as pure profit | minor | bot kit `packages/backtest` (`4e75896`) |
| 09 | session-keys' "can never move funds" is not contract-enforced — a `placeOrderFor`-only operator can trade value out, bounded (not stopped) by the perp circuit band and spot book liquidity; refuted as a drain on all live pools | note (docs + hardening) | docs + operator model |
| 10 | REST order-prepare accepts an unbounded `amount` and a malformed `walletAddress` — returns a ready-to-sign order (+ matching approval) that can only fail on-chain, instead of rejecting invalid input | minor | REST API (prepare) |
| 11 | `getOpenPositionsWithPnL` / `getBinaryPositionPnL` build cost basis from only the newest 1000 fills — busy wallets get zero-cost "profit" and wrong realized PnL, silently (live: 143/144 markets wrong on one Shannon wallet) | normal | SDK 0.32.1 (binary PnL) |
| 12 | `computeBinaryPnl` ignores complete-set mint/merge — a flat mint-and-sell trade reports +60 phantom profit and loses the sale proceeds | minor | SDK 0.32.1 (`units.ts`) |
| 13 | REST `GET /v0/orders` is not scoped to the authenticated wallet — any SIWE-logged-in session can read any wallet's orders via `?walletAddress=` | minor | REST API (`/v0/orders`) |

`evidence/` holds every log and the read-only probe scripts (run from a sibling of the kit:
`cd dreamdex-bot-kit && NETWORK=hideki npx tsx ../probes/<script>.ts`). Every run was read-only or dry-run. The one
key used was a throwaway that was never linked or funded, so no transaction reached the chain.
