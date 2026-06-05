import { NextResponse } from "next/server";
import { getJob, getJobDownloadUrl } from "@/lib/storage/jobStore";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  try {
    const job = await getJob(jobId);
    const downloadUrl = job.status === "completed" ? await getJobDownloadUrl(job) : null;
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      report: job.report,
      error: job.error_message,
      downloadUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Job was not found.",
      },
      { status: 404 },
    );
  }
}
