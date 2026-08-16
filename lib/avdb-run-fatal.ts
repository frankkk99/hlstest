import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function db() {
  const url =
    process.env.HLSHUB_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return null;
  client ??= createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || "AVDB worker exception");
}

export async function captureAvdbRunFatal(runIdRaw: unknown, error: unknown) {
  const database = db();
  const runId = String(runIdRaw || "").trim();
  const message = messageOf(error).slice(0, 1800);
  if (!database || !runId) return;

  const current = await database
    .from("avdb_stage_runs")
    .select("id,status,current_page,failed_count,metadata")
    .eq("id", runId)
    .maybeSingle();
  if (current.error || !current.data) return;
  if (!["queued", "running"].includes(String(current.data.status))) return;

  const now = new Date().toISOString();
  const failedCount = Number(current.data.failed_count || 0) + 1;
  const metadata = {
    ...(current.data.metadata || {}),
    worker_fatal_at: now,
    worker_fatal_message: message,
  };

  await database
    .from("avdb_stage_runs")
    .update({
      status: "paused",
      failed_count: failedCount,
      last_error: message,
      paused_at: now,
      metadata,
      updated_at: now,
    })
    .eq("id", runId)
    .in("status", ["queued", "running"]);

  await database.from("avdb_stage_logs").insert({
    run_id: runId,
    level: "error",
    step: "worker-fatal",
    message: `Worker exception ที่หน้า ${current.data.current_page}: ${message}`,
    context: {
      currentPage: current.data.current_page,
      error: message,
    },
  });
}
