import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function getDb() {
  const url =
    process.env.HLSHUB_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "https://qlunnckudeynhruxzpnb.supabase.co";
  const key = process.env.HLSHUB_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า HLSHUB_SUPABASE_SERVICE_ROLE_KEY");
  client ??= createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

async function countByStatus(db: SupabaseClient, status: string) {
  const response = await db
    .from("avdb_stage_items")
    .select("id", { count: "exact", head: true })
    .eq("source", "avdbapi")
    .eq("player_status", status);
  if (response.error) throw new Error(response.error.message);
  return response.count || 0;
}

export async function fetchAvdbPlayerState() {
  const db = getDb();
  const [pending, checking, ready, failed, blocked, recentResponse, runResponse] = await Promise.all([
    countByStatus(db, "unverified"),
    countByStatus(db, "checking"),
    countByStatus(db, "ready"),
    countByStatus(db, "failed"),
    countByStatus(db, "blocked"),
    db
      .from("avdb_stage_items")
      .select(
        "id,run_id,movie_code,title,player_page_url,player_provider,player_status,stage_status,verified_media_url,player_checked_at,player_failure_type,last_error,updated_at",
      )
      .eq("source", "avdbapi")
      .order("updated_at", { ascending: false })
      .limit(16),
    db
      .from("avdb_stage_runs")
      .select("id,status,current_page,end_page")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (recentResponse.error) throw new Error(recentResponse.error.message);
  if (runResponse.error) throw new Error(runResponse.error.message);

  const run = runResponse.data || null;
  const crawlerActive = Boolean(run && ["queued", "running"].includes(String(run.status)));

  return {
    stats: { pending, checking, ready, failed, blocked },
    recent: recentResponse.data || [],
    latestRun: run,
    crawlerActive,
  };
}
