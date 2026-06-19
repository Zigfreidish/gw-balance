# gw-balance

批量查询 [Godwoken](https://github.com/godwokenrises/godwoken) **v0** 主网上一组地址的**原生 CKB 余额**。

- 粘贴逗号 / 空格 / 换行分隔的地址，或上传 CSV / TXT 文件
- 逐地址查询，结果以表格展示，可导出 CSV
- 通过**同源代理 `/api/rpc`** 访问 Godwoken 的 eth 兼容 RPC，浏览器是同源请求，**绕过 CORS**

默认上游 RPC：`https://mainnet.godwoken.io/rpc`（Godwoken v0 主网，eth 兼容），可用环境变量 `GODWOKEN_RPC_URL` 覆盖。

## 开发

```bash
npm install
npm run dev      # http://localhost:3000
```

## 部署（Vercel）

直接把仓库连到 Vercel，推送到默认分支即自动部署。本项目包含一个服务端路由
`app/api/rpc/route.ts`（serverless function），因此**不是纯静态站点**——它需要能运行
Next.js 服务端的环境（Vercel 原生支持）。

可选环境变量：

| 变量 | 说明 | 默认 |
| :-- | :-- | :-- |
| `GODWOKEN_RPC_URL` | 代理转发到的上游 RPC | `https://mainnet.godwoken.io/rpc` |

## 工作原理

浏览器 → `POST /api/rpc`（同源）→ 服务端转发到 Godwoken RPC → 原样回传。
因为浏览器只和自己的域名通信，所以不受 RPC 端 CORS 策略影响。界面里也可把 RPC
地址改成任意直连地址（届时是否成功取决于该端点的 CORS）。

## 实现说明与注意事项

- **只查原生 CKB 余额。** 调用 `eth_getBalance(address, "latest")`。Godwoken v0
  的 RPC 没有“枚举某地址全部代币”的方法，因此本工具不查 ERC20 (sUDT) 代币。
  若以后要加，需要提供固定的代币合约清单并逐个 `balanceOf`，或接入 GwScan 索引 API。

- **小数位。** 界面与 CSV 始终保留 `eth_getBalance` 的原始整数值（`raw_balance` /
  `raw_hex`）。换算成 CKB 时使用的小数位默认 **8**（Godwoken v0 的原生 CKB 精度；
  注意 Godwoken v1 的 pCKB 用 18 位，二者不同）。可用一个已知地址在
  [GwScan](https://www.gwscan.com) 上核对——原始整数值不受小数位设置影响，可作为基准。

- **地址格式。** 仅识别标准 20 字节以太坊地址（`0x` + 40 个十六进制字符），
  自动去重；CSV 中地址在哪一列都可被提取。

## 技术栈

Next.js (App Router) · TypeScript · ethers v6（地址校验与单位换算）。
余额查询从浏览器 `fetch` 同源 `/api/rpc`，由服务端转发 JSON-RPC，便于控制并发与错误处理。
