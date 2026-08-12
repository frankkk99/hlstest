import net from "node:net";

const DEFAULT_ALLOWED_HOSTS = ["helvid.com", "surrit.com", "fourhoi.com"];

export function allowedHosts(): string[] {
  return (process.env.ALLOWED_HLS_HOSTS || DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateIp(hostname: string): boolean {
  if (!net.isIP(hostname)) return false;

  if (net.isIPv4(hostname)) {
    const parts = hostname.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

export function validateUpstreamUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL ไม่ถูกต้อง");
  }

  if (url.protocol !== "https:") {
    throw new Error("อนุญาตเฉพาะ HTTPS");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || isPrivateIp(hostname)) {
    throw new Error("ไม่อนุญาต private/local network");
  }

  const hosts = allowedHosts();
  const allowed = hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) {
    throw new Error(`Host ไม่อยู่ใน allowlist: ${hostname}`);
  }

  return url;
}

export function defaultUserAgent(): string {
  return (
    process.env.HLS_TEST_USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"
  );
}

export function buildUpstreamHeaders(options: {
  origin?: string;
  referer?: string;
  userAgent?: string;
  cookie?: string;
  range?: string | null;
}): Headers {
  const headers = new Headers();
  headers.set("Accept", "*/*");
  headers.set("Accept-Language", "en-US,en;q=0.9,th;q=0.8");
  headers.set("Cache-Control", "no-cache");
  headers.set("Pragma", "no-cache");
  headers.set("User-Agent", options.userAgent || defaultUserAgent());
  headers.set("Sec-CH-UA", '"Chromium";v="151", "Microsoft Edge";v="151", "Not_A Brand";v="99"');
  headers.set("Sec-CH-UA-Mobile", "?0");
  headers.set("Sec-CH-UA-Platform", '"Windows"');
  headers.set("Sec-Fetch-Dest", "empty");
  headers.set("Sec-Fetch-Mode", "cors");
  headers.set("Sec-Fetch-Site", "cross-site");
  if (options.origin) headers.set("Origin", options.origin);
  if (options.referer) headers.set("Referer", options.referer);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.range) headers.set("Range", options.range);
  return headers;
}

export function proxyEnabled(): boolean {
  // The public Player Extractor must be able to play HLS sources whose CDN
  // rejects browser-direct requests. The proxy is still limited by the
  // HTTPS host allowlist above; set ENABLE_STREAM_PROXY=false to disable it.
  return process.env.ENABLE_STREAM_PROXY !== "false";
}
