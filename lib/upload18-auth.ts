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

function isUpload18LoginSaveUrl(raw: string) {
  return /^\/login\/save\/?$/i.test(upload18Path(raw));
}

async function isUpload18LoginPage(page: Page) {
  if (!isUpload18Url(page.url())) return false;
  if (isUpload18LoginUrl(page.url())) return true;
  if (isUpload18LoginSaveUrl(page.url())) return false;
  return page.evaluate(() => {
    const title = document.title.toLowerCase();
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    const hasUser = Boolean(document.querySelector('input[type="text"],input[name*=user i],input[name*=email i]'));
    return title.includes("login") && hasPassword && hasUser;
  }).catch(() => false);
}

async function readLoginSaveResult(page: Page): Promise<LoginSaveResult | null> {
  if (!isUpload18LoginSaveUrl(page.url())) return null;
  const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  if (!text.trim()) return null;
  try {
    const payload = JSON.parse(text) as { code?: unknown; msg?: unknown; message?: unknown; success?: unknown };
    const message = String(payload.msg ?? payload.message ?? "").trim();
    const code = Number(payload.code);
    const success = payload.success === true || code === 1 || /success|successful|welcome|logged\s*in/i.test(message);
    return { success, message };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitLogin(page: Page, username: string, password: string) {
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null);

  const submitted = await page.evaluate(({ user, pass }) => {
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
    const usernameInput = (
      document.querySelector('input[name*=user i],input[name*=email i],input[type="text"],input:not([type])')
    ) as HTMLInputElement | null;
    if (!passwordInput || !usernameInput) return false;

    const setValue = (input: HTMLInputElement, value: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    setValue(usernameInput, user);
    setValue(passwordInput, pass);

    const form = passwordInput.form || usernameInput.form || document.querySelector("form");
    if (form instanceof HTMLFormElement) {
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
      return true;
    }

    const button = Array.from(document.querySelectorAll("button,input[type=submit]")).find((element) => {
      const label = element instanceof HTMLInputElement ? element.value : element.textContent || "";
      return /sign\s*in|login|log\s*in/i.test(label);
    }) as HTMLElement | undefined;
    button?.click();
    return Boolean(button);
  }, { user: username, pass: password }).catch(() => false);

  if (!submitted) return null;
  return navigation;
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
    return { handled: true, authenticated: false, reason: "credentials-missing" };
  }

  const loginNavigation = await submitLogin(page, username, password);
  const saveResult = await readLoginSaveResult(page);
  if (saveResult && !saveResult.success) {
    upload18AuthValidatedUntil = 0;
    return { handled: true, authenticated: false, reason: "login-failed", pageStatus: loginNavigation?.status() };
  }

  if (!saveResult) {
    await sleep(AUTH_STABILITY_MS);
    if (await isUpload18LoginPage(page)) {
      upload18AuthValidatedUntil = 0;
      return { handled: true, authenticated: false, reason: "login-failed", pageStatus: loginNavigation?.status() };
    }
  }

  let targetStatus = loginNavigation?.status();
  if (page.url() !== targetUrl) {
    const targetNavigation = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    targetStatus = targetNavigation?.status();
  }

  await sleep(AUTH_STABILITY_MS);
  if (await isUpload18LoginPage(page)) {
    upload18AuthValidatedUntil = 0;
    return { handled: true, authenticated: false, reason: "session-not-persisted", pageStatus: targetStatus };
  }

  upload18AuthValidatedUntil = Date.now() + AUTH_CACHE_MS;
  return { handled: true, authenticated: true, pageStatus: targetStatus };
}
