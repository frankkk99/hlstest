import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HLS Test Lab",
  description: "Header-aware HLS manifest and segment diagnostics",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
