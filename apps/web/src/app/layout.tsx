import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Next downloads and self-hosts these fonts at build time. No client font-CDN request.
const bodyFont = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans" });
const displayFont = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Any-Convert — Video, handled beautifully",
  description: "Convert videos to MP4, WebM, and MOV or extract audio as MP3, WAV, and FLAC — directly on your device.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
