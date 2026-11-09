# perp-funding: `PERP_FUNDING_MAX_POSITION_USDSO` is never enforced. The "at the position cap" branch can't run, and a 3.86M USDso position sits under a 200 USDso cap

**Severity:** normal
**Area:** SDK (dreamdex-bot-kit `strategies/perp-funding`)

> **Summary.** The README calls `PERP_FUNDING_MAX_POSITION_USDSO` "what bounds" a carry position's exposure to the
> mark. In the code the only cap check sits inside a branch that runs only when there is **no** position, so the
> notional it compares is always 0. The bot never reports "at the position cap", never reduces, and holds positions of
> any size. Live, against a Hideki account short 47.4 BTC, it logged `holding short 3863193.63 USDso` every poll with
> `cap 200`. The only thing the setting does is clamp the first entry to `min(NOTIONAL, MAX_POSITION)`.

## Steps to reproduce

Read-only dry run, no key:

1. Clone and install the kit at `25798660`.
2. `NETWORK=hideki OWNER_ADDRESS=0x8239544db8718d75111e4aeedc42036742d22e68 PERP_SYMBOL=BTC-PERP PERP_FUNDING_POLL_MS=5000 DRY_RUN=true npm start -w perp-funding`
   That account is short BTC-PERP while funding pays shorts. Any account holding the paid side above 200 USDso works.

## Expected

With the position above the cap, the bot logs that it's at the cap and, as the README implies, brings exposure back
under `PERP_FUNDING_MAX_POSITION_USDSO`. At the very least it says the position exceeds the configured bound.

## Actual

```
perp-funding on BTC-PERP | enter above 10.00% APR, exit below 3.00% | 50 USDso per entry at 2x, cap 200 | dry-run true
MarginBank ready: 750763.38 unlocked, 0.00 locked, equity 720451.38, status Healthy.
funding 157.152% APR, paying shorts | holding short 3863193.63 USDso
funding 157.152% APR, paying shorts | holding short 3861274.15 USDso
```

The bot keeps polling and never mentions the cap. Cause, `strategies/perp-funding/src/index.ts` @ `2579866`:

```ts
101  const held = position ? position.contracts * liveAt : 0;
...
126  } else if (!position && worthHolding && me) {
127    if (held >= MAX_POSITION) {                 // held is always 0 here: unreachable
128      console.log("at the position cap, not adding");
```

Because entry only happens when `!position`, the bot also never "adds" up to the cap. A long-running bot holds one
entry of at most `min(NOTIONAL, MAX_POSITION)`, whatever the cap is set to. It never scales in, and nothing bounds a
position that is already larger, including one that grew through repeated runs or that report 02's adoption picked up.

## Evidence

- `evidence/funding-cap.out`, 2026-10-28 10:06:31 UTC.

## Suggested fix

Either compute the cap against `held` outside the `!position` branch, and reduce or refuse when `held > MAX_POSITION`,
or rename the setting and fix the README so it doesn't claim the bound.

## Related but not duplicate

- **tang-vu 004** ("perp-maker's named maximum position permits a near-cap quote beyond that notional") is about
  **perp-maker**'s cap letting one quote overshoot. Here, **perp-funding**'s cap check can never run at all.
- **Anto-099-New-State/feedbacks**: its unfiled perp-funding candidate concerns funding forgiven by lazy settlement,
  not the position cap. Reports 001–004 do not touch perp-funding.
- **tang-vu 003** concerns perp-starter's preflight. Not related.
- Not found in rohan911438, swiftbotlab or clatsonhacks (searched for `PERP_FUNDING_MAX_POSITION`, perp-funding).

## Environment

- dreamdex-bot-kit `25798660bbe4674a6f83a960b202852896e2fed4`, `@somnia-chain/markets-sdk` 0.31.0 (as resolved by perp-core).
- Somnia Hideki testnet, chain 50383. RPC `https://api.hideki2.infra.testnet.somnia.network`.
- Node v24.14.0, Windows 11 Pro (Git Bash).
