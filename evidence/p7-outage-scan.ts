// Read-only. Scans back HOURS hours on one pool (all 21 go stale together, see
// p6-zoom.out) every STEP blocks: tryGetMarkPrice ok? getIndexPrice reverts?
// Prints each stale run's first/last sampled block and time.
import { createPublicClient, http, parseAbi } from "../dreamdex-bot-kit/node_modules/viem/_esm/index.js";

const POOL = (process.env.POOL ?? "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0") as `0x${string}`; // BTC-PERP
const HOURS = Number(process.env.HOURS ?? 3);
const STEP = BigInt(process.env.STEP ?? 250);
const pc = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network", { timeout: 20_000, retryCount: 3 }) });
const abi = parseAbi(["function getIndexPrice() view returns (uint256, uint256)", "function tryGetMarkPrice() view returns (bool ok, uint256 price)"]);

const head = await pc.getBlockNumber();
const headTs = Number((await pc.getBlock({ blockNumber: head })).timestamp);
const from = head - BigInt(Math.round(HOURS * 3600 * 10)); // ~10 blocks/s measured in p6
const blocks: bigint[] = [];
for (let b = from; b <= head; b += STEP) blocks.push(b);
const res: { b: bigint; stale: boolean }[] = [];
for (let i = 0; i < blocks.length; i += 25) {
  await Promise.all(blocks.slice(i, i + 25).map(async (b) => {
    let stale = false;
    try { const [ok] = await pc.readContract({ address: POOL, abi, functionName: "tryGetMarkPrice", blockNumber: b }); stale = !ok; } catch { stale = true; }
    if (!stale) { try { await pc.readContract({ address: POOL, abi, functionName: "getIndexPrice", blockNumber: b }); } catch { stale = true; } }
    res.push({ b, stale });
  }));
}
res.sort((x, y) => (x.b < y.b ? -1 : 1));
const ts = async (b: bigint) => new Date(Number((await pc.getBlock({ blockNumber: b })).timestamp) * 1000).toISOString();
console.log(`head ${head} (${new Date(headTs * 1000).toISOString()}), scanned ${res.length} samples over ${HOURS}h, step ${STEP} blocks`);
let runStart: bigint | undefined; let prev: bigint | undefined; let runs = 0; let staleSamples = 0;
for (const r of res) {
  if (r.stale) { staleSamples++; if (runStart === undefined) runStart = r.b; prev = r.b; }
  else if (runStart !== undefined) { runs++; console.log(`stale run: blocks ${runStart}..${prev} ${await ts(runStart)} .. ${await ts(prev!)}`); runStart = undefined; }
}
if (runStart !== undefined) { runs++; console.log(`stale run (ongoing at head): ${runStart}..${prev}`); }
console.log(`stale runs=${runs}, stale samples=${staleSamples}/${res.length}`);
process.exit(0);
