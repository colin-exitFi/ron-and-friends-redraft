import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { LEAGUE } from "@/lib/league-config";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/*
 * The design's three faces. Inter carries the whole UI; the other two are used
 * narrowly — Space Grotesk for the wordmark, JetBrains Mono for the small
 * letterspaced eyebrows above page titles. Variable names are kept generic so
 * the token sheet does not have to know which family is current.
 */
const sans = Inter({
  variable: "--font-sans-family",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono-family",
  subsets: ["latin"],
});

const display = Space_Grotesk({
  variable: "--font-display-family",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: LEAGUE.name,
  description: `Year-round league operations for the ${LEAGUE.name} — the keeper draft board, keepers, traded picks, trades, and governance.`,
};

/**
 * Stated rather than left to the framework's default, because two of these are
 * decisions and the league is about to open this on ten phones.
 *
 * NO `maximumScale`. Pinch-zoom stays on. It is an accessibility floor, and it
 * is also the escape hatch on the one screen that deliberately prints 9px type:
 * the board sizes a player's name to fit its cell whole, and anybody who wants
 * it bigger can pinch.
 *
 * `interactiveWidget: "resizes-content"` is the one that is load-bearing. The
 * board and the mock both pin their name box to the bottom of the screen, and
 * under the default (`resizes-visual`) an Android soft keyboard opens straight
 * over the top of it — you would be typing into a box you cannot see.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full">
        <TooltipProvider>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
