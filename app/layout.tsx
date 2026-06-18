import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Godwoken v0 余额查询",
  description: "批量查询 Godwoken v0 地址上的原生 CKB 余额，支持 CSV 导出。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
