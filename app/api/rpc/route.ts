// 同源 RPC 代理：浏览器把 JSON-RPC POST 到本路由（同源，无 CORS 问题），
// 由服务端转发到 Godwoken RPC。上游地址可用环境变量 GODWOKEN_RPC_URL 覆盖。
const UPSTREAM = process.env.GODWOKEN_RPC_URL || "https://mainnet.godwoken.io/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: string;
  try {
    body = await req.text();
  } catch {
    return Response.json(
      { error: { message: "invalid request body" } },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    // 原样回传上游响应（JSON-RPC 结果或错误），保持状态码。
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return Response.json(
      { error: { message: `proxy upstream failed: ${(e as Error)?.message ?? String(e)}` } },
      { status: 502 },
    );
  }
}
