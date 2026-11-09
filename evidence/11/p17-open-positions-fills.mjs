// Read-only: accounts whose open binary positions span markets with > 1000 own fills in total
// (the cap getOpenPositionsWithPnL applies to its ONE account-wide fills read).
const G = process.argv[2] ?? "https://dev.smk.somnia.host/v1/graphql";
const gql = async (query, variables = {}) => { const r = await fetch(G, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) }); const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data; };
const byAcct = new Map();
for (let off = 0; off < 40000; off += 5000) {
  const d = await gql(`query($o:Int!){ OutcomeBalance(where:{balance:{_gt:"0"}}, limit:5000, offset:$o, order_by:{id:asc}){ account market { id } } }`, { o: off });
  for (const r of d.OutcomeBalance) { const s = byAcct.get(r.account) ?? new Set(); s.add(r.market.id); byAcct.set(r.account, s); }
  if (d.OutcomeBalance.length < 5000) break;
}
const top = [...byAcct.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const out = [];
for (const [acct, mk] of top) {
  const ids = [...mk];
  const f = await gql(`query($a:String!,$m:[String!]!){ Fill(where:{_and:[{market_id:{_in:$m}},{_or:[{maker:{_eq:$a}},{taker:{_eq:$a}}]}]}, limit:3000){ id } }`, { a: acct, m: ids });
  const ra = await gql(`query($a:String!,$m:[String!]!){ RouterActionRecord(where:{account:{_eq:$a}, market_id:{_in:$m}}, limit:3000){ id } }`, { a: acct, m: ids });
  out.push({ account: acct, openMarkets: ids.length, fillsInOpenMarkets: f.Fill.length, routerActionsInOpenMarkets: ra.RouterActionRecord.length });
}
console.log(JSON.stringify({ indexer: G, accountsWithOpenPositions: byAcct.size, top: out }, null, 1));
