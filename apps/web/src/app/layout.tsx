import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Any-Convert — Video, handled beautifully",
  description: "A considered home for video conversion and transformation.",
  robots: { index: false, follow: false }, // M0: preview milestone, not a production converter
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
