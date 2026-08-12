import type { Metadata } from "next";
import PublicHeader from "./public-header";

export const metadata: Metadata = {
  title: "ดูหนังออนไลน์ | HLSHUB",
  description: "ชมภาพยนตร์และซีรีส์ออนไลน์ พร้อมรายการแนะนำล่าสุด",
};

export default function StorefrontLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    <PublicHeader />
    {children}
  </>;
}
