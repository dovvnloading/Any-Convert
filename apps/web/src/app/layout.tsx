import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Next downloads and self-hosts these fonts at build time. No client font-CDN request.
const bodyFont = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans" });
const displayFont = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Any-Convert — Video, handled beautifully",
  description: "A considered home for video conversion and transformation.",
  robots: { index: false, follow: false }, // M0: preview milestone, not a production converter
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
