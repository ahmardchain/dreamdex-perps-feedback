# `DRY_RUN=0` makes the perp bots trade live but skips their live-mode safety gates (unlinked-key exit, PRIVATE_KEY requirement)

**Severity:** normal
**Area:** SDK (dreamdex-bot-kit `packages/perp-core` + `strategies/perp-maker`, `perp-guard`, `perp-funding`, `perp-starter`)

> **Summary.** Two different parsers read `DRY_RUN`. perp-core's `envBool` treats `"0"` as false, so orders are
> **sent**. Each strategy's own `live` flag is true only for the exact string `"false"`. That flag gates the safety
> checks: "exit if the trading key is not linked" and "PRIVATE_KEY is required". With `DRY_RUN=0` the banner prints
> `dry-run false` and the bot sends real transactions, but a key that the startup check reports as unable to trade
> no longer stops it. Reproduced live on Hideki with all three bots.

## Steps to reproduce

The key below is a fresh, unfunded and **unlinked** throwaway, so nothing can be filled. The point is that the bot
tries to send anyway.

1. Clone and install the kit at `25798660` (`npm install`).
2. `KEY=$(node -e 'console.log(require("viem/accounts").generatePrivateKey())')`
3. Control:
   `NETWORK=hideki PRIVATE_KEY=$KEY OWNER_ADDRESS=0xb5dc75a39a4b174c0b800387146a291efa8eb051 PERP_SYMBOL=XLM-PERP DRY_RUN=false npm start -w perp-maker`
4. Same command with `DRY_RUN=0`.
5. Repeat 3 and 4 for `perp-guard` and `perp-funding`.

## Expected

`DRY_RUN=0` and `DRY_RUN=false` behave the same, since `envBool` documents both as false. Either way, the bot exits
at the link check: "This bot key … cannot place/cancel/reduce orders …".

## Actual

| Bot | `DRY_RUN=false` | `DRY_RUN=0` |
|---|---|---|
| perp-maker | prints the link error, **exit 1** | prints `dry-run false` and the link error, **keeps going**: preflight, then sends `placeOrderFor(owner, isBid=true, price=171700000000000000, quantity=1450000000, orderType=3)`, stopped only by the pool's `OnlyApprovedContracts()` |
| perp-funding | link error, exit 1 | keeps going and builds a live `placeOrderFor` IOC that closes the account's existing 54 XLM long (see report 02), stopped only by `OnlyApprovedContracts()` |
| perp-guard | "cannot trade … on any perp market", exit | same message, **keeps running** as a live guard with a key that can't act: `XLM-PERP: long 54 … health 2.760x` |

The same split skips `createExchange({ withSigner: live })`. With `DRY_RUN=0` and no `PRIVATE_KEY`, the
"PRIVATE_KEY is required for trading" error never fires, and the first order fails deep inside the write path instead.

Cause @ `2579866`:

- `packages/perp-core/src/config.ts:66-70`: `envBool` returns `raw !== "false" && raw !== "0"`, and line 177 uses it
  for `dryRun`. That flag decides whether `placePerp` / `cancelQuietly` send.
- `strategies/perp-maker/src/index.ts:79-80, 93`, `perp-funding/src/index.ts:57-58, 79`,
  `perp-guard/src/index.ts:83-84, 115`, `perp-starter/src/index.ts:65` all use
  `process.env.DRY_RUN === "false"` to decide whether to require a signer and whether to exit on an unlinked key.

## Evidence

- `evidence/dryrun0-maker.out`: perp-maker with `DRY_RUN=0`: banner `dry-run false`, the link error, then the
  attempted `placeOrderFor` and its revert.
- `evidence/dryrun0-guard-funding.out`: the false/0 pairs for perp-guard and perp-funding, 2026-10-28 10:03–10:04 UTC.

## Suggested fix

Use `ctx.config.dryRun` everywhere: `const live = !ctx.config.dryRun`. Better, have `loadConfig` reject any
`DRY_RUN` value other than `true` or `false`.

## Related but not duplicate

- None of the five checked repos (tang-vu, rohan911438, swiftbotlab, clatsonhacks, Anto-099-New-State) mentions
  `DRY_RUN=0`, `envBool`, or the split between `config.dryRun` and the strategies' `live` flag. Searched 2026-10-28.
- swiftbotlab 13 (Ctrl-C under `tsx watch`) and rohan MAJOR-05 concern shutdown and cleanup, not dry-run parsing.
- tang-vu 003 concerns perp-starter's startup preflight ordering, not the link and signer gates skipped here.

## Environment

- dreamdex-bot-kit `25798660bbe4674a6f83a960b202852896e2fed4`. perp-core resolves `@somnia-chain/markets-sdk` 0.31.0. viem 2.54.1.
- Somnia Hideki testnet, chain 50383. RPC `https://api.hideki2.infra.testnet.somnia.network`.
- Node v24.14.0, Windows 11 Pro (Git Bash). Throwaway bot key `0x9F8E1904B18B035A090FAE49FDeAB94f1B2d6f68`: unlinked, no STT, nothing was sent on chain.
