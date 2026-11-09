# perp-guard without a key says "health is reported but nothing is closed", then reports nothing and loops silently

**Severity:** normal
**Area:** SDK (dreamdex-bot-kit `strategies/perp-guard`)

> **Summary.** Started with no `PRIVATE_KEY` (and no `OWNER_ADDRESS`), perp-guard prints
> `read-only: no PRIVATE_KEY, so health is reported but nothing is closed.` It then never prints another line. The
> loop builds a watch list of all 21 markets and leaves it at once with `if (!me) break`, every poll, forever. A user
> trying the guard read-only first, which the README suggests with "DRY_RUN=true by default", sees a bot that looks
> hung.

## Steps to reproduce

1. Clone and install the kit at `25798660`.
2. `NETWORK=hideki PERP_GUARD_POLL_MS=3000 DRY_RUN=true npx tsx strategies/perp-guard/src/index.ts`, with no
   `PRIVATE_KEY` or `OWNER_ADDRESS` in the environment or `.env`.
3. Wait 25 seconds or longer.

## Expected

Either health is reported as promised, or, since no account is configured, the guard exits with a message such as
"set OWNER_ADDRESS to watch an account read-only".

## Actual

```
perp-guard | reduce 25% below 1.5x maintenance, flatten below 1.15x | dry-run true
read-only: no PRIVATE_KEY, so health is reported but nothing is closed.
```

There is no further output, and the process keeps running. Cause, `strategies/perp-guard/src/index.ts` @ `2579866`:
line 100 prints the promise. `watchList()` returns every market when there is no account (line 75,
`if (!account) return perpMarkets(ctx.exchange)`), and the loop then hits `if (!me) break;` (line 136) before reading
anything. The read-only case that does work is `OWNER_ADDRESS` set without a key, but this banner doesn't mention it.

## Evidence

Terminal output above, 2026-10-28 10:19:54 UTC (25 s run, `timeout 25`).

## Suggested fix

When `me` is undefined, exit with a message that names `OWNER_ADDRESS`, or reword the banner.

## Related but not duplicate

- **Anto-099-New-State/feedbacks 002** is about perp-guard *exiting* when a feed is stale. This report is about
  perp-guard *never exiting and never reporting* when no account is configured. Same file, different branch
  (`index.ts:136` `if (!me) break` vs `:137` `marginSnapshot`).
- Report 01 here (RPC-timeout exits) is a different code path too.
- tang-vu 003 (perp-starter preflight) is not related. Not found in rohan911438, swiftbotlab or clatsonhacks.

## Environment

dreamdex-bot-kit `25798660bbe4674a6f83a960b202852896e2fed4`, markets-sdk 0.31.0 (perp-core), Hideki chain 50383,
Node v24.14.0, Windows 11 Pro.
