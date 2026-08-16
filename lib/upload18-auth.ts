import type { Page } from "puppeteer-core";

const UPLOAD18_HOST = "upload18.org";
const AUTH_PREFLIGHT_MS = 4500;
const AUTH_STABILITY_MS = 6500;
const AUTH_CACHE_MS = 5 * 60 * 1000;
let upload18AuthValidatedUntil = 0;

type Upload18AuthResult = {
  handled: boolean;
  authenticated: boolean;
  reason?: "credentials-missing" | "login-failed" | "session-not-persisted";
  pageStatus?: number;
};

type LoginSaveResult = {
  success: boolean;
  message: string;
  code: number | null;
};

function isUpload18Url(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === UPLOAD18_HOST || host.endsWith(`.${UPLOAD18_HOST}`));
  } catch {
    return false;
  }
}

function upload18Path(raw: string) {
  try {
    const url = new URL(raw);
    return isUpload18Url(raw) ? url.pathname : "";
  } catch {
    return "";
  }
}

function isUpload18LoginUrl(raw: string) {
  return /^\/login\/?$/i.test(upload18Path(raw));
}

async function isUpload18LoginPage(page: Page) {
  if (!isUpload18Url(page.url())) return false;
  if (isUpload18LoginUrl(page.url())) return true;
  return page.evaluate(() => {
    const title = document.title.toLowerCase();
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    const hasUser = Boolean(document.querySelector('input[type="text"],input[name*=user i],input[name*=email i]'));
    return title.includes("login") && hasPassword && hasUser;
  }).catch(() => false);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitLogin(page: Page, username: string, password: string): Promise<LoginSaveResult | null> {
  return page.evaluate(async ({ user, pass }) => {
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
    const usernameInput = (
      document.querySelector('input[name*=user i],input[name*=email i],input[type="text"],input:not([type])')
    ) as HTMLInputElement | null;
    if (!passwordInput || !usernameInput) return null;

    const form = passwordInput.form || usernameInput.form || document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) return null;

    const data = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) data.set(key, String(value));
    data.set(usernameInput.name || "name", user);
    data.set(passwordInput.name || "pass", pass);

    try {
      const response = await fetch(form.action || "/login/save", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: data.toString(),
      });
      const text = await response.text();
      const payload = JSON.parse(text) as { code?: unknown; msg?: unknown; message?: unknown; success?: unknown };
      const message = String(payload.msg ?? payload.message ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
      const parsedCode = Number(payload.code);
      const code = Number.isFinite(parsedCode) ? parsedCode : null;
      return {
        success: response.ok && (payload.success === true || code === 1 || /success|successful|welcome|logged\s*in/i.test(message)),
        message,
        code,
      };
    } catch {
      return null;
    }
  }, { user: username, pass: password }).catch(() => null);
}

export async function ensureUpload18Authenticated(page: Page, targetUrl: string): Promise<Upload18AuthResult> {
  if (!isUpload18Url(targetUrl)) return { handled: false, authenticated: true };

  if (upload18AuthValidatedUntil > Date.now()) {
    if (!(await isUpload18LoginPage(page))) return { handled: true, authenticated: true };
    upload18AuthValidatedUntil = 0;
  }

  if (!(await isUpload18LoginPage(page))) {
    await sleep(AUTH_PREFLIGHT_MS);
    if (!(await isUpload18LoginPage(page))) {
      upload18AuthValidatedUntil = Date.now() + AUTH_CACHE_MS;
      return { handled: true, authenticated: true };
    }
  }

  const username = String(process.env.UPLOAD18_USERNAME || "").trim();
  const password = String(process.env.UPLOAD18_PASSWORD || "");
  if (!username || !password) {
    upload18AuthValidatedUntil = 0;
    console.warn("[upload18-auth] credentials are missing");
    return { handled: true, authenticated: false, reason: "credentials-missing" };
  }

  const saveResult = await submitLogin(page, username, password);
  if (!saveResult || !saveResult.success) {
    upload18AuthValidatedUntil = 0;
    console.warn(`[upload18-auth] login rejected code=${saveResult?.code ?? "unknown"} msg=${saveResult?.message || "(empty)"}`);
    return { handled: true, authenticated: false, reason: "login-failed" };
  }

  console.info(`[upload18-auth] login accepted code=${saveResult.code ?? "unknown"}`);

  let targetStatus: number | undefined;
  if (page.url() !== targetUrl) {
    const targetNavigation = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    targetStatus = targetNavigation?.status();
  }

  await sleep(AUTH_STABILITY_MS);
  if (await isUpload18LoginPage(page)) {
    upload18AuthValidatedUntil = 0;
    console.warn("[upload18-auth] authenticated request returned to login page; session did not persist");
    return { handled: true, authenticated: false, reason: "session-not-persisted", pageStatus: targetStatus };
  }

  upload18AuthValidatedUntil = Date.now() + AUTH_CACHE_MS;
  console.info(`[upload18-auth] session ready targetStatus=${targetStatus ?? "unknown"}`);
  return { handled: true, authenticated: true, pageStatus: targetStatus };
}
