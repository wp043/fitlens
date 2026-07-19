import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitLens — 选适合你的，不只是参数更多的",
  description:
    "Evidence-first product comparison for open-source and closed-source tools.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
