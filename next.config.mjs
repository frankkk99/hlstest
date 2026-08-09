/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/avdb-scan": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
