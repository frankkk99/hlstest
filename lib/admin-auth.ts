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

function optionalEnvCredentials() {
  const username = String(process.env.HLSHUB_ADMIN_USERNAME || "").trim();
  const password = String(process.env.HLSHUB_ADMIN_PASSWORD || process.env.HLSHUB_ADMIN_KEY || "");
  return username && password ? { username, password } : null;
}

function sessionSecret() {
  return String(
    process.env.HLSHUB_ADMIN_SESSION_SECRET ||
    process.env.HLSHUB_ADMIN_PASSWORD ||
    process.env.HLSHUB_ADMIN_KEY ||
    BUILTIN_PASSWORD_HASH,
  );
}

export async function createAdminSessionToken() {
  return sha256(`hlshub-admin-session:v2:${sessionSecret()}`);
}

export async function verifyAdminCredentials(username: string, password: string) {
  const providedUsername = String(username || "").trim();
  const providedPassword = String(password || "");
  if (!providedUsername || !providedPassword) return false;

  const [providedUserHash, builtinUserHash] = await Promise.all([
    sha256(providedUsername),
    sha256(BUILTIN_ADMIN_USERNAME),
  ]);

  if (providedUserHash === builtinUserHash) {
    const providedHash = await pbkdf2(providedPassword, BUILTIN_PASSWORD_SALT, BUILTIN_PASSWORD_ITERATIONS);
    if (providedHash === BUILTIN_PASSWORD_HASH) return true;
  }

  const envCredentials = optionalEnvCredentials();
  if (!envCredentials) return false;

  const [envProvidedUserHash, envExpectedUserHash, providedPasswordHash, expectedPasswordHash] = await Promise.all([
    sha256(providedUsername),
    sha256(envCredentials.username),
    sha256(providedPassword),
    sha256(envCredentials.password),
  ]);
  return envProvidedUserHash === envExpectedUserHash && providedPasswordHash === expectedPasswordHash;
}

export async function verifyAdminPassword(password: string) {
  return verifyAdminCredentials(BUILTIN_ADMIN_USERNAME, password);
}
