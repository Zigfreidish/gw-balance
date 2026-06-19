import { getAddress, formatUnits } from "ethers";

/**
 * 默认走同源代理 /api/rpc（Next.js 路由转发到 Godwoken RPC），
 * 这样浏览器是同源请求，绕过 RPC 端可能缺失的 CORS。
 * 也可在界面改成任意直连 RPC 地址。
 */
export const DEFAULT_RPC_URL = "/api/rpc";

/** 代理实际转发到的上游 Godwoken v0 RPC（仅用于界面展示）。 */
export const UPSTREAM_RPC_URL = "https://mainnet.godwoken.io/rpc";

/**
 * Godwoken v0 原生 CKB 余额（eth_getBalance 返回值）的小数位。
 * v0 使用 CKB 原生的 8 位精度。
 * 注意：Godwoken v1 的 pCKB 用 18 位，二者不同——切换网络时需相应调整。
 */
export const DEFAULT_DECIMALS = 8;

/** 匹配标准 20 字节以太坊地址（0x + 40 个十六进制字符）。 */
const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

export interface ParseResult {
  /** 去重后的、带 checksum 的有效地址。 */
  addresses: string[];
  /** 被移除的重复地址数量。 */
  duplicates: number;
}

/**
 * 从任意文本中提取有效地址：既支持逗号/换行/空格分隔的粘贴，
 * 也支持直接读入的 CSV 全文（无论地址在第几列）。
 */
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
      // 混合大小写但 checksum 不匹配时，按小写规范化（始终是合法地址）。
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

export interface BalanceRow {
  index: number;
  address: string;
  /** eth_getBalance 原始十六进制返回值。 */
  rawHex: string;
  /** 原始整数（十进制字符串），即未做小数换算的最小单位余额。 */
  raw: string;
  /** 按 decimals 换算后的人类可读余额。 */
  formatted: string;
  status: "ok" | "error";
  error?: string;
}

export interface FetchOptions {
  rpcUrl: string;
  decimals: number;
  /** 并发请求数，默认 8。 */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** 对单个地址发起 eth_getBalance 的原始 JSON-RPC 调用。 */
async function rpcGetBalance(
  rpcUrl: string,
  address: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message ?? "RPC error");
  }
  if (typeof json.result !== "string") {
    throw new Error("RPC 返回格式异常");
  }
  return json.result;
}

/**
 * 用并发池逐地址查询余额。单个地址失败不影响其余地址，
 * 失败信息记录在对应行的 error 字段中。
 */
export async function fetchBalances(
  addresses: string[],
  opts: FetchOptions,
): Promise<BalanceRow[]> {
  const { rpcUrl, decimals, concurrency = 8, signal, onProgress } = opts;
  const results = new Array<BalanceRow>(addresses.length);
  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= addresses.length) return;
      const address = addresses[i];
      try {
        const hex = await rpcGetBalance(rpcUrl, address, signal);
        const value = BigInt(hex);
        results[i] = {
          index: i + 1,
          address,
          rawHex: hex,
          raw: value.toString(),
          formatted: formatUnits(value, decimals),
          status: "ok",
        };
      } catch (e) {
        if (signal?.aborted || (e as Error)?.name === "AbortError") throw e;
        results[i] = {
          index: i + 1,
          address,
          rawHex: "",
          raw: "",
          formatted: "",
          status: "error",
          error: (e as Error)?.message ?? String(e),
        };
      } finally {
        done++;
        onProgress?.(done, addresses.length);
      }
    }
  }

  const pool = Array.from(
    { length: Math.min(Math.max(1, concurrency), addresses.length) },
    () => worker(),
  );
  await Promise.all(pool);
  return results;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** 将结果导出为 CSV 文本（含原始整数值，便于核对小数位）。 */
export function toCsv(rows: BalanceRow[], decimals: number): string {
  const header = [
    "index",
    "address",
    `ckb_balance(decimals=${decimals})`,
    "raw_balance",
    "raw_hex",
    "status",
    "error",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        String(r.index),
        r.address,
        csvCell(r.formatted),
        r.raw,
        r.rawHex,
        r.status,
        csvCell(r.error ?? ""),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}
