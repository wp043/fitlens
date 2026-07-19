import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitLens — Evidence-first product comparison",
  description:
    "Compare similar open-source and closed-source products against your own workflow.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
