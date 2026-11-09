// Read-only. Logs BTC-PERP pool oracle state every 2s, printing only transitions.
import { createPublicClient, http, parseAbi } from "../dreamdex-bot-kit/node_modules/viem/_esm/index.js";
const pc = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network", { timeout: 10_000 }) });
const abi = parseAbi(["function getIndexPrice() view returns (uint256, uint256)", "function tryGetMarkPrice() view returns (bool ok, uint256 price)"]);
const POOL = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
let last = "";
const end = Date.now() + Number(process.env.SECS ?? 5400) * 1000;
while (Date.now() < end) {
  let s: string;
  try {
    const bn = await pc.getBlockNumber();
    const [ok] = await pc.readContract({ address: POOL, abi, functionName: "tryGetMarkPrice", blockNumber: bn });
    let idx = "index ok";
    try { await pc.readContract({ address: POOL, abi, functionName: "getIndexPrice", blockNumber: bn }); } catch { idx = "index REVERTS"; }
    s = `mark ${ok ? "ok" : "STALE"}, ${idx}`;
    if (s !== last) console.log(`${new Date().toISOString()} block=${bn} ${s}`);
  } catch (e: any) { s = "rpc error"; if (s !== last) console.log(`${new Date().toISOString()} rpc error ${String(e?.shortMessage ?? e).slice(0, 80)}`); }
  last = s;
  await new Promise((r) => setTimeout(r, 2000));
}
process.exit(0);
