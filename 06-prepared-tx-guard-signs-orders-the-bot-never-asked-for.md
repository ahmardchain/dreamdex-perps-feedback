# bot kit (4e75896): the prepared-transaction guard signs any order on an official pool, so a hostile API response can flip the side, price and size of the bot's order and it is still signed

**Severity:** normal (input-validation / hardening gap — not a drain vulnerability)
**Area:** bot kit (examples: `prepared-tx-guard` in JS, TS and Python)

## Summary

Commit `64ee1bd` / merge `4e75896` ("Sanity-check and simulate prepared transactions in the examples", PR #53) adds a guard so the examples never sign "whatever arrives" from the dreamDEX HTTP API. It checks the function selector, the chain, native value, the builder fee, and that `to` is an official pool.

It never checks that the prepared transaction **is the order the bot asked for**. Side, price, quantity, order type and even which pool are all taken from the API response unchecked. A response that flips the bot's buy to a sell, inflates its size, or points at a different official pool passes every check — it also passes the simulation, because it is a valid trade, and is then signed. This is an input-validation gap: the guard validates the transaction's *shape* (selector, chain, value, builder fee, official pool) but never that it matches the request the bot made.

**Threat model / preconditions:** requires a hostile or compromised API response (the case the guard exists to defend against) plus an attacker-controlled resting order on the same official pool; affects example code in the public kit, not dreamDEX's live servers or contracts.

**Impact is bounded:** the perp circuit band and spot book liquidity cap the worst case — there is no unbounded attacker drain (see `findings/09`) — but a hostile API can still make the bot sign a wrong-side or oversized order within the band, the exact outcome this guard was added to prevent.

## Steps to reproduce

1. Check out `somnia-chain/dreamdex-bot-kit` at `4e75896`.
2. Run the attached offline repro against the kit's own guard (no network, no keys, nothing sent):
   ```sh
   node scripts/guard-binding.mjs <bot-kit>/examples/01-multi-strategy-ai/utils/prepared-tx-guard.js
   python3 -I scripts/guard_accepts_hostile_order.py <bot-kit>/examples/04-python-ops/backend/trading/prepared_tx_guard.py
   ```
   The bot's request is *sell 0.01 WETH, limit 3,000, postOnly* on the WETH/USDso pool. The script feeds `checkPreparedTx` four prepared `placeOrder` calls on that same pool.
3. Read the call sites, e.g. `examples/01-multi-strategy-ai/executor/orders.js:22-46`. The bot builds `{side, price, amount, orderType}`, posts it to `/v0/markets/{symbol}/orders`, then calls `sendPreparedTx({ tx: p, allow: [SELECTORS.placeOrder] })`. The requested values are never passed to the guard. `cachedPoolAddress`, already confirmed by `requireOfficialPool`, is not compared with `p.to` either.

## Expected

A prepared order is signed only if it matches what the bot requested:
- `to` is the requested market's pool
- `isBid` matches the requested side
- `quantity` is the requested size
- `orderType` is the requested type
- `price` is the requested limit, or for a market order within the bot's slippage of the mark

Otherwise it is refused with `PreparedTxRejected`, like the selector and builder checks.

## Actual

All four are accepted:

```
what the bot asked for           -> ACCEPTED (simulated, then signed)
side flipped to BUY              -> ACCEPTED (simulated, then signed)
BUY 300 WETH at 300,000 (100x)   -> ACCEPTED (simulated, then signed)
SELL 300 WETH at 30 (1/100)      -> ACCEPTED (simulated, then signed)
```

The Python copy behaves the same. It also accepts the order on a **different** official pool than the one requested, because `isKnownPool` only asks the registry whether the address is *an* official pool.

**Impact.** Take a wrong, compromised or intercepted API response (the case the guard exists for), plus a resting order the attacker controls on the same pool. The bot's quote balance can be spent buying from the attacker at any price, or its base inventory sold to the attacker at any price. The pool is official, the selector is allowed, no builder fee is named and no native value is sent, so every check passes. The simulation also succeeds, because the trade is valid. The examples approve the pool for up to 1,000,000 USDso (`executor/vault.js`), and vault-funded orders need no approval at all.

The same gap exists for the other allowed calls:
- `deposit(token, amount)`: the token and amount are not compared with the request.
- `depositNative()`: any value is accepted.
- `cancelOrder(orderId)`: any order id can be cancelled.

## Suggested fix

Make the guard take the intent, not only an allow-list:

```js
sendPreparedTx({ walletClient, publicClient, tx: p, expect: {
  selector: SELECTORS.placeOrder, pool: cachedPoolAddress,
  isBid: side === 'buy', quantity: amountRaw, orderType: 3,
  price: priceRaw,                  // exact for limit orders
  // or for market orders: maxPrice / minPrice = mark ± slippage
}})
```

Decode the 9 static words, which the guard already slices for the builder, and compare each one. Do the same for `deposit` (token, amount), `depositNative` (value equals the requested amount) and `cancelOrder` (id is one of the bot's open orders). Add these hostile cases to the shared tests in all three languages.

A price bound for market buys also needs the API to stop preparing them at `floor((2^256-1)/quantity)` (see swiftbotlabs #64). Otherwise a correct guard would refuse every legitimate API market buy.

## Related, not duplicate

- devorun #022 compares how the JS/TS and Python copies **parse** malformed inputs (missing `0x`, `chainId ""`, unparsable `value`). It does not touch whether a well-formed order matches the request.
- swiftbotlabs #64 is about the **API** preparing market buys at a near-infinite price. This report is about the **kit's guard** accepting such prices and any other side, size or type. That near-infinite price is a legitimate API response today which the guard cannot tell apart from a hostile one.

## Evidence

- [`scripts/guard-binding.mjs`](scripts/guard-binding.mjs) and [`scripts/guard_accepts_hostile_order.py`](scripts/guard_accepts_hostile_order.py) (attached). Both load the kit's own guard files and print the result above. Run 2026-11-06 against `4e75896`.
- Full run output, with the kit commit, tool versions and sha256 of every script and guard file: [`evidence/06/guard-run-20261106T014127Z.txt`](evidence/06/guard-run-20261106T014127Z.txt).
- TS copy: `node scripts/guard-binding.mjs <bot-kit>/examples/08-regime-multistrategy/src/prepared-tx-guard.ts` (loaded by Node 24's built-in type stripping) gives the same result as JS. All 4 cases are ACCEPTED, including the flipped side and the 100× / 1/100 orders.
- Selectors in the guard verified against `keccak256` of the SDK ABI signatures (all correct). The bypass is in what is checked, not in the constants.

## Environment

- dreamdex-bot-kit `4e75896` (2026-10-30)
- Node 24.14.0, Python 3.14.7, Windows 11
- Offline: no RPC, API or wallet used
