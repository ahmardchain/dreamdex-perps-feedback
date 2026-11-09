# perp-guard exits on one transient RPC read timeout, with every feed live: `fetchPositions` → `getPerpState` → `tryGetMarkPrice`, 2 crashes in 30 minutes at default settings

**Severity:** major
**Area:** SDK (dreamdex-bot-kit `strategies/perp-guard`, `packages/perp-core/src/orders.ts`)

> **Summary.** perp-guard calls `fetchPositions()` once to build its watch list and once more for every held market
> (`positionIn`), outside any try/catch. With the SDK the kit resolves (0.31.0), each `fetchPositions()` call makes
> about 10 reads per perp pool across all 21 pools (`getPerpPosition` plus the `getPerpState` fan-out). If any one of
> those reads times out, `fetchPositions` rejects, `main()` rejects, and the guard calls `process.exit(1)`. Nothing is
> stale when this happens: all 21 feeds were live through every crash. Run on Hideki at default settings (30 s poll)
> against a real 18-position account, the guard **died twice in 30 minutes**, after 103 s and after 446 s. Each time
> the error was `rpc readContract tryGetMarkPrice failed: The request took too long to respond.` Once dead, it guards
> nothing until something restarts it.

## Steps to reproduce

Read-only. DRY_RUN with no key; the crash is in the reads, so dry-run is enough.

1. `git clone https://github.com/somnia-chain/dreamdex-bot-kit && cd dreamdex-bot-kit && git checkout 25798660 && npm install`
2. Run the guard against any account holding several perp positions, with default thresholds and poll, in a restart loop:
   ```bash
   end=$(( $(date +%s) + 1800 )); n=0
   while [ $(date +%s) -lt $end ]; do n=$((n+1)); s=$(date +%s)
     NETWORK=hideki OWNER_ADDRESS=0xb5dc75a39a4b174c0b800387146a291efa8eb051 PERP_GUARD_POLL_MS=30000 DRY_RUN=true \
       timeout $(( end - $(date +%s) + 1 )) npx tsx strategies/perp-guard/src/index.ts > guard-run-$n.log 2>&1
     echo "$(date -u +%FT%TZ) RUN $n exit=$? after $(( $(date +%s) - s ))s last: $(grep -v PERP: guard-run-$n.log | tail -1)"
   done
   ```
   `0xb5dc…b051` held 18 positions on 2026-10-28.
3. To check the feeds at each crash, replay `tryGetMarkPrice()` and `getIndexPrice()` on all 21 pools at the blocks
   before each exit: `FROM=<block> TO=<block> STEP=50 npx tsx evidence/p6-oracle-history.ts`. The Hideki RPC serves
   historical state.

## Expected

A transient read failure costs the guard one cycle. It logs the failure and tries again on the next poll, because it
exists to stay up while positions are open. Its per-market try/catch (`index.ts:150-153`: "One market refusing … must
not stop the guard watching the rest") shows that intent, but it covers only the close, not the reads that fail here.

## Actual

30-minute loop, default config, 2026-10-28 (`evidence/guard-restarts.log`):

```
10:21:52Z RUN 1 start
10:23:35Z RUN 1 exit=1 after 103s  last: @somnia-chain/markets-sdk: rpc readContract tryGetMarkPrice failed: The request took too long to respond.
10:23:35Z RUN 2 start
10:31:01Z RUN 2 exit=1 after 446s  last: @somnia-chain/markets-sdk: rpc readContract tryGetMarkPrice failed: The request took too long to respond.
10:31:02Z RUN 3 start
10:51:53Z RUN 3 exit=124 after 1251s   (stopped by the loop's own timeout; still running)
```

**Measured rate: 2 crashes in 1,800 s of guard runtime, about 4 per hour.** Time to crash was 103 s, 446 s, and at
least 1,251 s for the run that the loop's timeout ended.

**Every feed was live during the crashes.** For the 60 s before each exit, I replayed both oracle reads on all 21
pools every 50 blocks (about 5 s). Every sample shows `reverts=0 markOk=21/21` (`evidence/p6-crash-windows.out`):

```
block 35298393 10:23:32Z reverts=0 markOk=21/21    ← RUN 1 exit 10:23:35Z
block 35298443 10:23:37Z reverts=0 markOk=21/21
block 35302853 10:30:59Z reverts=0 markOk=21/21    ← RUN 2 exit 10:31:01Z
block 35302903 10:31:04Z reverts=0 markOk=21/21
```

A 2-second watcher on the BTC-PERP pool also logged `mark ok, index ok` at 10:18:14Z and no transition through
10:52Z (`evidence/oracle-watch.log`). The reads did not revert. One RPC request did not answer within viem's
default 10 s timeout.

**Path.** The error names `tryGetMarkPrice`. In SDK 0.31.0 the only call in perp-guard that issues it without catching
is `getPerpState`, inside `fetchPositions`:

- `strategies/perp-guard/src/index.ts:128` calls `watchList()`, and `:76` calls `ctx.exchange.fetchPositions()`.
- `:139` calls `positionIn(ctx.exchange, market)`, once per held market. `packages/perp-core/src/orders.ts:223` calls
  `exchange.fetchPositions()` with no refs.
- SDK 0.31.0 `dist/unified/exchange.js:3272-3278`: for **every** swap market, `Promise.all([getPerpPosition, getPerpState])`,
  with no catch.
- `dist/perp/state.js:45-56, 85+`: `getPerpState` sends ten separate `readContract`s (`tryGetMarkPrice`, `getIndexPrice`,
  …). The kit's `makeChain` defines no multicall3, so this is the fan-out path, and the first rejection fails the whole call.
- `liveMark` (`tryGetHealthSnapshot`) and `liveFunding` catch their own errors, so they are not the source.
- The guard's only try/catch (`index.ts:153`) wraps `closePosition`, not the reads.

**Why the exposure is high.** An account with N positions makes N+1 `fetchPositions()` calls per cycle, each across
all 21 pools. On the 18-position account that is about 19 × 21 × 11 ≈ 4,400 `eth_call`s per cycle. One cycle took
about 47 s of reads (`evidence/live-guard.log`). A single timeout anywhere in that burst kills the process.

Also observed: in an earlier run with `PERP_GUARD_POLL_MS=3000` (`evidence/live-guard.log`), the guard died at
10:21:31Z with `rpc readContract getAccountState failed: The request took too long to respond.` That read comes from
`marginSnapshot` (`index.ts:137`). It is the same transient-RPC trigger at a different call site, and all 21 feeds were
live then too (`p6-crash-windows.out`, blocks 35297103–35297203). It is not counted in the rate above because it ran
outside the default config.

**Not affected in the same window:** perp-funding on BTC-PERP ran with a 3 s poll from 10:18 to 10:54Z (209 polls)
and did not crash (`evidence/live-funding.log`). It calls `fetchPositions()` once per poll rather than N+1 times, but
the same call is uncaught in its loop (`perp-funding/src/index.ts:100`).

## Evidence

- `evidence/guard-restarts.log`, `evidence/guard-run-{1,2,3}.log`: the 30-minute default-config loop.
- `evidence/p6-crash-windows.out`, `evidence/p6-oracle-history.ts`: all 21 feeds replayed at historical blocks, live at every crash.
- `evidence/oracle-watch.log`, `evidence/p8-oracle-watch.ts`: 2-second BTC-PERP feed watcher; no transition 10:18–10:52Z.
- `evidence/live-guard.log`: 3 s-poll run, with cycle timing and the `getAccountState` exit.

## Suggested fix

- Wrap each cycle's reads in a try/catch that logs and continues to the next poll. Count consecutive failures and exit
  only after a sustained outage, saying so.
- Call `fetchPositions()` once per cycle and reuse the result for every market, rather than N+1 full scans. Or pass
  `refs` for the markets in the watch list.
- Bump perp-core to SDK ≥ 0.32.1. There, `fetchPositions` reads pool state only for held positions and contains its
  failure (see Related), which shrinks the per-cycle fan-out.
- Give the viem transport a `retryCount` / `timeout` suited to the Hideki RPC.

## Related but not duplicate

- **Anto-099-New-State/feedbacks `feedback/002-botkit-perp-guard-exits-on-one-stale-feed.md`.** Same symptom (perp-guard
  exits because a read sits outside its try/catch), but a different trigger and a different read:
  | | Anto 002 | This report |
  |---|---|---|
  | Trigger | a **stale feed** on a held market (`markPriceOk: false`), so the MarginBank's `getAccountHealth` view **reverts** | a **transient RPC timeout**, with **all 21 feeds live** (`markOk=21/21`, zero index reverts) |
  | Failing read | `marginSnapshot` → `getMarginAccount` → `getAccountHealth` (`index.ts:137`) | `watchList` / `positionIn` → `fetchPositions` → `getPerpState` → `tryGetMarkPrice` (`index.ts:76`, `:139`; `orders.ts:223`) |
  | Evidence | offline mock repro, plus a live holder scan | 2 live crashes in a 30-min default-config run, timestamped and replayed against chain state |
  | Fixed by their suggestion? | n/a | No. Moving `marginSnapshot` into the try (their fix) leaves `:128` and `:139` outside it, and both crashes here came from those lines. |
- **rohan911438/DreamDex-Findings MAJOR-05.** perp-maker forgets quotes and exits outside its cleanup on an RPC outage
  (a dead endpoint). That report covers perp-maker's quote tracking. This one covers perp-guard dying on a single
  timeout while the endpoint is up.
- **rohan911438/DreamDex-Findings NORMAL-14.** The kit pins SDK `^0.31.0`. That report names the pin; this one shows a
  live consequence (the all-pool `fetchPositions` fan-out).
- Separately, at 09:58:53–09:59:40Z all 21 feeds went stale together (`evidence/p6-zoom.out`; earlier ones at 09:13
  and 09:43Z in `evidence/p7.out`). In SDK 0.31.0 that also fails `fetchPositions` for every account, which is the
  stale-feed scenario in Anto 002 reached through a different read. I did not catch a guard crash during one, so it is
  not claimed here.

## Environment

- dreamdex-bot-kit `25798660bbe4674a6f83a960b202852896e2fed4`. perp-core resolves `@somnia-chain/markets-sdk` **0.31.0**
  (`packages/perp-core/node_modules`). viem 2.54.1, tsx 4.
- Somnia Hideki testnet, chain 50383. RPC `https://api.hideki2.infra.testnet.somnia.network` (the kit default). Indexer `https://hideki-dev.smk.somnia.host/v1/graphql`.
- Node v24.14.0, Windows 11 Pro (Git Bash). Read-only: no key, no transactions. Runs 2026-10-28 10:17–10:54 UTC.
