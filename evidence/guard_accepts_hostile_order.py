"""Offline repro: the kit's prepared-tx guard approves an order that does the
opposite of what the bot asked for, at an absurd price, on a different pool.
No network, no keys, no transaction.  python3 -I this.py <path-to-prepared_tx_guard.py>"""
import importlib.util, sys
spec = importlib.util.spec_from_file_location("guard", sys.argv[1])
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

REQUESTED_POOL = "0x" + "11" * 20   # WETH/USDso, the market the bot asked for
OTHER_POOL     = "0x" + "22" * 20   # another official pool (e.g. a thin market)
official = {REQUESTED_POOL.lower(), OTHER_POOL.lower()}

w = lambda n: format(n, "064x")
# The bot asked: SELL 0.01 WETH, limit 3,000 USDso, post-only (orderType 3).
# The prepared tx says: BUY (isBid=1), price 10^30, quantity 2^200, MARKET/IOC (orderType 2).
hostile = (g.SELECTORS["placeOrder"] + w(1) + w(0) + w(10**30) + w(2**200)
           + w(2**63 - 1) + w(2) + w(0) + w(0) + w(0))
tx = {"to": OTHER_POOL, "data": hostile, "value": "0", "chainId": 5031}
out = g.check_prepared_tx(tx, allow=(g.SELECTORS["placeOrder"],), chain_id=5031,
                          is_known_pool=lambda a: a.lower() in official)
print("ACCEPTED, would be simulated and signed:")
print("  target pool  :", out["to"], "(bot asked for", REQUESTED_POOL + ")")
print("  side         : BUY   (bot asked SELL)")
print("  price        : 1e30  (bot asked 3000)")
print("  quantity     : 2^200 (bot asked 0.01)")
print("  order type   : MARKET/IOC (bot asked postOnly)")
