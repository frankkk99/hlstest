import { defaultUserAgent, validateUpstreamUrl } from "@/lib/security";
import { createStreamToken } from "@/lib/stream-token";

const FAST_SESSION_TTL_MS = 30 * 60 * 1000;
const DIRECT_TIMEOUT_MS = 6500;

type Check = {
  url: string;
  status: number;
  contentType: string;
  bytes: number;
};

export type AvdbFastPlaybackResult = {
  mode: "verified-hint" | "direct-upload18";
  mediaUrl: string;
  playbackUrl: string;
  expiresAt: number;
  referer: string;
  diagnostics: {
    manifest: Check;
    segment: Check;
  };
};

function isUpload18Page(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "upload18.org" || host.endsWith(".upload18.org"));
  } catch {
    return false;
  }
}

function firstMediaUrl(body: string, baseUrl: string) {
  const map = body.match(/#EXT-X-MAP:[^\n]*URI="([^"]+)"/i)?.[1];
  if (map) return new URL(map, baseUrl).toString();
  const line = body
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith("#"));
  return line ? new URL(line, baseUrl).toString() : null;
}

function requestHeaders(referer: string, userAgent: string) {
  const headers = new Headers({
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
    Referer: referer,
    "User-Agent": userAgent,
  });
  try {
    headers.set("Origin", new URL(referer).origin);
  } catch {
    // Referer is validated by the caller; keep the request usable if parsing fails.
  }
  return headers;
}

async function inspectManifestDirect(manifestUrl: string, referer: string, userAgent: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  const headers = requestHeaders(referer, userAgent);

  try {
    async function getText(rawUrl: string) {
      const target = validateUpstreamUrl(rawUrl);
      const response = await fetch(target, {
        headers,
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.text();
      return {
        response,
        body,
        check: {
          url: target.toString(),
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          bytes: body.length,
        } satisfies Check,
      };
    }

    let playlistUrl = validateUpstreamUrl(manifestUrl).toString();
    let playlist = await getText(playlistUrl);
    const rootLooksLikeManifest =
      playlist.body.trimStart().startsWith("#EXTM3U") ||
      /m3u8|mpegurl/i.test(playlist.check.contentType) ||
      /\.m3u8(?:$|\?)/i.test(playlistUrl) ||
      /^\/(?:m|p)\//i.test(new URL(playlistUrl).pathname);
    if (!playlist.response.ok || !rootLooksLikeManifest) return null;

    const rootCheck = playlist.check;
    let segmentUrl = firstMediaUrl(playlist.body, playlistUrl);
    for (let depth = 0; segmentUrl && depth < 3; depth += 1) {
      const target = validateUpstreamUrl(segmentUrl);
      const looksLikePlaylist =
        /\.m3u8(?:$|\?)/i.test(target.toString()) ||
        /^\/(?:m|p)\//i.test(target.pathname);
      if (!looksLikePlaylist) break;
      const child = await getText(target.toString());
      if (!child.response.ok || !child.body.trimStart().startsWith("#EXTM3U")) return null;
      playlistUrl = target.toString();
      playlist = child;
      segmentUrl = firstMediaUrl(playlist.body, playlistUrl);
    }

    if (!segmentUrl) return null;
    const segmentTarget = validateUpstreamUrl(segmentUrl);
    const segmentHeaders = new Headers(headers);
    segmentHeaders.set("Range", "bytes=0-65535");
    const segmentResponse = await fetch(segmentTarget, {
      headers: segmentHeaders,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const segmentBytes = new Uint8Array(await segmentResponse.arrayBuffer());
    const contentType = segmentResponse.headers.get("content-type") || "";
    const sample = new TextDecoder().decode(segmentBytes.subarray(0, 64)).trim().toLowerCase();
    const looksLikeHtml =
      /text\/html/i.test(contentType) || sample.startsWith("<!doctype") || sample.startsWith("<html");
    if (!segmentResponse.ok || !segmentBytes.byteLength || looksLikeHtml) return null;

    return {
      manifest: rootCheck,
      segment: {
        url: segmentTarget.toString(),
        status: segmentResponse.status,
        contentType,
        bytes: segmentBytes.byteLength,
      } satisfies Check,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function makePlaybackResult(input: {
  mode: AvdbFastPlaybackResult["mode"];
  mediaUrl: string;
  referer: string;
  userAgent: string;
  diagnostics: AvdbFastPlaybackResult["diagnostics"];
}): AvdbFastPlaybackResult | null {
  try {
    const expiresAt = Date.now() + FAST_SESSION_TTL_MS;
    const token = createStreamToken({
      url: input.mediaUrl,
      origin: new URL(input.referer).origin,
      referer: input.referer,
      userAgent: input.userAgent,
      cookie: "",
      expiresAt,
    });
    return {
      mode: input.mode,
      mediaUrl: input.mediaUrl,
      playbackUrl: `/api/stream?token=${encodeURIComponent(token)}`,
      expiresAt,
      referer: input.referer,
      diagnostics: input.diagnostics,
    };
  } catch {
    return null;
  }
}

export async function resolveAvdbFastPlayback(input: {
  pageUrl: string;
  mediaHint?: string | null;
  forceFresh?: boolean;
  userAgent?: string;
}): Promise<AvdbFastPlaybackResult | null> {
  if (!isUpload18Page(input.pageUrl)) return null;
  const userAgent = input.userAgent || defaultUserAgent();

  if (!input.forceFresh && input.mediaHint) {
    const hintDiagnostics = await inspectManifestDirect(input.mediaHint, input.pageUrl, userAgent);
    if (hintDiagnostics) {
      const result = makePlaybackResult({
        mode: "verified-hint",
        mediaUrl: input.mediaHint,
        referer: input.pageUrl,
        userAgent,
        diagnostics: hintDiagnostics,
      });
      if (result) return result;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
    try {
      const response = await fetch(input.pageUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
          Referer: "https://upload18.org/",
          "User-Agent": userAgent,
        },
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const html = await response.text();
      const configText = html.match(/window\.PLAYER_CONFIG\s*=\s*(\{[\s\S]*?\});/)?.[1];
      if (!configText) return null;
      const config = JSON.parse(configText) as { m3u8?: unknown };
      const mediaUrl = String(config.m3u8 || "").trim();
      if (!mediaUrl) return null;
      validateUpstreamUrl(mediaUrl);
      const referer = response.url && isUpload18Page(response.url) ? response.url : input.pageUrl;
      const diagnostics = await inspectManifestDirect(mediaUrl, referer, userAgent);
      if (!diagnostics) return null;
      return makePlaybackResult({
        mode: "direct-upload18",
        mediaUrl,
        referer,
        userAgent,
        diagnostics,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}
