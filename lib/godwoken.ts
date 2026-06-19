import { getAddress, formatUnits } from "ethers";
import { V0_TOKENS, type TokenDef } from "./tokensV0";

export { V0_TOKENS };
export type { TokenDef };

/**
 * 默认走同源代理 /api/rpc（Next.js 路由转发到 Godwoken RPC），
 * 这样浏览器是同源请求，绕过 RPC 端可能缺失的 CORS。
 * 也可在界面改成任意直连 RPC 地址。
 */
export const DEFAULT_RPC_URL = "/api/rpc";

/** 代理实际转发到的上游 Godwoken v0 RPC（仅用于界面展示）。 */
export const UPSTREAM_RPC_URL = "https://mainnet.godwoken.io/rpc";

/**
 * Godwoken v0 原生 CKB 余额（eth_getBalance 返回值）的小数位 = 8。
 * 注意：Godwoken v1 的 pCKB 用 18 位，二者不同。
 * （ERC20 代币各自有自己的 decimals，见 tokensV0.ts，不受此设置影响。）
 */
export const DEFAULT_DECIMALS = 8;

/** 匹配标准 20 字节以太坊地址（0x + 40 个十六进制字符）。 */
const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

export interface ParseResult {
  addresses: string[];
  duplicates: number;
}

/** 从任意文本（粘贴或 CSV 全文）中提取去重后的有效地址。 */
export function parseAddresses(input: string): ParseResult {
  const matches = input.match(ADDRESS_RE) ?? [];
  const seen = new Set<string>();
  const addresses: string[] = [];
  let duplicates = 0;

  for (const raw of matches) {
    let checksummed: string;
    try {
      checksummed = getAddress(raw);
    } catch {
      checksummed = getAddress(raw.toLowerCase());
    }
    const key = checksummed.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    addresses.push(checksummed);
  }

  return { addresses, duplicates };
}

export interface TokenHolding {
  symbol: string;
  address: string;
  decimals: number;
  raw: string; // 原始整数（最小单位）
  formatted: string; // 按 token.decimals 换算
}

export interface AssetRow {
  index: number;
  address: string;
  /** 原生 CKB 原始整数值。 */
  ckbRaw: string;
  /** 原生 CKB 按 ckbDecimals 换算。 */
  ckb: string;
  status: "ok" | "error"; // 指原生 CKB 查询是否成功
  error?: string;
  /** 余额非零的代币（按 symbol 排序）；未开启代币查询时为空。 */
  tokens: TokenHolding[];
  /** 查询失败的代币数量。 */
  tokenErrors: number;
}

export interface FetchAssetsOptions {
  rpcUrl: string;
  /** 原生 CKB 的小数位（v0 = 8）。 */
  ckbDecimals: number;
  /** 提供且非空时，额外对每个地址逐代币查询 balanceOf。 */
  tokens?: TokenDef[];
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** 单次 JSON-RPC 调用，返回 result 字符串（hex）。 */
async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  if (typeof json.result !== "string") throw new Error("RPC 返回格式异常");
  return json.result;
}

/** ERC20 balanceOf(address) 的 calldata。 */
function balanceOfData(address: string): string {
  return "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
}

/**
 * 查询每个地址的原生 CKB 余额，以及（可选）一组 ERC20 代币的 balanceOf。
 * 所有调用共用一个并发池，进度按"任务数 = 地址数 ×(1 + 代币数)"统计。
 * 原生查询失败标记该行 error；单个代币查询失败仅计入 tokenErrors，不影响其余。
 */
export async function fetchAssets(
  addresses: string[],
  opts: FetchAssetsOptions,
): Promise<AssetRow[]> {
  const { rpcUrl, ckbDecimals, tokens = [], concurrency = 8, signal, onProgress } = opts;

  const rows: AssetRow[] = addresses.map((address, i) => ({
    index: i + 1,
    address,
    ckbRaw: "",
    ckb: "",
    status: "ok",
    tokens: [],
    tokenErrors: 0,
  }));

  // 任务：每个地址一个原生查询 + 每个代币一个 balanceOf。
  type Task = { i: number; token?: TokenDef };
  const tasks: Task[] = [];
  for (let i = 0; i < addresses.length; i++) {
    tasks.push({ i });
    for (const t of tokens) tasks.push({ i, token: t });
  }

  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const k = next++;
      if (k >= tasks.length) return;
      const { i, token } = tasks[k];
      const address = addresses[i];
      try {
        if (!token) {
          const hex = await rpcCall(rpcUrl, "eth_getBalance", [address, "latest"], signal);
          const v = BigInt(hex);
          rows[i].ckbRaw = v.toString();
          rows[i].ckb = formatUnits(v, ckbDecimals);
        } else {
          const hex = await rpcCall(
            rpcUrl,
            "eth_call",
            [{ to: token.address, data: balanceOfData(address) }, "latest"],
            signal,
          );
          const v = hex && hex !== "0x" ? BigInt(hex) : 0n;
          if (v > 0n) {
            rows[i].tokens.push({
              symbol: token.symbol,
              address: token.address,
              decimals: token.decimals,
              raw: v.toString(),
              formatted: formatUnits(v, token.decimals),
            });
          }
        }
      } catch (e) {
        if (signal?.aborted || (e as Error)?.name === "AbortError") throw e;
        if (!token) {
          rows[i].status = "error";
          rows[i].error = (e as Error)?.message ?? String(e);
        } else {
          rows[i].tokenErrors++;
        }
      } finally {
        done++;
        onProgress?.(done, tasks.length);
      }
    }
  }

  const pool = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, tasks.length)) },
    () => worker(),
  );
  await Promise.all(pool);

  for (const r of rows) r.tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return rows;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 导出 CSV。
 * - 不带 tokens：index,address,CKB,ckb_raw,status,error
 * - 带 tokens：index,address,status,CKB,<每个代币 symbol 一列>（无持仓为 0）
 */
export function toCsv(
  rows: AssetRow[],
  ckbDecimals: number,
  tokens?: TokenDef[],
): string {
  if (!tokens || tokens.length === 0) {
    const header = [
      "index",
      "address",
      `CKB(decimals=${ckbDecimals})`,
      "ckb_raw",
      "status",
      "error",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          String(r.index),
          r.address,
          csvCell(r.ckb),
          r.ckbRaw,
          r.status,
          csvCell(r.error ?? ""),
        ].join(","),
      );
    }
    return lines.join("\r\n");
  }

  const header = [
    "index",
    "address",
    "status",
    `CKB(decimals=${ckbDecimals})`,
    ...tokens.map((t) => t.symbol),
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const bySymbol = new Map(r.tokens.map((t) => [t.symbol, t.formatted]));
    lines.push(
      [
        String(r.index),
        r.address,
        r.status,
        csvCell(r.ckb),
        ...tokens.map((t) => csvCell(bySymbol.get(t.symbol) ?? "0")),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}
