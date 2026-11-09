# docs + hardening: session-keys' "can never move funds" is not contract-enforced — an operator key granted only `placeOrderFor` can still move value *through trading*, bounded (not stopped) by the perp circuit band and spot book liquidity

**Severity:** note (docs accuracy + optional hardening) — not an exploitable vulnerability on any
currently-tradeable pool
**Area:** docs (`docs/session-keys.md`) + operator model (SpotPool/PerpPool `placeOrderFor`, shared
`OperatorPermissionsRegistry`)

## Summary

`docs/session-keys.md` sells the operator (split-key) model with a hard guarantee:

> "your bot runs with a **hot key that can place and cancel orders but can never move funds**." …
> "It can't deposit, withdraw, or grant approvals — those are owner-scoped — and every fill settles
> to the **owner's** vault, never the operator's." … "If that box is compromised, a raw private key
> means drained funds. DreamDEX's operator (split-key) model removes that."

The clause is true for *direct* transfers (there is no `withdrawFor`/`transferFor` an operator can
call — see "What is actually enforced"). But "can never move funds" / "removes that" is **not
literally correct**: an operator granted only the `placeOrderFor` selector can move the owner's
working capital by *trading* it — placing the owner's order so it crosses the operator's own (or an
accomplice's) resting order. Every fill still settles to the owner's vault, as documented; the value
simply leaves through the trade.

Investigated end-to-end (read-only), the economic damage is **bounded, not catastrophic**, by two
independent mechanisms, so this is a docs-accuracy issue plus an optional hardening suggestion —
**not** the "drain at any price" a literal reading implies. It matches the "exposure = what any
trade-permission key has" conclusion other reviewers reached (see Related).

## What is actually enforced (verified, static)

- **No direct withdrawal by the operator.** `marginBankWriteAbi` = `deposit`, `withdraw`,
  `setMaxLeverage`, `repayFunding`, `recallFromChild` — none is a `*For`. `withdraw` is caller-signed;
  `recallFromChild` is gated `OnlyFundingPayer` (the owner). The only `*For` money calls are
  `depositFor`/`depositNativeFor`, which pay *into* an owner.
- **Builder-fee routing is owner-gated.** `placeOrderFor` carries `builder`/`builderFeeBpsTimes1k`,
  but the fee is clamped to the owner's own `getEffectiveBuilderApproval(owner, builder)` and there is
  no `approveBuilderFor`; the doc itself notes the operator "can't grant approvals."
- **`cancelOrderFor` / `reduceOrderFor` move no value** (cancel frees locked balance to the owner;
  reduce only lowers remaining quantity). `reduceOrderFor` is a separate selector, not granted by
  `operator-setup` by default.

## What is NOT enforced, and why it is bounded

An operator can place an owner order that crosses a counterparty order the attacker controls. The
self-match guard does not stop it: it keys on `maker.owner == taker.owner`, and here the maker
(attacker/operator account) and taker (victim owner via `placeOrderFor`) are different owners, so no
`SelfMatchCancelTaker` revert. The value extracted is nonetheless capped:

- **Perps — a circuit band caps the fill price.** Placement is unbanded, but a *fill* outside a band
  around the mark reverts `FillPriceOutsideBand`. On ETH-PERP (Hideki), `getCircuitBreakerParameters()`
  = `[250, 60]` (≈ 2.5% band + ~60 s window; `initialMarginBps` is also 250, matching
  `CircuitBandExceedsInitialMargin`). So an operator cannot cross the owner far from mark; extraction
  is ≤ the band per fill, and the attacker holds the opposite position at mark±band (real market risk).
- **Spot — no band, but CLOB price-time priority + live liquidity cap it.** Spot pools have no
  mark/oracle/band (`getMarkPrice` / `getCircuitBreakerParameters` / `oracle` all revert). But a CLOB
  fills the **best** price first, so for the owner's taker to match the attacker's order that order
  must be the best-priced — i.e. a *good* price for the owner. While competing near-fair liquidity
  exists, the owner cannot be pushed past the touch. Every tradeable dreamDEX spot pool has a tight,
  two-sided, actively market-made book (see Evidence), so the off-market order is never reached.

### Residual (narrow, transient, not live today)
The arbitrary-price drain is unconditional only against an **empty / one-sided** spot book — the
brief window of a new listing before the market maker arrives, or an MM outage — on a pool the owner
has both funded and granted an operator on. A read-only sweep of **all ten** dreamDEX spot pools
(Hideki ×3, Shannon ×3, mainnet ×4) found every one two-sided; no such pool exists now.

## Suggested changes

1. **Docs (primary).** In `docs/session-keys.md`, replace the absolute "can never move funds" /
   "removes that" with the accurate statement: an operator key can place and cancel orders and
   therefore can *trade* the owner's balance — it cannot withdraw or transfer, and its trading is
   bounded by the perp circuit band and by spot book liquidity, but a compromised operator key is
   still only as safe as the prices it can trade at (and an illiquid/empty-book pool removes that
   bound). Point users at per-pool (not global) grants and well-made markets.
2. **Optional hardening.** A minimum-liquidity / reference-price guard on operator (`placeOrderFor`)
   fills — reject a fill whose price is beyond a band around a reference, or when book depth at the
   touch is below a floor — would close the empty-book case for delegated orders without affecting
   self-directed trading.

## Evidence (read-only — `eth_call`, indexer, public REST; no transaction sent)

- Operator model / ABIs: `sdk-latest/package/dist/{tradeAbi,readsAbi,contractErrorsAbi}.js`,
  `spot/operatorGrants.js` (`PLACE_ORDER_FOR_SELECTOR 0x80054449`).
- Perp band: `getCircuitBreakerParameters()` = `[250,60]` and `getMarkPrice()` = 2230.60 on ETH-PERP
  `0xD6Cb1DD58580B84D76068aC21594219ce03aeddf`; `FillPriceOutsideBand` (`0xec4b288c`) in the match
  path. A `placeOrder` sim from an unfunded account reverts on a margin/size precheck before any band
  logic, so the band cannot be isolated read-only.
- Spot absence of band: `getMarkPrice` / `getCircuitBreakerParameters` / `oracle` all revert on spot
  pools (Hideki STT:USDso `0xbe6c45…b35d`, Shannon SOMI:USDso `0x259fD6…FFf4`).
- Book sweep (all two-sided, spread ≈ 1–2 ticks): Hideki STT/WBTC/WETH:USDso; Shannon
  WETH/SOMI/WBTC:USDso; mainnet SOMI/USDC.e/WBTC/WETH:USDso (e.g. mainnet WETH ask 2230.72 / bid
  2230.38; USDC.e 1.0002 / 0.9998).

No live proof-of-drain was run: on every tradeable pool it would fill at ≈ fair (demonstrating the
bound), not a drain; the only pool type where it would drain (empty book) does not currently exist.

## Related but not duplicate

- rohan911438__DreamDex-Findings triaged this exact vector for perps ("a linked bot key trade the
  owner against an attacker at extreme prices — placement has no price band, but fills are bounded by
  `FillPriceOutsideBand` (~8% from mark); exposure limited to what any trade-permission key has;
  **not filed**"). This note reaches the same conclusion and extends it to spot (bounded by liquidity
  rather than a band) and across all three networks.
- hosein-ul__dreamdex-perps-audit `HYP-AUTH-01` (operator calls a MarginBank withdrawal) is the
  *direct* path, which is closed (no `*For` withdrawal). `recon/ATTACK_SURFACE.md`'s "self-trading"
  line is an un-investigated note, not a finding.
- Local `findings/06` (prepared-tx guard not checking order params) is the *client* layer; this is
  the *contract/authorization* layer, and the same band/liquidity bound caps the impact of both.

Checked against the 331 locally-mirrored dreamdex repos under `prior/`; no confirmed duplicate beyond
rohan911438's not-filed triage item.
