export const ADMIN_SESSION_COOKIE = "hlshub_admin_session";

const BUILTIN_ADMIN_USERNAME = "ad1324";
const BUILTIN_PASSWORD_SALT = "hlshub-admin-ad1324-v1";
const BUILTIN_PASSWORD_HASH = "9908b89d9c46aed4a51414cc13a74d5d76748c6f47265d450257f77346d50715";
const BUILTIN_PASSWORD_ITERATIONS = 120_000;

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(value: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configuredCredentials() {
  const username = String(process.env.HLSHUB_ADMIN_USERNAME || "").trim();
  const password = String(process.env.HLSHUB_ADMIN_PASSWORD || process.env.HLSHUB_ADMIN_KEY || "");
  if (username && password) return { mode: "env" as const, username, password };
  return { mode: "builtin" as const, username: BUILTIN_ADMIN_USERNAME };
}

export async function createAdminSessionToken() {
  const credentials = configuredCredentials();
  if (credentials.mode === "env") {
    return sha256(`hlshub-admin-session:v2:${credentials.username}:${credentials.password}`);
  }
  return sha256(`hlshub-admin-session:v2:${credentials.username}:${BUILTIN_PASSWORD_HASH}`);
}

export async function verifyAdminCredentials(username: string, password: string) {
  const credentials = configuredCredentials();
  const providedUsername = String(username || "").trim();
  const providedPassword = String(password || "");
  if (!providedUsername || !providedPassword) return false;

  const [providedUserHash, expectedUserHash] = await Promise.all([
    sha256(providedUsername),
    sha256(credentials.username),
  ]);
  if (providedUserHash !== expectedUserHash) return false;

  if (credentials.mode === "env") {
    const [providedHash, expectedHash] = await Promise.all([
      sha256(providedPassword),
      sha256(credentials.password),
    ]);
    return providedHash === expectedHash;
  }

  const providedHash = await pbkdf2(providedPassword, BUILTIN_PASSWORD_SALT, BUILTIN_PASSWORD_ITERATIONS);
  return providedHash === BUILTIN_PASSWORD_HASH;
}

export async function verifyAdminPassword(password: string) {
  const credentials = configuredCredentials();
  return verifyAdminCredentials(credentials.username, password);
}
