/** @type {import('next').NextConfig} */
const frameAncestors = process.env.PLAYER_GATEWAY_FRAME_ANCESTORS?.trim() || "*";

const nextConfig = {
  outputFileTracingIncludes: {
    "/api/avdb-scan": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/browser-session": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/bulk-discover": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/bulk-test": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` },
          { key: "Cache-Control", value: "no-store" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
