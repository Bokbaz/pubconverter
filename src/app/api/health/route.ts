import { NextResponse } from "next/server";
import { detectTools } from "@/lib/conversion/process";
import { isSupabaseConfigured, jobsEnabled } from "@/lib/storage/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  const converter = await detectTools();

  return NextResponse.json({
    ok: true,
    converter,
    jobs: {
      enabled: jobsEnabled(),
      supabaseConfigured: isSupabaseConfigured(),
    },
  });
}
