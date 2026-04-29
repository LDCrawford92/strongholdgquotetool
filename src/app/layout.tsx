import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stronghold Quote Generator",
  description: "Stronghold curtain quotation tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
