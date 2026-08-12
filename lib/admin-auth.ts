export const ADMIN_SESSION_COOKIE = "hlshub_admin_session";

export function getAdminPassword() {
  return String(process.env.HLSHUB_ADMIN_PASSWORD || process.env.HLSHUB_ADMIN_KEY || "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAdminSessionToken() {
  const password = getAdminPassword();
  return password ? sha256(`hlshub-admin-session:${password}`) : "";
}

export async function verifyAdminPassword(password: string) {
  const expected = getAdminPassword();
  if (!expected || !password) return false;
  const [providedHash, expectedHash] = await Promise.all([sha256(password), sha256(expected)]);
  return providedHash === expectedHash;
}
