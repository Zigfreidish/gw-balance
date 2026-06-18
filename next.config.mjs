/** @type {import('next').NextConfig} */
const nextConfig = {
  // 纯静态导出：`next build` 会生成 out/，可直接静态托管（无后端）。
  // 浏览器端直连 Godwoken RPC，不依赖服务器。
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  // 部署到子路径（如 GitHub Pages 项目页 /gw-balance）时，设置环境变量
  // NEXT_PUBLIC_BASE_PATH=/gw-balance 后再 build。
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
};

export default nextConfig;
