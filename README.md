# gw-balance

批量查询 [Godwoken](https://github.com/godwokenrises/godwoken) **v0** 主网上一组地址的**原生 CKB 余额**。

- 粘贴逗号 / 空格 / 换行分隔的地址，或上传 CSV / TXT 文件
- 逐地址查询，结果以表格展示，可导出 CSV
- 纯前端：浏览器直接调用 Godwoken 的 eth 兼容 RPC，无需后端

默认 RPC：`https://mainnet.godwoken.io/rpc`（Godwoken v0 主网，eth 兼容）。

## 开发

```bash
npm install
npm run dev      # http://localhost:3000
```

## 构建（静态导出）

```bash
npm run build    # 产物在 out/，可直接静态托管
```

部署到子路径（如 GitHub Pages 项目页 `/gw-balance`）时：

```bash
NEXT_PUBLIC_BASE_PATH=/gw-balance npm run build
```

## 实现说明与注意事项

- **只查原生 CKB 余额。** 调用 `eth_getBalance(address, "latest")`。Godwoken v0
  的 RPC 没有"枚举某地址全部代币"的方法，因此本工具不查 ERC20 (sUDT) 代币。
  若以后要加，需要提供固定的代币合约清单并逐个 `balanceOf`，或接入 GwScan 索引 API。

- **小数位。** 界面与 CSV 始终保留 `eth_getBalance` 的原始整数值（`raw_balance` /
  `raw_hex`）。换算成 CKB 时使用的小数位默认 **18**（Godwoken Web3 常见约定）。
  若换算结果明显偏大/偏小，请在界面改为 **8**，并用一个已知地址在
  [GwScan](https://www.gwscan.com) 上核对——原始整数值不受小数位设置影响，可作为基准。

- **CORS。** 浏览器直连依赖 RPC 服务端允许跨域。若浏览器控制台报 CORS 错误，
  说明该端点未放行跨域请求，需要自建一个转发代理（本项目当前不含后端）。

- **地址格式。** 仅识别标准 20 字节以太坊地址（`0x` + 40 个十六进制字符），
  自动去重；CSV 中地址在哪一列都可被提取。

## 技术栈

Next.js (App Router, 静态导出) · TypeScript · ethers v6（地址校验与单位换算）。
余额查询使用原生 `fetch` 直接发送 JSON-RPC，便于控制并发与错误处理。
