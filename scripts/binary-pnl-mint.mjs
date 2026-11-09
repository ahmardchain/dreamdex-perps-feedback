// Offline, no network. Run: node findings/scripts/binary-pnl-mint.mjs
// Same position, two exported SDK PnL engines: mint 100 complete sets (cost 100 USDso),
// sell the 100 NO at YES=0.60 (NO=0.40 -> proceeds 40), keep 100 YES marked at 0.60.
// Truth: paid 100, got 40 + 100*0.60 = 100 back -> total PnL 0.
import { computeBinaryPnl, binaryFillsFor } from "../../sdk-latest/package/dist/units.js";
import { computePositionPnL, pnlEventsFor } from "../../sdk-latest/package/dist/derivedReads.js";
const D = 18, ONE = 10n ** 18n, Q = 100n * ONE, acct = "0x00000000000000000000000000000000000000aa";
const fill = { id: "200_0", maker: acct, makerSide: "SELL_NO", taker: "0x00000000000000000000000000000000000000bb", takerSide: "BUY_NO",
  fillPrice: (6n * ONE / 10n).toString(), quantity: Q.toString() };   // YES-terms price 0.60
const mint = { id: "100_0", account: acct, kind: "MintCompleteSet", amount: Q.toString() };
const market = { quoteDecimals: D, lastPrice: (6n * ONE / 10n).toString(), winningOutcome: null, voided: false, payoutNumerators: null, payoutDenominator: null };
const balances = { yes: Q.toString(), no: "0" };
const a = computeBinaryPnl(binaryFillsFor(acct, [fill], D), balances, market);
const b = computePositionPnL(pnlEventsFor(acct, [fill], [mint]), { balanceYes: Q, balanceNo: 0n }, market, ONE);
const h = (x) => Number(x) / 1e18;
console.log("computeBinaryPnl   (number, fills only): realized", a.realized, " unrealized", a.unrealized, " total", a.total);
console.log("computePositionPnL (bigint, fills+mints): realized", h(b.realizedPnl), " unrealized", h(b.unrealizedPnl), " total", h(b.realizedPnl + b.unrealizedPnl));
