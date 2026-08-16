import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_ID = "751637c3-550d-416c-9c50-a0678d18e453";
const ITEM_ID = "a993bd1b-b268-48c4-aaae-4fb9fb3793cb";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostname(raw: string) {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return "invalid"; }
}

export async function GET(request: NextRequest) {
  const token = String(request.nextUrl.searchParams.get("token") || "").trim();
  const supabaseUrl = process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key || !token) return NextResponse.json({ ok: false, error: "diagnostic unavailable" }, { status: 403 });

  const db = createClient(supabaseUrl, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const runResponse = await db.from("avdb_stage_runs").select("metadata").eq("id", RUN_ID).maybeSingle();
  const metadata = (runResponse.data?.metadata || {}) as Record<string, unknown>;
  const expected = String(metadata.upload18_diag_token_hash || "");
  const expiresAt = Date.parse(String(metadata.upload18_diag_expires_at || ""));
  if (!expected || !safeEqual(sha256(token), expected) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, error: "diagnostic token expired" }, { status: 403 });
  }

  const itemResponse = await db
    .from("avdb_stage_items")
    .select("id,player_page_url,player_provider")
    .eq("id", ITEM_ID)
    .eq("run_id", RUN_ID)
    .maybeSingle();
  const item = itemResponse.data;
  if (!item?.player_page_url || item.player_provider !== "upload18.org" || hostname(item.player_page_url) !== "upload18.org") {
    return NextResponse.json({ ok: false, error: "diagnostic item is not Upload18" }, { status: 409 });
  }

  // Consume the token before launching Chromium. This endpoint is intentionally one-shot.
  await db.from("avdb_stage_runs").update({
    metadata: { ...metadata, upload18_diag_token_hash: null, upload18_diag_used_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("id", RUN_ID);

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  const hlsHosts = new Set<string>();
  const mediaResponseHosts = new Set<string>();
  const responseHosts = new Set<string>();

  try {
    chromium.setGraphicsMode = false;
    const executablePath = await getServerlessChromiumExecutable();
    const launchArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" });
    browser = await puppeteer.launch({
      args: launchArgs,
      executablePath,
      headless: "shell",
      defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9,th;q=0.8" });
    page.setDefaultNavigationTimeout(30000);

    page.on("response", (response) => {
      const url = response.url();
      const host = hostname(url);
      responseHosts.add(host);
      const contentType = String(response.headers()["content-type"] || "").toLowerCase();
      if (/mpegurl|m3u8|video\//i.test(contentType)) mediaResponseHosts.add(host);
      if (/\.m3u8(?:$|\?)/i.test(url) || /\/playlist(?:\/|\.|$|\?)/i.test(url) || /mpegurl|m3u8/i.test(contentType)) {
        hlsHosts.add(host);
      }
    });

    const navigation = await page.goto(item.player_page_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const gate = await page.evaluate(() => {
      const clean = (value: string) => value.replace(/\s+/g, " ").trim();
      const controls = Array.from(document.querySelectorAll("button,input[type=submit],input[type=button],a"))
        .map((element) => {
          const text = element instanceof HTMLInputElement ? element.value : element.textContent || "";
          return clean(text).slice(0, 80);
        })
        .filter(Boolean)
        .slice(0, 20);
      return {
        title: clean(document.title).slice(0, 120),
        passwordInputs: document.querySelectorAll('input[type="password"]').length,
        textInputs: document.querySelectorAll('input[type="text"],input:not([type])').length,
        forms: document.querySelectorAll("form").length,
        controls,
        bodyPreview: clean(document.body?.innerText || "").slice(0, 600),
      };
    }).catch(() => ({ title: "", passwordInputs: 0, textInputs: 0, forms: 0, controls: [] as string[], bodyPreview: "" }));

    async function inspectFrames() {
      const details = [] as Array<{ host: string; videos: number; sources: number; iframes: string[] }>;
      for (const frame of page.frames()) {
        const result = await frame.evaluate(() => {
          const iframeHosts = Array.from(document.querySelectorAll("iframe[src]"))
            .map((element) => {
              try { return new URL((element as HTMLIFrameElement).src, location.href).hostname.toLowerCase(); }
              catch { return "invalid"; }
            });
          return {
            videos: document.querySelectorAll("video").length,
            sources: document.querySelectorAll("video source, source").length,
            iframes: [...new Set(iframeHosts)],
          };
        }).catch(() => ({ videos: 0, sources: 0, iframes: [] as string[] }));
        details.push({ host: hostname(frame.url()), ...result });
      }
      return details;
    }

    const before = await inspectFrames();

    let playbackAttempts = 0;
    for (const frame of page.frames()) {
      playbackAttempts += await frame.evaluate(async () => {
        let attempts = 0;
        for (const video of Array.from(document.querySelectorAll("video")) as HTMLVideoElement[]) {
          attempts += 1;
          video.muted = true;
          await video.play().catch(() => undefined);
        }
        return attempts;
      }).catch(() => 0);
    }

    await new Promise((resolve) => setTimeout(resolve, 12000));
    const after = await inspectFrames();

    return NextResponse.json({
      ok: true,
      pageStatus: navigation?.status() ?? 0,
      finalHost: hostname(page.url()),
      gate,
      frameCount: page.frames().length,
      before,
      after,
      playbackAttempts,
      hlsHosts: [...hlsHosts].filter(Boolean).slice(0, 20),
      mediaResponseHosts: [...mediaResponseHosts].filter(Boolean).slice(0, 20),
      responseHosts: [...responseHosts].filter(Boolean).slice(0, 40),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Upload18 diagnostic failed",
      hlsHosts: [...hlsHosts],
      mediaResponseHosts: [...mediaResponseHosts],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
