import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// One family for everything, self-hosted by next/font. Hanken Grotesk is a variable font, so 400, 500 and 600 come from
// one file.
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Good Faith", template: "%s | Good Faith" },
  description: "Security deposits from move-in to refund in California, New York, Texas, Florida and Washington, lawful and fair to the tenant, with PayPal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hanken.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
