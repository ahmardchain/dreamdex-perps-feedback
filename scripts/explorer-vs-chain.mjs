// Read-only: compare what the explorer's API says about transactions with what the chain's own RPC says.
// No key, no transaction. Every field compared is a plain fact of the receipt, the transaction or its block.
//   node explorer-vs-chain.mjs <explorer base, e.g. https://explorer.testnet.somnia.network/tokyo> <rpc url> <txhash>...
const [EXP, RPC, ...hashes] = process.argv.slice(2);

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
async function api(path) {
  const r = await fetch(EXP + path, { headers: { accept: 'application/json' } });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}
const lc = (s) => (s == null ? s : String(s).toLowerCase());
const big = (x) => (x == null ? null : BigInt(x).toString());

let mismatches = 0;
for (const hash of hashes) {
  const [tx, rc] = await Promise.all([rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
  if (!tx || !rc) { console.log(`${hash}: not on chain at ${RPC}`); continue; }
  const blk = await rpc('eth_getBlockByNumber', [rc.blockNumber, false]);
  const e = await api(`/api/v2/transactions/${hash}`);
  if (e.status !== 200) { console.log(`${hash}: explorer ${e.status} ${String(e.body).slice(0, 120)}`); mismatches++; continue; }
  const t = e.body;
  const lg = await api(`/api/v2/transactions/${hash}/logs`);
  const elogs = lg.status === 200 ? lg.body.items ?? [] : [];

  const chainFee = BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice ?? tx.gasPrice);
  const pairs = [
    ['status', rc.status === '0x1' ? 'ok' : 'error', t.status],
    ['block', parseInt(rc.blockNumber, 16), t.block_number],
    ['blockHash', lc(rc.blockHash), lc(t.block_hash)],
    ['timestamp', new Date(parseInt(blk.timestamp, 16) * 1000).toISOString().slice(0, 19), String(t.timestamp).slice(0, 19)],
    ['position', parseInt(rc.transactionIndex, 16), t.position],
    ['from', lc(tx.from), lc(t.from?.hash)],
    ['to', lc(tx.to), lc(t.to?.hash)],
    ['nonce', parseInt(tx.nonce, 16), t.nonce],
    ['value', big(tx.value), big(t.value)],
    ['type', parseInt(tx.type, 16), t.type],
    ['gasLimit', big(tx.gas), big(t.gas_limit)],
    ['gasUsed', big(rc.gasUsed), big(t.gas_used)],
    ['gasPrice', big(rc.effectiveGasPrice ?? tx.gasPrice), big(t.gas_price)],
    ['fee', chainFee.toString(), big(t.fee?.value)],
    ['input', lc(tx.input), lc(t.raw_input)],
    ['logs', rc.logs.length, elogs.length + (lg.body?.next_page_params ? '+' : '')],
  ];
  const bad = pairs.filter(([, a, b]) => String(a) !== String(b));
  // Per-log: address, topics, data and index must match the receipt's.
  const byIdx = new Map(elogs.map((l) => [l.index, l]));
  for (const l of rc.logs) {
    const x = byIdx.get(parseInt(l.logIndex, 16));
    const want = [lc(l.address), ...l.topics.map(lc), lc(l.data)].join('|');
    const got = x ? [lc(x.address?.hash), ...(x.topics ?? []).filter(Boolean).map(lc), lc(x.data)].join('|') : 'missing';
    if (want !== got) bad.push([`log#${parseInt(l.logIndex, 16)}`, want.slice(0, 90), got.slice(0, 90)]);
  }
  mismatches += bad.length;
  console.log(`${hash} block ${parseInt(rc.blockNumber, 16)} logs ${rc.logs.length}: ${bad.length ? 'MISMATCH' : 'all fields match'}`);
  for (const [k, a, b] of bad) console.log(`    ${k.padEnd(10)} chain=${a}\n    ${''.padEnd(10)} explr=${b}`);
}
console.log(`\n${hashes.length} tx checked, ${mismatches} mismatching field(s)`);
