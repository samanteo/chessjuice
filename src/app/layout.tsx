import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { StateSyncInit } from "@/components/StateSyncInit";
import "@lichess-org/chessground/assets/chessground.base.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Puzzle Trainer — Chess puzzles with spaced repetition",
  description:
    "Train chess puzzles with spaced repetition (SM-2) for wrong puzzles only. Ratings 1000–2200, all Lichess themes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1b19" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${inter.className} ${inter.variable}`}>
        <StateSyncInit />
        {children}
      </body>
    </html>
  );
}
