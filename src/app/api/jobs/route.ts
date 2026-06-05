import { NextResponse } from "next/server";
import { readConversionFormData } from "@/lib/http/formData";
import { canUseSupabaseJobs, createJob, getJobDownloadUrl } from "@/lib/storage/jobStore";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!canUseSupabaseJobs()) {
    return NextResponse.json(
      {
        error: "Supabase jobs are not configured. Falling back to direct conversion.",
      },
      { status: 412 },
    );
  }

  try {
    const conversionRequest = await readConversionFormData(request);
    const job = await createJob(conversionRequest.uploads, conversionRequest.modes);
    const downloadUrl = job.status === "completed" ? await getJobDownloadUrl(job) : null;

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        report: job.report,
        downloadUrl,
      },
      { status: job.status === "completed" ? 200 : 202 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not create job.",
      },
      { status: 500 },
    );
  }
}
