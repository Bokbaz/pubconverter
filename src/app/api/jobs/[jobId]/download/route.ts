import { NextResponse } from "next/server";
import { downloadJobResult, getJob } from "@/lib/storage/jobStore";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  try {
    const job = await getJob(jobId);
    const buffer = await downloadJobResult(job);
    return new Response(bufferToArrayBuffer(buffer), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="publisher2x-results.zip"',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Result was not found.",
      },
      { status: 404 },
    );
  }
}

function bufferToArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
