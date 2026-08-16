import { NextRequest, NextResponse } from "next/server";
import { scanAvdbPage } from "@/lib/avdb-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pageUrl = String(body?.pageUrl || "").trim();
    const result = await scanAvdbPage(pageUrl);
    const { responseStatus, ...payload } = result;
    return NextResponse.json(payload, { status: responseStatus });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "AVDB scan failed",
        stage: "browser-or-avdb",
      },
      { status: 500 },
    );
  }
}
