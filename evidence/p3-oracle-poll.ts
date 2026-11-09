// Read-only. Every POLL_S seconds for ROUNDS rounds:
//   - eth_call getIndexPrice() on every perp pool, record which revert and with what selector
//   - call the SDK's fetchPositions() (no refs, exactly as positionIn() does) for ACCOUNT
// Shows whether one market's oracle revert makes fetchPositions throw for an
// account that holds nothing on that market.
import { createPublicClient, http, parseAbi } from "../dreamdex-bot-kit/node_modules/viem/_esm/index.js";
import { createExchange, perpMarkets, shutdown } from "../dreamdex-bot-kit/packages/perp-core/src/index.ts";

const ROUNDS = Number(process.env.ROUNDS ?? 30);
const POLL_S = Number(process.env.POLL_S ?? 10);
const ACCOUNT = process.env.OWNER_ADDRESS!;
const pc = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network") });
const abi = parseAbi(["function getIndexPrice() view returns (uint256 price, uint256 updatedAt)", "function tryGetMarkPrice() view returns (bool ok, uint256 price)"]);

const ctx = createExchange();
const markets = await perpMarkets(ctx.exchange, true, { includeHalted: true });
const held = (await ctx.exchange.fetchPositions().catch(() => [])).map((p) => `${p.symbol}:${p.side}:${p.contracts}`);
console.log(`${new Date().toISOString()} account=${ACCOUNT} positions at start=${JSON.stringify(held)}`);

for (let r = 0; r < ROUNDS; r++) {
  const t = new Date().toISOString();
  const bn = await pc.getBlockNumber();
  const reverts: string[] = [];
  await Promise.all(markets.map(async (m) => {
    try {
      const [, at] = await pc.readContract({ address: m.info.poolAddress, abi, functionName: "getIndexPrice", blockNumber: bn });
      void at;
    } catch (e: any) {
      const data = (e?.cause?.data ?? e?.cause?.cause?.data ?? e?.walk?.((x: any) => x?.data)?.data ?? "") as string;
      const sig = typeof data === "string" ? data.slice(0, 10) : JSON.stringify(data).slice(0, 12);
      reverts.push(`${m.display}(${sig || e.shortMessage?.slice(0, 40)})`);
    }
  }));
  let fp: string;
  try {
    const ps = await ctx.exchange.fetchPositions();
    fp = `ok ${ps.length} positions`;
  } catch (e: any) {
    fp = `THREW ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`;
  }
  console.log(`${t} block=${bn} indexReverts=[${reverts.join(",")}] fetchPositions: ${fp}`);
  await new Promise((res) => setTimeout(res, POLL_S * 1000));
}
await shutdown(ctx, 500);
process.exit(0);
