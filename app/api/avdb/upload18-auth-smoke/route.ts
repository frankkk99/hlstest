import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";
import { ensureUpload18Authenticated } from "@/lib/upload18-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_ID = "751637c3-550d-416c-9c50-a0678d18e453";
const ITEM_ID = "a993bd1b-b268-48c4-aaae-4fb9fb3793cb";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function host(raw: string) {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return "invalid"; }
}

export async function GET(request: NextRequest) {
  const token = String(request.nextUrl.searchParams.get("token") || "").trim();
  const url = process.env.HLSHUB_SUPABASE_URL || process.env.SUPABASE_URL || "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key || !token) return NextResponse.json({ ok: false, error: "diagnostic unavailable" }, { status: 403 });

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const runResponse = await db.from("avdb_stage_runs").select("metadata").eq("id", RUN_ID).maybeSingle();
  const metadata = (runResponse.data?.metadata || {}) as Record<string, unknown>;
  const expected = String(metadata.upload18_postlogin_diag_hash || "");
  const expiresAt = Date.parse(String(metadata.upload18_postlogin_diag_expires_at || ""));
  if (!expected || !safeEqual(hash(token), expected) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return NextResponse.json({ ok: false, error: "diagnostic token expired" }, { status: 403 });
  }

  const itemResponse = await db.from("avdb_stage_items").select("player_page_url,player_provider").eq("id", ITEM_ID).maybeSingle();
  const item = itemResponse.data;
  if (!item?.player_page_url || item.player_provider !== "upload18.org") {
    return NextResponse.json({ ok: false, error: "Upload18 item unavailable" }, { status: 409 });
  }

  const consume = await db.from("avdb_stage_runs").update({
    metadata: {
      ...metadata,
      upload18_postlogin_diag_hash: null,
      upload18_postlogin_diag_used_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq("id", RUN_ID);
  if (consume.error) return NextResponse.json({ ok: false, error: "cannot consume diagnostic token" }, { status: 500 });

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  const responseHosts = new Set<string>();
  const hlsHosts = new Set<string>();
  const mediaHosts = new Set<string>();

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
      const raw = response.url();
      const hostname = host(raw);
      responseHosts.add(hostname);
      const contentType = String(response.headers()["content-type"] || "").toLowerCase();
      if (/video\//i.test(contentType)) mediaHosts.add(hostname);
      if (/\.m3u8(?:$|\?)/i.test(raw) || /\/playlist(?:\/|\.|$|\?)/i.test(raw) || /mpegurl|m3u8/i.test(contentType)) {
        hlsHosts.add(hostname);
      }
    });

    const initial = await page.goto(item.player_page_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const auth = await ensureUpload18Authenticated(page, item.player_page_url);
    await new Promise((resolve) => setTimeout(resolve, 3500));

    const frames = [] as Array<{ host: string; title: string; videos: number; sources: number; iframeHosts: string[]; controls: string[]; text: string }>;
    for (const frame of page.frames()) {
      const detail = await frame.evaluate(() => {
        const clean = (value: string) => value.replace(/\s+/g, " ").trim();
        const controls = Array.from(document.querySelectorAll("button,a,input[type=button],input[type=submit]"))
          .map((element) => clean(element instanceof HTMLInputElement ? element.value : element.textContent || ""))
          .filter(Boolean)
          .slice(0, 30);
        const iframeHosts = Array.from(document.querySelectorAll("iframe[src]"))
          .map((element) => {
            try { return new URL((element as HTMLIFrameElement).src, location.href).hostname.toLowerCase(); }
            catch { return "invalid"; }
          });
        return {
          title: clean(document.title).slice(0, 120),
          videos: document.querySelectorAll("video").length,
          sources: document.querySelectorAll("video source,source").length,
          iframeHosts: [...new Set(iframeHosts)].slice(0, 20),
          controls,
          text: clean(document.body?.innerText || "").slice(0, 1000),
        };
      }).catch(() => ({ title: "", videos: 0, sources: 0, iframeHosts: [] as string[], controls: [] as string[], text: "" }));
      frames.push({ host: host(frame.url()), ...detail });
    }

    return NextResponse.json({
      ok: true,
      initialStatus: initial?.status() ?? 0,
      authenticated: auth.authenticated,
      authReason: auth.reason || null,
      finalHost: host(page.url()),
      finalPath: (() => { try { return new URL(page.url()).pathname; } catch { return ""; } })(),
      frames,
      hlsHosts: [...hlsHosts].filter(Boolean).slice(0, 20),
      mediaHosts: [...mediaHosts].filter(Boolean).slice(0, 20),
      responseHosts: [...responseHosts].filter(Boolean).slice(0, 50),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "post-login diagnostic failed" }, { status: 500 });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
