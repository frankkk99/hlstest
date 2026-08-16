import type { Metadata } from "next";
import "./globals.css";
import ToolNav from "./components/ToolNav";

export const metadata: Metadata = {
  title: "Player Gateway",
  description: "dev2u.online Player Gateway for shared playback sessions, embeds and AVDB playback",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
  },
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
