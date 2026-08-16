import { createClient } from "@supabase/supabase-js";
import { createAvdbRun } from "@/lib/avdb-staging";

const MAX_SOURCE_PAGE = 10262;

function getConfig() {
  return {
    url:
      process.env.HLSHUB_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "https://qlunnckudeynhruxzpnb.supabase.co",
    key: process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function db() {
  const config = getConfig();
  if (!config.key) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");
  return createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getAvdbIncrementalState() {
  const client = db();
  const [lastItem, latestRun] = await Promise.all([
    client
      .from("avdb_stage_items")
      .select("source_page,updated_at")
      .eq("source", "avdbapi")
      .not("source_page", "is", null)
      .order("source_page", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("avdb_stage_runs")
      .select("id,status,start_page,end_page,current_page,checkpoint_page,pages_scanned,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (lastItem.error) throw new Error(lastItem.error.message);
  if (latestRun.error) throw new Error(latestRun.error.message);

  const highestSourcePage = Math.max(0, Number(lastItem.data?.source_page || 0));
  const nextPage = Math.min(MAX_SOURCE_PAGE, Math.max(1, highestSourcePage + 1));
  const run = latestRun.data || null;
  const active = Boolean(run && ["queued", "running", "paused"].includes(String(run.status)));

  return {
    highestSourcePage,
    nextPage,
    maxSourcePage: MAX_SOURCE_PAGE,
    remainingPages: Math.max(0, MAX_SOURCE_PAGE - highestSourcePage),
    active,
    latestRun: run,
  };
}

export async function createAvdbIncrementalRun(input: {
  count?: unknown;
  startPage?: unknown;
  endPage?: unknown;
  concurrency?: unknown;
  retryLimit?: unknown;
}) {
  const state = await getAvdbIncrementalState();
  if (state.active) throw new Error("มี AVDB run ที่ยังทำงานหรือ Pause อยู่ กรุณาจบ/Resume run เดิมก่อน");

  const requestedCount = Math.max(1, Math.min(500, Number.parseInt(String(input.count ?? "50"), 10) || 50));
  const explicitStart = Number.parseInt(String(input.startPage ?? ""), 10);
  const explicitEnd = Number.parseInt(String(input.endPage ?? ""), 10);
  const startPage = Number.isFinite(explicitStart)
    ? Math.max(1, Math.min(MAX_SOURCE_PAGE, explicitStart))
    : state.nextPage;
  const endPage = Number.isFinite(explicitEnd)
    ? Math.max(startPage, Math.min(MAX_SOURCE_PAGE, explicitEnd))
    : Math.min(MAX_SOURCE_PAGE, startPage + requestedCount - 1);

  if (startPage > MAX_SOURCE_PAGE || state.remainingPages <= 0) {
    throw new Error("ดึงครบช่วง AVDB ที่กำหนดแล้ว");
  }

  const run = await createAvdbRun({
    startPage,
    endPage,
    concurrency: input.concurrency ?? 1,
    retryLimit: input.retryLimit ?? 2,
  });

  return {
    run,
    startPage,
    endPage,
    pagesRequested: endPage - startPage + 1,
    previousHighestSourcePage: state.highestSourcePage,
  };
}
