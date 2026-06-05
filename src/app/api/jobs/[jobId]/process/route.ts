import { NextResponse } from "next/server";
import { processJob } from "@/lib/storage/jobStore";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CONVERSION_WORKER_TOKEN || token !== process.env.CONVERSION_WORKER_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;

  try {
    await processJob(jobId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Job processing failed.",
      },
      { status: 500 },
    );
  }
}
