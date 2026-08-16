"use client";

export type AvdbPlaybackSession = {
  playbackUrl: string;
  expiresAt: number;
  provider: string | null;
  resolution?: string | null;
};

type SessionResponse = {
  ok: boolean;
  error?: string;
  failureType?: string;
  session?: AvdbPlaybackSession;
};

const STORAGE_PREFIX = "avdb:prepared-playback:";
const MIN_FRESH_MS = 10_000;
const memoryCache = new Map<string, AvdbPlaybackSession>();
const inflight = new Map<string, Promise<AvdbPlaybackSession | null>>();

function storageKey(catalogId: string) {
  return `${STORAGE_PREFIX}${catalogId}`;
}

function isFresh(session: AvdbPlaybackSession | null | undefined, marginMs = MIN_FRESH_MS) {
  return Boolean(session?.playbackUrl && Number(session.expiresAt) > Date.now() + marginMs);
}

function readStored(catalogId: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(catalogId));
    if (!raw) return null;
    const session = JSON.parse(raw) as AvdbPlaybackSession;
    if (!isFresh(session)) {
      window.sessionStorage.removeItem(storageKey(catalogId));
      return null;
    }
    memoryCache.set(catalogId, session);
    return session;
  } catch {
    return null;
  }
}

function storePrepared(catalogId: string, session: AvdbPlaybackSession) {
  memoryCache.set(catalogId, session);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(catalogId), JSON.stringify(session));
  } catch {
    // Memory cache remains available when browser storage is unavailable.
  }
}

export function clearPreparedAvdbPlayback(catalogId: string) {
  memoryCache.delete(catalogId);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(catalogId));
  } catch {
    // Ignore storage failures.
  }
}

export function getPreparedAvdbPlayback(catalogId: string, marginMs = MIN_FRESH_MS) {
  const cached = memoryCache.get(catalogId);
  if (isFresh(cached, marginMs)) return cached || null;
  if (cached) memoryCache.delete(catalogId);

  const stored = readStored(catalogId);
  return isFresh(stored, marginMs) ? stored : null;
}

export async function requestAvdbPlaybackSession(catalogId: string, forceFresh = false) {
  if (forceFresh) clearPreparedAvdbPlayback(catalogId);

  const response = await fetch("/api/avdb/playback/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalogId, forceFresh }),
    cache: "no-store",
  });
  const payload = (await response.json()) as SessionResponse;
  if (!response.ok || !payload.ok || !payload.session) {
    throw new Error(payload.error || "ยังเปิดวิดีโอไม่ได้");
  }

  storePrepared(catalogId, payload.session);
  return payload.session;
}

export function prewarmAvdbPlayback(catalogId: string) {
  const prepared = getPreparedAvdbPlayback(catalogId);
  if (prepared) return Promise.resolve(prepared);

  const current = inflight.get(catalogId);
  if (current) return current;

  const promise = requestAvdbPlaybackSession(catalogId)
    .then((session) => session)
    .catch(() => null)
    .finally(() => {
      if (inflight.get(catalogId) === promise) inflight.delete(catalogId);
    });

  inflight.set(catalogId, promise);
  return promise;
}
