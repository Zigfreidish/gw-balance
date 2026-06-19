"use client";

import { useMemo, useRef, useState } from "react";
import { formatUnits } from "ethers";
import {
  DEFAULT_RPC_URL,
  UPSTREAM_RPC_URL,
  DEFAULT_DECIMALS,
  V0_TOKENS,
  parseAddresses,
  fetchAssets,
  toCsv,
  type AssetRow,
} from "@/lib/godwoken";

export default function Home() {
  const [input, setInput] = useState("");
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC_URL);
  const [decimals, setDecimals] = useState(DEFAULT_DECIMALS);
  const [concurrency, setConcurrency] = useState(8);
  const [withTokens, setWithTokens] = useState(false);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [queriedWithTokens, setQueriedWithTokens] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const parsed = useMemo(() => parseAddresses(input), [input]);

  const summary = useMemo(() => {
    const ok = rows.filter((r) => r.status === "ok");
    let total = 0n;
    for (const r of ok) {
      try {
        total += BigInt(r.ckbRaw || "0");
      } catch {
        /* ignore */
      }
    }
    const tokenErrors = rows.reduce((s, r) => s + r.tokenErrors, 0);
    return { ok: ok.length, failed: rows.length - ok.length, totalRaw: total, tokenErrors };
  }, [rows]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setInput((prev) => (prev.trim() ? prev + "\n" : "") + text);
    setFileNames((prev) => [...prev, file.name]);
    e.target.value = "";
  }

  async function handleQuery() {
    setError(null);
    if (parsed.addresses.length === 0) {
      setError("没有解析到有效地址。请粘贴逗号/换行分隔的地址，或上传 CSV。");
      return;
    }
    if (!rpcUrl.trim()) {
      setError("RPC 地址不能为空。");
      return;
    }
    setLoading(true);
    setRows([]);
    const useTokens = withTokens;
    setQueriedWithTokens(useTokens);
    const perAddr = 1 + (useTokens ? V0_TOKENS.length : 0);
    setProgress({ done: 0, total: parsed.addresses.length * perAddr });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await fetchAssets(parsed.addresses, {
        rpcUrl: rpcUrl.trim(),
        ckbDecimals: decimals,
        tokens: useTokens ? V0_TOKENS : undefined,
        concurrency,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setRows(result);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setError("查询已取消。");
      } else {
        setError((e as Error)?.message ?? String(e));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  function handleExport() {
    const csv = toCsv(rows, decimals, queriedWithTokens ? V0_TOKENS : undefined);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `gw-v0-balances-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const totalFormatted = formatUnits(summary.totalRaw, decimals);
  const cols = queriedWithTokens ? 6 : 5;

  return (
    <main>
      <h1>Godwoken v0 余额查询</h1>
      <p className="subtitle">
        批量查询 Godwoken v0 地址上的原生 CKB 余额（可选 {V0_TOKENS.length} 种 ERC20 代币）。纯前端，浏览器经同源代理直连 RPC。
      </p>

      <div className="note">
        <strong>关于小数位：</strong>
        界面与 CSV 始终保留 <code>eth_getBalance</code> 的原始整数值。原生 CKB 换算默认{" "}
        <strong>8</strong> 位（Godwoken v0；v1 的 pCKB 用 18 位）。ERC20 代币各自带自己的
        decimals（来自官方 ERC20TokenList）。可在{" "}
        <a href="https://www.gwscan.com" target="_blank" rel="noreferrer">
          GwScan
        </a>{" "}
        上核对。
      </div>

      <div className="card">
        <label htmlFor="addr-input">地址列表（逗号 / 空格 / 换行分隔，或上传 CSV）</label>
        <textarea
          id="addr-input"
          placeholder="0xabc...123, 0xdef...456&#10;0x789...0ab"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="toolbar">
          <label className="file-label">
            上传 CSV / TXT
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={handleFile}
            />
          </label>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              setInput("");
              setFileNames([]);
            }}
            disabled={!input}
          >
            清空
          </button>
          <div className="parse-status">
            已识别 <b>{parsed.addresses.length}</b> 个有效地址
            {parsed.duplicates > 0 && <>（已去重 {parsed.duplicates} 个）</>}
            {fileNames.length > 0 && (
              <span className="muted"> · 文件：{fileNames.join("、")}</span>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="rpc">RPC 地址</label>
            <input
              id="rpc"
              type="text"
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
            />
            <div className="hint">
              默认 <code>/api/rpc</code> 同源代理（绕过 CORS）；也可改为任意直连 RPC。
            </div>
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="decimals">CKB 小数位</label>
            <input
              id="decimals"
              type="number"
              min={0}
              max={36}
              value={decimals}
              onChange={(e) => setDecimals(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="concurrency">并发数</label>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={50}
              value={concurrency}
              onChange={(e) =>
                setConcurrency(Math.min(50, Math.max(1, Number(e.target.value) || 1)))
              }
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, marginBottom: 0 }}
          >
            <input
              type="checkbox"
              checked={withTokens}
              onChange={(e) => setWithTokens(e.target.checked)}
            />
            同时查询 ERC20 代币余额（{V0_TOKENS.length} 种 sUDT 代理 · 每地址额外 {V0_TOKENS.length} 次 balanceOf 调用）
          </label>
        </div>

        <div className="toolbar">
          <button
            className="btn-primary"
            type="button"
            onClick={handleQuery}
            disabled={loading || parsed.addresses.length === 0}
          >
            {loading
              ? "查询中…"
              : `查询余额（${parsed.addresses.length} 地址${withTokens ? ` · +${V0_TOKENS.length} 代币` : ""}）`}
          </button>
          {loading && (
            <button className="btn-secondary" type="button" onClick={handleAbort}>
              取消
            </button>
          )}
          {loading && (
            <div className="progress" style={{ minWidth: 220 }}>
              {progress.done} / {progress.total}（{pct}%）
              <div className="bar">
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <div className="spacer" />
          <button
            className="btn-secondary"
            type="button"
            onClick={handleExport}
            disabled={rows.length === 0}
          >
            导出 CSV
          </button>
        </div>
        {error && <div className="error-msg">{error}</div>}
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div className="summary">
            <span>
              成功 <span className="num">{summary.ok}</span>
            </span>
            {summary.failed > 0 && (
              <span>
                失败 <span className="num" style={{ color: "var(--err)" }}>
                  {summary.failed}
                </span>
              </span>
            )}
            {queriedWithTokens && summary.tokenErrors > 0 && (
              <span className="muted">代币查询失败 {summary.tokenErrors} 次</span>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th className="mono">地址</th>
                  <th className="num">CKB 余额</th>
                  <th className="num">原始值</th>
                  {queriedWithTokens && <th>代币持仓（非零）</th>}
                  <th style={{ width: 80 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.address}>
                    <td className="muted">{r.index}</td>
                    <td className="mono">{r.address}</td>
                    <td className="num">{r.status === "ok" ? r.ckb : "—"}</td>
                    <td className="num muted">{r.status === "ok" ? r.ckbRaw : "—"}</td>
                    {queriedWithTokens && (
                      <td>
                        {r.tokens.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <div className="holdings">
                            {r.tokens.map((t) => (
                              <span className="tok" key={t.symbol}>
                                {t.symbol} <b>{t.formatted}</b>
                              </span>
                            ))}
                          </div>
                        )}
                        {r.tokenErrors > 0 && (
                          <span className="muted" style={{ fontSize: 11 }}>
                            {" "}
                            ({r.tokenErrors} 失败)
                          </span>
                        )}
                      </td>
                    )}
                    <td>
                      {r.status === "ok" ? (
                        <span className="badge ok">OK</span>
                      ) : (
                        <span className="badge error" title={r.error}>
                          失败
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td></td>
                  <td className="muted">合计（{summary.ok} 个成功地址）</td>
                  <td className="num">
                    <b>{totalFormatted}</b>
                  </td>
                  <td className="num muted">{summary.totalRaw.toString()}</td>
                  {queriedWithTokens && (
                    <td className="muted" style={{ fontSize: 12 }}>
                      各代币合计见导出 CSV
                    </td>
                  )}
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <footer>
        Godwoken v0 · {DEFAULT_RPC_URL} 代理 → {UPSTREAM_RPC_URL} · 原生 CKB + {V0_TOKENS.length} 种 ERC20
      </footer>
    </main>
  );
}
