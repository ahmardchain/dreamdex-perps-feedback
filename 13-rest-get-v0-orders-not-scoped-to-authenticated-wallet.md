# REST API: `GET /v0/orders` is not scoped to the authenticated wallet — any logged-in session can read any wallet's orders

**Severity:** minor (API hygiene / access-control scoping; order-book data is largely public on-chain)
**Area:** REST API (`/v0/orders`, `stg.api.dreamdex.io`, Shannon 50312)

## Summary
`GET /v0/orders` requires a SIWE login (401 without one), but once authenticated it does not restrict results to the caller's own wallet. A session logged in as wallet A can request `?walletAddress=<B>` for any B and receive B's orders. The JWT already carries the authenticated wallet (`sub` = wallet = signer), so the endpoint has what it needs to scope the response but does not.

## Steps to reproduce
Read-only. SIWE login with a throwaway wallet, then two GETs. Nothing signed or sent.
1. SIWE: `GET /v0/auth/nonce` → sign → `POST /v0/auth/login` → `Bearer <token>` for wallet A.
2. `GET /v0/orders?walletAddress=<A>` → 200, A's orders (expected).
3. `GET /v0/orders?walletAddress=<B>` with the same A token, B any other address → 200, B's orders.

## Expected
Results scoped to the authenticated wallet, or to wallets it is an authorized operator for; a request for an unrelated `walletAddress` is rejected or returns only public fields.

## Actual
The endpoint returns the requested wallet's orders regardless of which wallet is authenticated.

## Impact
Low. Orders rest on a public on-chain order book, so most of this data is already visible on-chain. The item to confirm is whether the response carries any field that is not public (e.g. raw `userData`); if so, that is a small cross-account read. Otherwise this is an untidy-scoping / hygiene issue, not a data leak.

## Suggested fix
Scope `GET /v0/orders` to the JWT wallet (and any wallets it operates for), or confirm every returned field is public and document the endpoint as public.

## Related but not duplicate
Local finding 10 covers the order *prepare* endpoint accepting a malformed/advisory `walletAddress`; this is the order *read* endpoint not scoping to the session. Different endpoint, same `walletAddress`-trust theme.

## Environment
`stg.api.dreamdex.io` (staging), Somnia Shannon testnet (chain 50312). Throwaway wallet, read-only (SIWE + reads only), 2026-11-06. No transaction signed or sent.
