import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "any-convert-web", engine: "not-connected" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
