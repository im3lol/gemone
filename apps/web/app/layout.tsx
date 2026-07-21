import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "GemOne — Earn Rewards. Your Way.",
  description:
    "Complete offers, play games, take surveys and earn real rewards with GemOne.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} h-full`}>
      <body className="min-h-full font-sans antialiased text-slate-900">
        {children}
      </body>
    </html>
  );
}
