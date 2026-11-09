// Read-only. Replays getIndexPrice() on every perp pool at historical blocks
// (FROM..TO step STEP) to find when and where the index oracle reverted, and
// with which selector. Then confirms fetchPositions() itself fails at such a block
// by replaying the SDK's own getPerpState legs for an unrelated pool.
import { createPublicClient, http, parseAbi, BaseError, ContractFunctionRevertedError } from "../dreamdex-bot-kit/node_modules/viem/_esm/index.js";
import { createExchange, perpMarkets, shutdown } from "../dreamdex-bot-kit/packages/perp-core/src/index.ts";

const FROM = BigInt(process.env.FROM!);
const TO = BigInt(process.env.TO!);
const STEP = BigInt(process.env.STEP ?? 200);
const pc = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network", { timeout: 20_000, retryCount: 2 }) });
const abi = parseAbi(["function getIndexPrice() view returns (uint256 price, uint256 updatedAt)", "function tryGetMarkPrice() view returns (bool ok, uint256 price)"]);
const ctx = createExchange();
const markets = await perpMarkets(ctx.exchange, true, { includeHalted: true });

function sigOf(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const raw = (r as any)?.raw ?? (r as any)?.data ?? "";
    if (raw) return String(raw).slice(0, 10);
    return e.shortMessage.slice(0, 50);
  }
  return String(e).slice(0, 50);
}

for (let b = FROM; b <= TO; b += STEP) {
  const out: string[] = [];
  await Promise.all(markets.map(async (m) => {
    try { await pc.readContract({ address: m.info.poolAddress, abi, functionName: "getIndexPrice", blockNumber: b }); }
    catch (e) { out.push(`${m.display}:${sigOf(e)}`); }
  }));
  let markOk = 0; await Promise.all(markets.map(async (m) => { try { const [ok] = await pc.readContract({ address: m.info.poolAddress, abi, functionName: "tryGetMarkPrice", blockNumber: b }); if (ok) markOk++; } catch {} }));
  out.push(`markOk=${markOk}/${markets.length}`);
  const blk = await pc.getBlock({ blockNumber: b }).catch(() => undefined);
  const ts = blk ? new Date(Number(blk.timestamp) * (blk.timestamp > 10_000_000_000n ? 1 : 1000)).toISOString() : "?";
  console.log(`block ${b} ${ts} reverts=${out.length - 1} ${out.join(" ")}`);
}
await shutdown(ctx, 300);
process.exit(0);
