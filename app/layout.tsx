import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/layout/TopNav";
import { TickerTape } from "@/components/layout/TickerTape";
import { AutonomyStrip } from "@/components/layout/AutonomyStrip";

export const dynamic = "force-dynamic";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MarketPulse — Stock Research Terminal",
  description: "Bloomberg-style stock research and analysis terminal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <TopNav />
        <AutonomyStrip />
        {/* No separate ticker here on purpose. `SystemPulse` in the chrome already drives the
            autonomous cycle, and it does it better: it waits for two minutes of operator idle,
            enforces a five-minute floor between runs, and stops while the tab is hidden. A
            second timer meant two independent drivers racing the same research queue. */}
        <TickerTape />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-panel px-4 py-2 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>Decision support only. AI output is model-generated research opinion; broker execution is disabled.</span>
          <span className="text-amber">PAPER MODE</span>
        </footer>
      </body>
    </html>
  );
}
