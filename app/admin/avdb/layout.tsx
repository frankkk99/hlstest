import Link from "next/link";
import type { ReactNode } from "react";
import AvdbMoreLoader from "./avdb-more-loader";
import AvdbPlayerConsole from "./avdb-player-console";
import AvdbPublishConsole from "./avdb-publish-console";
import AvdbWorkerDriver from "./avdb-worker-driver";

export default function AvdbAdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AvdbWorkerDriver />
      {children}
      <Link
        href="/admin/avdb-html-import"
        style={{
          position: "fixed",
          right: 18,
          top: 84,
          zIndex: 70,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 38,
          padding: "0 14px",
          border: "1px solid rgba(244,162,78,.55)",
          borderRadius: 999,
          color: "#18110a",
          background: "#f4a24e",
          boxShadow: "0 10px 30px rgba(0,0,0,.28)",
          fontSize: 11,
          fontWeight: 950,
          textDecoration: "none",
        }}
      >
        HTML Import
      </Link>
      <AvdbMoreLoader />
      <AvdbPublishConsole />
      <AvdbPlayerConsole />
    </>
  );
}
