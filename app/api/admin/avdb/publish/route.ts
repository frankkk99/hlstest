import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-api";
import { unpublishAvdbCatalogItem } from "@/lib/avdb-catalog";
import { fetchAvdbLivePublishState, publishAvdbLiveItems } from "@/lib/avdb-live-publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const state = await fetchAvdbLivePublishState();
    return NextResponse.json({ ok: true, ...state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "อ่านสถานะ Publish ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบแอดมิน" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = String(body?.action || "publish").trim().toLowerCase();

    if (action === "publish") {
      const itemId = String(body?.itemId || "").trim();
      if (!itemId) throw new Error("ไม่พบ itemId");
      const result = await publishAvdbLiveItems({ itemIds: [itemId], limit: 1 });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "publish_batch") {
      const result = await publishAvdbLiveItems({ limit: body?.limit ?? 50 });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "unpublish") {
      const result = await unpublishAvdbCatalogItem({
        catalogId: body?.catalogId,
        stageItemId: body?.stageItemId,
      });
      return NextResponse.json(result);
    }

    throw new Error("action ต้องเป็น publish, publish_batch หรือ unpublish");
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Publish AVDB ไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
