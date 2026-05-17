// GET /api/stories/buffer-chain-tail
//
// Returns the latest scheduled_for date across ALL story posts so the
// publish panel can pre-fill the cover post date (tail + 1 day at 20:00
// local) and the Buffer chapter start date (tail + 2 days UTC).

import { NextResponse } from "next/server";
import { loadGlobalChainTail } from "@/lib/server/schedule-chain";

export async function GET() {
  const tail = await loadGlobalChainTail();
  return NextResponse.json({
    chainTailDate: tail?.toISOString() ?? null,
  });
}
