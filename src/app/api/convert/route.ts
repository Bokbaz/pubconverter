import { NextResponse } from "next/server";
import { convertBatch } from "@/lib/conversion/engine";
import { encodeReportHeader, readConversionFormData } from "@/lib/http/formData";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const conversionRequest = await readConversionFormData(request);
    const result = await convertBatch(conversionRequest);

    return new Response(bufferToArrayBuffer(result.zipBuffer), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="publisher2x-results.zip"',
        "x-conversion-report": encodeReportHeader(result.report),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Conversion failed.",
      },
      { status: 500 },
    );
  }
}

function bufferToArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
