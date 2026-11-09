# REST API: `POST /v0/markets/{symbol}/orders` prepares an order for an unbounded `amount` and for a malformed `walletAddress` — the server returns a ready-to-sign transaction (and a matching token approval) that can only fail on-chain, instead of rejecting obviously-invalid input

**Severity:** minor (input validation / hardening)
**Area:** REST API — order/vault *prepare* endpoints (`stg.api.dreamdex.io`, Shannon 50312)

## Summary

The order-prepare endpoint validates most inputs well (zero amount → `invalid_amount`, non-numeric/
negative price → schema `400`, non-tick price → `invalid_price`, unknown symbol → `market_not_found`,
bad `side`/`fundingSource` → `400`). Two inputs slip through unchecked:

1. **`amount` has no upper bound.** An order for `1_000_000_000_000_000_000_000_000_000_000`
   (1e30) units returns `200` with a ready-to-sign `placeOrder` and an `approval` block for the same
   1e30 tokens.
2. **`walletAddress` is not validated as an address.** A malformed value (`0xZZ`) returns `200` and
   a prepared order; the server neither rejects it nor echoes an error.

Neither is a fund-loss bug — the prepared `placeOrder` calldata is caller-scoped (no owner field; it
binds to whoever signs), and a 1e30 order reverts on-chain for lack of balance. But the API's job
here is to hand a bot a transaction worth signing; returning a guaranteed-to-revert order, plus an
unbounded ERC-20 approval suggestion, is the opposite of the other validations it already performs,
and the silent acceptance of a malformed address is a missing check.

## Steps to reproduce

Read-only: SIWE login with a throwaway wallet, then POST prepare bodies. Nothing is signed or sent.

```
# 1. SIWE: GET /v0/auth/nonce → sign the message → POST /v0/auth/login → Bearer <token>
# 2. Unbounded amount:
POST /v0/markets/WETH:USDso/orders
  {"type":"limit","side":"buy","price":"1","amount":"1000000000000000000000000000000",
   "walletAddress":"<A>","fundingSource":"wallet","orderType":"postOnly"}
# 3. Malformed walletAddress:
POST /v0/markets/WETH:USDso/orders
  {"type":"limit","side":"buy","price":"1","amount":"1","walletAddress":"0xZZ",
   "fundingSource":"wallet","orderType":"postOnly"}
```

## Expected

Both rejected with `400` and a clear error, consistent with the endpoint's existing validation
(`invalid_amount`, `invalid_price`, …):
- an `amount` beyond a sane ceiling (or above the wallet/vault balance the prepare already reads) →
  rejected, and the `approval` never sized to an absurd figure;
- a `walletAddress` that is not a well-formed 20-byte address → rejected.

## Actual

- 1e30 amount → `200` with `{ to, data (0x4e978373 placeOrder…), value, approval:{amount:
  "1000000000000000000000000000000", token: USDso} }`.
- `walletAddress: "0xZZ"` → `200` with a prepared `placeOrder` (`approval.amount:"1"`); the malformed
  address is silently accepted.

For contrast, the same endpoint correctly rejects: `amount:"0"` → `invalid_amount`; `amount:"-5"`,
`price:"abc"`, `price:"-1"`, `side:"sideways"`, `fundingSource:"moon"` → schema `400`;
`price:"2230.12345"` → `invalid_price` (tick 0.01); symbol `ZZZ:ZZZ` → `market_not_found`.

## Evidence

Checked 2026-11-06 against `https://stg.api.dreamdex.io` (Shannon 50312) with a throwaway wallet;
gasless SIWE + prepare calls only; **no transaction signed or sent**. Decimals/scaling in the
prepared calldata were verified correct in the same session (WETH 18-dec: qty `0.01`→`1e16`, price
`2230`→`2230e18`; WBTC 8-dec: qty `0.001`→`1e5`, price `75000`→`75000e18`), so this is specifically
about missing bounds on `amount` and format validation on `walletAddress`, not a scaling bug.

## Suggested fix

- Bound `amount` server-side (reject above a configurable ceiling, or above the wallet/vault balance
  the prepare already queries) so the API never hands back a guaranteed-revert order or an absurd
  `approval` figure.
- Validate `walletAddress` is a well-formed address before use; reject otherwise. (Ideally also
  require it to equal the authenticated SIWE wallet or an address that wallet is an authorized
  operator for — the prepare currently treats it as advisory; see the private scoping note.)

## Related but not duplicate

- swiftbotlabs **#64 / #65** concern *price* on market orders (near-infinite limit price; ignored
  `slippageBps`) — a different field and class; this is about `amount` bounds and `walletAddress`
  format on limit-order prepare.
- Local **finding 06** is the *client* guard not checking the prepared order matches the request;
  this is the *server* not rejecting invalid request input in the first place.
- The `walletAddress` acceptance here is consistent with the REST reads being SIWE-token-scoped (the
  param looks advisory/ignored), i.e. not an IDOR — see the private scoping note in
  `findings/security/STATUS.md`. No auth bypass is claimed.

Checked against the 331 locally-mirrored dreamdex repos under `prior/` and a fresh GitHub repo search
(332 repos; mirror current); no duplicate found.

## Environment

`stg.api.dreamdex.io` (staging), Somnia Shannon testnet (chain 50312), dreamDEX REST `/v0`. Throwaway
wallet, read-only (SIWE + prepare only). 2026-11-06.
