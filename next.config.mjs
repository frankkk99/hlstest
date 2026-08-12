/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/avdb-scan": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/browser-session": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/bulk-discover": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/bulk-test": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
