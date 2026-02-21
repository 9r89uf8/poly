import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "./convex-client-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Oracle Terminal",
  description: "KORD oracle-aligned temperature terminal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="site-shell">
          <header className="site-header">
            <div>
              <p className="site-eyebrow">Oracle Terminal</p>
              <h1 className="site-title">KORD Temperature Markets</h1>
            </div>
            <nav className="site-nav" aria-label="Primary">
              <Link href="/">Dashboard</Link>
              <Link href="/history">History</Link>
              <Link href="/automation">Automation</Link>
              <Link href="/calls">Calls</Link>
              <Link href="/market">Market</Link>
              <Link href="/observations">Observations</Link>
              <Link href="/alerts">Alerts</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/health">Health</Link>
              <Link href="/calibration">Calibration</Link>
            </nav>
          </header>
          <main className="site-main">
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </main>
        </div>
      </body>
    </html>
  );
}
