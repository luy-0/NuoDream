import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteName = "大傩幻梦";
const siteDescription = "《大傩幻梦》：以贵州傩文化为灵感的互动幻梦体验。";

export const metadata: Metadata = {
  title: siteName,
  applicationName: siteName,
  description: siteDescription,
  openGraph: {
    title: siteName,
    description: siteDescription,
    siteName,
    type: "website"
  },
  twitter: {
    card: "summary",
    title: siteName,
    description: siteDescription
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
