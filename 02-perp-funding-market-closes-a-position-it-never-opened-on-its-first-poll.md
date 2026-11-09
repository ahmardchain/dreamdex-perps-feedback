# perp-funding market-closes a position it never opened, on its first poll, whenever that position is on the side funding charges

**Severity:** major
**Area:** SDK (dreamdex-bot-kit `strategies/perp-funding`)

> **Summary.** perp-funding does not track which position it opened. On every poll, including the first one after
> startup, it market-closes any position the account holds on `PERP_SYMBOL` when that position is on the side funding
> *charges* or the rate is under `PERP_FUNDING_EXIT_APR`. Point the bot at an account that already holds a hand-opened
> or hedging position, and the bot's first action is an unrequested IOC that closes it. The bot's own README and exit
> message take the opposite position: "closing it would realise PnL nobody asked to realise". Reproduced in dry run
> against a real Hideki account.

## Steps to reproduce

Read-only. No key is needed, because DRY_RUN prints the order the bot would send.

1. `git clone https://github.com/somnia-chain/dreamdex-bot-kit && cd dreamdex-bot-kit && git checkout 25798660 && npm install`
2. Pick any Hideki account that holds a perp **long** on a market where funding pays shorts (most markets right now:
   `npm run perp:doctor` prints `pays shorts`). This report used `0xb5dc75a39a4b174c0b800387146a291efa8eb051`
   (a 54 XLM long). To find others, query `PerpPosition(where:{size:{_neq:"0"}, isLong:{_eq:true}})` on
   `https://hideki-dev.smk.somnia.host/v1/graphql`.
3. Run:
   ```bash
   NETWORK=hideki OWNER_ADDRESS=0xb5dc75a39a4b174c0b800387146a291efa8eb051 PERP_SYMBOL=XLM-PERP \
   PERP_FUNDING_POLL_MS=5000 DRY_RUN=true npm start -w perp-funding
   ```

## Expected

The bot leaves positions it did not open alone. At minimum it refuses to start, or asks for an explicit opt-in such as
`PERP_FUNDING_ADOPT_EXISTING=true`, when the account already holds a position on the market. This is how the README's
exit rule reads: the bot avoids realising PnL "nobody asked to realise".

## Actual

On the first poll the bot plans an IOC that closes the account's whole existing position:

```
perp-funding on XLM-PERP | enter above 10.00% APR, exit below 3.00% | 50 USDso per entry at 2x, cap 200 | dry-run true
watching 0xb5Dc75a39A4b174c0B800387146A291eFa8eb051 read-only: set PRIVATE_KEY to the bot key linked to it to trade
MarginBank ready: 94.15 unlocked, 0.00 locked, equity 93.07, status Healthy.
funding 10.950% APR, paying shorts | holding long 9.29 USDso
closing: funding flipped against this side
[dry-run] would place carry exit short 54 XLM @ 0.1713
```

Nothing "flipped": the bot had only just started. With a key that can send, this becomes a real `placeOrderFor` IOC.
I confirmed that against the same account with an unlinked throwaway key: the bot built and simulated
`placeOrderFor(owner=0xb5Dc…, isBid=false, price=171300000000000000, quantity=540000000, orderType=2)`, and only the
missing link (`OnlyApprovedContracts()`) stopped it. See `evidence/dryrun0-guard-funding.out`.

Cause, `strategies/perp-funding/src/index.ts` @ `2579866`:

- line 100: `const position = me ? await positionIn(ctx.exchange, fresh) : undefined;` returns *any* position the account
  holds on the market. Nothing records which one the bot opened.
- lines 119–125: `if (position && (!worthKeeping || position.side !== funding.paidSide)) { … closePosition(ctx, fresh, me, { label: "carry exit" }) }`
  `closePosition` (`packages/perp-core/src/orders.ts`) closes the whole `previewPerpClosePnl().closedQuantity`, at
  MARKET with 20 bps slippage.
- line 160 says the opposite on Ctrl-C: "The position is left open deliberately: closing it on exit would realise PnL nobody asked to realise."

Also affected:
- The same path fires when funding is merely *low* (`|apr| < PERP_FUNDING_EXIT_APR`, default 3%), whichever side the
  position is on. Any position on a quiet market gets closed.
- The trigger is in normal use. The docs tell users to run the bot on their own DreamDEX account through a linked key,
  which is the account they also trade by hand in the app.

## Evidence

- `evidence/dryrun0-guard-funding.out`: the DRY_RUN=true plan above, and the live `placeOrderFor` call it builds.
- Account state at the time: `MarginBank ready: 94.15 unlocked … equity 93.07`, a 54 XLM long, funding +10.95% APR
  (pays shorts).

## Suggested fix

At startup, read the existing position. Refuse to run, or adopt it only with an explicit flag. Close only quantity the
bot itself opened, for example by tracking its own order IDs and fills.

## Related but not duplicate

- **tang-vu/dreamdex-perps-feedback 003** ("perp-starter applies a new-entry margin budget before discovering an
  existing position"). Different strategy (perp-starter) and the opposite failure: there, the bot *exits* before reading
  an existing position. Here, perp-funding reads it and **closes it**. tang-vu 002 (perp-starter's bracket side on an
  opposite existing position) is also perp-starter only.
- **Anto-099-New-State/feedbacks** 001–004 and its unfiled perp-funding candidate (funding forgiven by lazy settlement)
  do not cover how perp-funding treats existing positions.
- **rohan911438 MAJOR-06** (no reduce-only flag) concerns how a close is sized. This report is about the bot deciding to
  close a position it never opened at all.
- Not found in rohan911438/DreamDex-Findings, swiftbotlab/dreamdex-feedback or clatsonhacks/dreamdex-perps-feedback
  (searched for perp-funding, existing position, `positionIn`).

## Environment

- dreamdex-bot-kit `25798660bbe4674a6f83a960b202852896e2fed4`. perp-core resolves `@somnia-chain/markets-sdk` 0.31.0.
- Somnia Hideki testnet, chain 50383. RPC `https://api.hideki2.infra.testnet.somnia.network`, indexer `https://hideki-dev.smk.somnia.host/v1/graphql`.
- Node v24.14.0, Windows 11 Pro (Git Bash). Run 2026-10-28 10:04–10:05 UTC.
