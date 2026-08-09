import type { Metadata } from "next";
import "./globals.css";
import ToolNav from "./components/ToolNav";

export const metadata: Metadata = {
  title: "HLS Test Lab",
  description: "AVDB import, HLS diagnostics and embed testing",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>
        <ToolNav />
        {children}
      </body>
    </html>
  );
}
