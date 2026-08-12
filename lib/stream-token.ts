import { createHmac, timingSafeEqual } from "node:crypto";

export type StreamTokenPayload = {
  url: string;
  origin: string;
  referer: string;
  userAgent: string;
  cookie: string;
  expiresAt: number;
};

function secret() {
  return process.env.HLSHUB_STREAM_TOKEN_SECRET || process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || "";
}

function encodePart(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string) {
  const key = secret();
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า stream token secret");
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function createStreamToken(payload: StreamTokenPayload) {
  const body = encodePart(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function readStreamToken(token: string): StreamTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || !secret()) return null;

  const expected = sign(body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StreamTokenPayload;
    if (!payload.url || !payload.expiresAt || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
