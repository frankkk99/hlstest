import { NextRequest, NextResponse } from "next/server";
import {
  allowedHosts,
  buildUpstreamHeaders,
  defaultUserAgent,
  proxyEnabled,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SOURCE_PAGE_HOSTS = ["missav123.com", "missav.com", "fourhoi.com", "upload18.org"];
const DEFAULT_MEDIA_HOSTS = ["surrit.com", "fourhoi.com"];
const MAX_HTML_BYTES = 5_000_000;
const MAX_TEST_BYTES = 512_000;

type ExtractBody = {
  pageUrl?: string;
  html?: string;
  origin?: string;
  referer?: string;
  userAgent?: string;
  testMedia?: boolean;
};

type Candidate = {
  url: string;
  type: "hls" | "mp4";
  role: "manifest" | "video" | "preview";
  quality: string | null;
  source: string;
};

function isPrivateIp(hostname: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const [a, b] = hostname.split(".").map(Number);
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

function hostMatches(hostname: string, hosts: string[]) {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function validateSourcePageUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL หน้าเว็บไม่ถูกต้อง");
  }

  if (url.protocol !== "https:") throw new Error("หน้าเว็บต้นทางต้องใช้ HTTPS");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || isPrivateIp(url.hostname)) {
    throw new Error("ไม่อนุญาต private/local network");
  }

  const hosts = (process.env.ALLOWED_SOURCE_PAGE_HOSTS || DEFAULT_SOURCE_PAGE_HOSTS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!hostMatches(url.hostname.toLowerCase(), hosts)) {
    throw new Error(`Host หน้าเว็บไม่อยู่ใน allowlist: ${url.hostname}`);
  }

  return url;
}

function mediaHostAllowed(url: URL) {
  const configured = (process.env.ALLOWED_EXTRACT_MEDIA_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const hosts = [...new Set([...allowedHosts(), ...DEFAULT_MEDIA_HOSTS, ...configured])];
  return url.protocol === "https:" && !isPrivateIp(url.hostname) && hostMatches(url.hostname.toLowerCase(), hosts);
}

function decodeEscapes(value: string) {
  return value
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/")
    .replace(/\\+\//g, "/")
    .replace(/\\+&/g, "&")
    .replace(/\\+(["'])/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x2F;/gi, "/");
}

function unescapePackedString(value: string) {
  return decodeEscapes(value)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function baseEncode(value: number, base: number) {
  if (base <= 36) return value.toString(base);
  if (value < 36) return value.toString(36);
  return String.fromCharCode(value + 29);
}

function unpackDeanEdwards(payload: string, base: number, count: number, dictionary: string) {
  const words = dictionary.split("|");
  let output = unescapePackedString(payload);

  for (let index = count - 1; index >= 0; index -= 1) {
    const token = baseEncode(index, base);
    const replacement = words[index] || token;
    if (!replacement || replacement === token) continue;
    output = output.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "g"), replacement);
  }

  return output;
}

function decodePackedBlocks(html: string) {
  const decoded: Array<{ source: string; code: string }> = [];
  const patterns = [
    /\}\(\s*'((?:\\+.|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\+.|[^'])*)'\.split\('\|'\)/g,
    /\}\(\s*"((?:\\+.|[^"])*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:\\+.|[^"])*)"\.split\("\|"\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const [, payload, base, count, dictionary] = match;
      const code = unpackDeanEdwards(payload, Number(base), Number(count), dictionary);
      decoded.push({ source: "decoded packed JavaScript", code });
    }
  }

  return decoded;
}

function cleanUrl(raw: string) {
  return decodeEscapes(raw)
    .trim()
    .replace(/^[\s([{<]+/, "")
    .replace(/[\s\]}),;:'\"]+$/g, "");
}

function addCandidate(
  found: Map<string, Candidate>,
  raw: string,
  baseUrl: URL | null,
  source: string,
) {
  const cleaned = cleanUrl(raw);
  if (!cleaned || /^(?:javascript|data|blob):/i.test(cleaned)) return;

  let url: URL;
  try {
    if (!/^https?:\/\//i.test(cleaned) && !baseUrl) return;
    url = new URL(cleaned, baseUrl || undefined);
  } catch {
    return;
  }

  const path = url.pathname.toLowerCase();
  const isHls = path.endsWith(".m3u8");
  const isMp4 = path.endsWith(".mp4");
  if (!isHls && !isMp4) return;

  const normalizedUrl = url.toString();
  const role = isMp4 && /preview/i.test(path) ? "preview" : isHls ? "manifest" : "video";
  const quality = /1080p/i.test(path) ? "1080p" : /720p/i.test(path) ? "720p" : null;

  if (!found.has(normalizedUrl)) {
    found.set(normalizedUrl, {
      url: normalizedUrl,
      type: isHls ? "hls" : "mp4",
      role,
      quality,
      source,
    });
  }
}

function extractCandidates(html: string, baseUrl: URL | null) {
  const found = new Map<string, Candidate>();
  const decodedHtml = decodeEscapes(html);
  const directUrlPattern = /https?:\/\/[^\s"'<>`\\]+/gi;
  const relativeMediaPattern = /(?:["'`=(]|^)([^"'`()<>{}\s]+?\.(?:m3u8|mp4)(?:\?[^"'`()<>{}\s]*)?)/gi;

  for (const match of decodedHtml.match(directUrlPattern) || []) {
    addCandidate(found, match, baseUrl, "raw HTML / JavaScript");
  }

  let relativeMatch: RegExpExecArray | null;
  while ((relativeMatch = relativeMediaPattern.exec(decodedHtml))) {
    addCandidate(found, relativeMatch[1], baseUrl, "media attribute / relative path");
  }

  const packedBlocks = decodePackedBlocks(html);
  for (const block of packedBlocks) {
    for (const match of block.code.match(directUrlPattern) || []) {
      addCandidate(found, match, baseUrl, block.source);
    }

    let packedRelative: RegExpExecArray | null;
    while ((packedRelative = relativeMediaPattern.exec(block.code))) {
      addCandidate(found, packedRelative[1], baseUrl, block.source);
    }
  }

  return { candidates: [...found.values()], packedBlocks };
}

async function readLimitedBytes(response: Response, limit: number) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < limit) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = limit - total;
      const chunk = next.value.byteLength > remaining ? next.value.slice(0, remaining) : next.value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < next.value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readLimitedText(response: Response, limit: number) {
  const bytes = await readLimitedBytes(response, limit);
  return new TextDecoder().decode(bytes);
}

async function fetchPage(url: URL, userAgent: string) {
  let current = url;
  const redirects: string[] = [];

  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(current, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "th,en;q=0.8",
        "User-Agent": userAgent,
      },
      redirect: "manual",
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current, redirects };
      const next = validateSourcePageUrl(new URL(location, current).toString());
      redirects.push(next.toString());
      current = next;
      continue;
    }

    return { response, finalUrl: current, redirects };
  }

  throw new Error("หน้าเว็บ redirect มากเกินไป");
}

function parseManifest(text: string, baseUrl: URL) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const isHls = text.trimStart().startsWith("#EXTM3U");
  if (!isHls) return { isHls: false };

  const firstMedia = lines.find((line) => line && !line.startsWith("#"));
  let firstMediaUrl: string | null = null;
  if (firstMedia) {
    try {
      firstMediaUrl = new URL(firstMedia, baseUrl).toString();
    } catch {
      firstMediaUrl = null;
    }
  }

  return {
    isHls: true,
    variantCount: lines.filter((line) => line.startsWith("#EXT-X-STREAM-INF:")).length,
    segmentCount: lines.filter((line) => line.startsWith("#EXTINF:")).length,
    targetDuration: lines.find((line) => line.startsWith("#EXT-X-TARGETDURATION:"))?.split(":")[1] || null,
    playlistType: lines.find((line) => line.startsWith("#EXT-X-PLAYLIST-TYPE:"))?.split(":")[1] || null,
    hasEndList: lines.some((line) => line === "#EXT-X-ENDLIST"),
    encrypted: lines.some((line) => line.startsWith("#EXT-X-KEY:")),
    firstMediaUrl,
    preview: lines.slice(0, 24).join("\n"),
  };
}

async function testCandidate(candidate: Candidate, options: ExtractBody) {
  const started = Date.now();
  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return { ok: false, status: 0, error: "URL ไม่ถูกต้อง" };
  }

  if (!mediaHostAllowed(url)) {
    return {
      ok: false,
      status: 0,
      skipped: true,
      error: `ไม่ทดสอบ host นี้ เพราะไม่อยู่ใน media allowlist: ${url.hostname}`,
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const headers = buildUpstreamHeaders({
      origin: options.origin,
      referer: options.referer,
      userAgent: options.userAgent,
      range: candidate.type === "mp4" ? "bytes=0-4095" : null,
    });
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
    });
    const bytes = await readLimitedBytes(response, candidate.type === "hls" ? MAX_TEST_BYTES : 16_384);
    const contentType = response.headers.get("content-type") || "";
    const text = candidate.type === "hls" ? new TextDecoder().decode(bytes) : "";
    const manifest = candidate.type === "hls" ? parseManifest(text, url) : { isHls: false };

    return {
      ok: response.ok && (candidate.type === "mp4" ? true : manifest.isHls),
      status: response.status,
      statusText: response.statusText,
      contentType,
      contentLength: response.headers.get("content-length"),
      contentRange: response.headers.get("content-range"),
      allowOrigin: response.headers.get("access-control-allow-origin"),
      bytesRead: bytes.byteLength,
      elapsedMs: Date.now() - started,
      ...manifest,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Media request failed",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExtractBody;
    const pageUrlText = String(body.pageUrl || "").trim();
    const pastedHtml = String(body.html || "");
    const userAgent = body.userAgent || defaultUserAgent();

    if (!pageUrlText && !pastedHtml.trim()) {
      return NextResponse.json({ ok: false, error: "กรุณาใส่ URL หน้าเว็บ หรือวาง HTML" }, { status: 400 });
    }

    let html = pastedHtml;
    let finalPageUrl: URL | null = null;
    let sourceMode: "fetched-page" | "pasted-html";
    let pageStatus: number | null = null;
    let redirects: string[] = [];

    if (html.trim()) {
      sourceMode = "pasted-html";
      if (pageUrlText) {
        finalPageUrl = validateSourcePageUrl(pageUrlText);
      }
    } else {
      sourceMode = "fetched-page";
      finalPageUrl = validateSourcePageUrl(pageUrlText);
      const fetched = await fetchPage(finalPageUrl, userAgent);
      finalPageUrl = fetched.finalUrl;
      pageStatus = fetched.response.status;
      redirects = fetched.redirects;
      html = await readLimitedText(fetched.response, MAX_HTML_BYTES);
    }

    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      html = html.slice(0, MAX_HTML_BYTES);
    }

    const parsed = extractCandidates(html, finalPageUrl);
    const candidates = parsed.candidates.slice(0, 50);
    const tested = body.testMedia === false
      ? candidates.map((candidate) => ({ ...candidate, test: null }))
      : await Promise.all(
          candidates.slice(0, 20).map(async (candidate) => ({
            ...candidate,
            test: await testCandidate(candidate, {
              ...body,
              userAgent,
            }),
          })),
        );

    const notTested = candidates.slice(20).map((candidate) => ({
      ...candidate,
      test: { ok: false, skipped: true, error: "จำกัดการทดสอบอัตโนมัติไว้ 20 URL ต่อครั้ง" },
    }));

    return NextResponse.json({
      ok: candidates.length > 0,
      source: {
        mode: sourceMode,
        requestedUrl: pageUrlText || null,
        finalUrl: finalPageUrl?.toString() || null,
        status: pageStatus,
        bytes: Buffer.byteLength(html, "utf8"),
        redirects,
      },
      parser: {
        packedBlocks: parsed.packedBlocks.length,
        candidateCount: candidates.length,
        note:
          "ถอด URL จาก HTML/JavaScript โดยไม่ execute JavaScript ของหน้าเว็บต้นทาง และรองรับ Dean Edwards Packer ที่ใช้ซ่อน source player",
      },
      candidates: [...tested, ...notTested],
      proxyEnabled: proxyEnabled(),
      warnings: [
        "ผลทดสอบยิงจากเซิร์ฟเวอร์ของ hlstest; signed URL ที่ผูก IP หรือ session อาจเล่นได้เฉพาะเครือข่ายเดิม",
        "Player จะใช้ stream proxy เป็นค่าเริ่มต้นเมื่อเปิดใช้งาน เพื่อส่ง Referer/Origin ของหน้าเว็บต้นทางและหลีกเลี่ยง browser CORS",
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Player extraction failed" },
      { status: 400 },
    );
  }
}
