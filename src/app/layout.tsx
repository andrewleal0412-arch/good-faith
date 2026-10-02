import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// One family for everything, self-hosted by next/font. Inter is a variable font, so 400, 500 and 600 come from one file.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Good Faith", template: "%s | Good Faith" },
  description: "California security deposits from move-in to refund, lawful and fair to the tenant, with PayPal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
