"use client";

import { useEffect, useRef } from "react";

type WorkerState = {
  ok?: boolean;
  crawlerConnected?: boolean;
  latestRun?: {
    id: string;
    status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
    current_page: number;
  } | null;
};

const LOCK_KEY = "hlstest:avdb-worker-lock";
const LOCK_TTL_MS = 90_000;
const POLL_MS = 1_200;

function tabId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function readLock() {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { owner?: string; expiresAt?: number };
    if (!parsed?.owner || !Number.isFinite(parsed?.expiresAt)) return null;
    return { owner: parsed.owner, expiresAt: Number(parsed.expiresAt) };
  } catch {
    return null;
  }
}

function writeLock(owner: string) {
  const expiresAt = Date.now() + LOCK_TTL_MS;
  try {
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ owner, expiresAt }));
  } catch {
    // A single tab still remains serialized by busyRef even without localStorage.
  }
  return expiresAt;
}

function claimLock(owner: string) {
  const lock = readLock();
  if (lock && lock.owner !== owner && lock.expiresAt > Date.now()) return false;
  writeLock(owner);
  return true;
}

function releaseLock(owner: string) {
  try {
    const lock = readLock();
    if (!lock || lock.owner === owner) window.localStorage.removeItem(LOCK_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export default function AvdbWorkerDriver() {
  const ownerRef = useRef("");
  const busyRef = useRef(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    ownerRef.current = tabId();
    stoppedRef.current = false;

    async function tick() {
      if (stoppedRef.current || busyRef.current) return;
      busyRef.current = true;

      try {
        const stateResponse = await fetch("/api/admin/avdb", { cache: "no-store" });
        if (!stateResponse.ok) return;
        const state = (await stateResponse.json()) as WorkerState;
        const run = state.latestRun;
        const active = Boolean(run && ["queued", "running"].includes(run.status));

        if (!state.crawlerConnected || !run || !active) {
          releaseLock(ownerRef.current);
          return;
        }

        if (!claimLock(ownerRef.current)) return;
        writeLock(ownerRef.current);

        const stepResponse = await fetch("/api/admin/avdb/run/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.id }),
        });

        // A failed page is deliberately paused by the server. Do not loop on it.
        if (!stepResponse.ok) {
          releaseLock(ownerRef.current);
          return;
        }

        writeLock(ownerRef.current);
      } catch {
        // Admin UI polling will surface the server-side error/log. Keep the driver quiet.
      } finally {
        busyRef.current = false;
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    const heartbeat = window.setInterval(() => {
      if (busyRef.current) writeLock(ownerRef.current);
    }, 15_000);

    return () => {
      stoppedRef.current = true;
      window.clearInterval(timer);
      window.clearInterval(heartbeat);
      releaseLock(ownerRef.current);
    };
  }, []);

  return null;
}
