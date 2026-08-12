import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { getServerlessChromiumExecutable } from "@/lib/serverless-chromium";
import { isHlshubConfigured, saveHlshubDiscoveredBatch } from "@/lib/hlshub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SOURCE_HOSTS = ["missav123.com", "missav.com"];
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";
const EXCLUDED_PREFIXES = [
  "/api",
  "/img",
  "/fonts",
  "/build",
  "/search",
  "/history",
  "/saved",
  "/playlists",
  "/login",
  "/register",
  "/contact",
  "/terms",
  "/ads",
  "/upload",
  "/vip",
  "/legacy",
  "/pop",
  "/dm",
  "/site",
  "/actors",
  "/actresses",
  "/genres",
  "/makers",
  "/labels",
  "/directors",
];
const LOCALES = new Set(["th", "en", "ja", "ko", "cn", "ms", "de", "fr", "vi", "id", "fil", "pt"]);
const EXCLUDED_SLUGS = new Set([
  "articles",
  "vip",
  "search",
  "history",
  "saved",
  "playlists",
  "actresses",
  "actors",
  "genres",
  "makers",
  "labels",
  "directors",
  "contact",
  "terms",
  "ads",
  "upload",
  "new",
  "release",
  "uncensored-leak",
  "english-subtitle",
  "chinese-subtitle",
  "today-hot",
  "weekly-hot",
  "monthly-hot",
  "siro",
  "luxu",
  "gana",
  "maan",
  "scute",
  "ara",
  "fc2",
  "heyzo",
  "tokyohot",
  "1pondo",
  "caribbeancom",
  "caribbeancompr",
  "10musume",
  "pacopacomama",
  "gachinco",
  "xxxav",
  "marriedslash",
  "naughty4610",
  "naughty0930",
  "madou",
  "twav",
  "furuke",
  "klive",
  "clive",
]);

function hostMatches(hostname: string, hosts: string[]) {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function allowedPageUrl(raw: string) {
  const url = new URL(raw);
  const hosts = (process.env.ALLOWED_SOURCE_PAGE_HOSTS || DEFAULT_SOURCE_HOSTS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (url.protocol !== "https:" || !hostMatches(url.hostname.toLowerCase(), hosts)) {
    throw new Error("อนุญาตเฉพาะหน้าหลักบน missav123.com / missav.com");
  }
  return url;
}

function looksLikeVideoDetail(raw: string, baseHost: string) {
  try {
    const url = new URL(raw, `https://${baseHost}`);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== baseHost) return false;
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return false;
    if (EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return false;
    if (/\.(?:jpg|jpeg|png|gif|webp|css|js|xml|json|ico|svg|woff2?)$/i.test(path)) return false;

    const parts = path.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "";
    if (slug.length < 3 || slug.length > 160) return false;
    if (EXCLUDED_SLUGS.has(slug.toLowerCase())) return false;

    // The home page contains navigation, category and maker links next to
    // title links. Keep only the two URL shapes used for actual title pages:
    // /{locale}/{title-slug} and /dmNN/{locale}/{title-slug}.
    const isLocalizedTitle = parts.length === 2 && LOCALES.has(parts[0].toLowerCase());
    const isDmLocalizedTitle = parts.length === 3 && /^dm\d+$/i.test(parts[0]) && LOCALES.has(parts[1].toLowerCase());
    if (!isLocalizedTitle && !isDmLocalizedTitle) return false;
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    const body = await request.json();
    const pageUrl = allowedPageUrl(String(body?.pageUrl || "").trim());

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
    await page.setUserAgent(DEFAULT_UA);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    page.setDefaultNavigationTimeout(25000);

    const navigation = await page.goto(pageUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await page.evaluate(async () => {
      for (let index = 0; index < 3; index += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      window.scrollTo(0, 0);
    }).catch(() => undefined);

    const finalUrl = page.url();
    const finalHost = new URL(finalUrl).hostname.toLowerCase();
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"), (anchor) => ({
        href: anchor.href,
        text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
      })),
    );

    const found = new Map<string, { url: string; label: string }>();
    for (const link of links) {
      if (!looksLikeVideoDetail(link.href, finalHost)) continue;
      const url = new URL(link.href);
      url.hash = "";
      url.search = "";
      const normalized = url.toString().replace(/\/$/, "");
      if (!found.has(normalized)) {
        const slug = normalized.split("/").filter(Boolean).pop() || normalized;
        found.set(normalized, {
          url: normalized,
          label: link.text || slug.replace(/[-_]+/g, " ").trim(),
        });
      }
    }

    const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 100);
    const items = [...found.values()].slice(0, limit);
    const storage = body?.persist === false
      ? { configured: isHlshubConfigured(), savedCount: 0, error: null }
      : await saveHlshubDiscoveredBatch(items);
    if (storage.savedCount > 0) revalidateTag("hlshub-catalog");

    return NextResponse.json({
      ok: true,
      pageUrl: pageUrl.toString(),
      finalUrl,
      pageStatus: navigation?.status() ?? 0,
      count: items.length,
      items,
      storage,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bulk discovery failed" },
      { status: 400 },
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
