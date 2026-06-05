import type { OutputMode, UploadInput } from "@/lib/conversion/types";

export async function readConversionFormData(request: Request): Promise<{
  uploads: UploadInput[];
  modes: OutputMode[];
}> {
  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  const paths = formData.getAll("paths").map((item) => String(item));
  const modes = parseModes(formData.get("modes"));

  const uploads: UploadInput[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    uploads.push({
      relativePath: paths[index] || file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      size: file.size,
    });
  }

  return { uploads, modes };
}

export function encodeReportHeader(report: unknown) {
  const json = JSON.stringify(report);
  return Buffer.from(json).toString("base64");
}

function parseModes(value: FormDataEntryValue | null): OutputMode[] {
  if (!value) {
    return ["archive-pdf"];
  }

  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) {
      return parsed as OutputMode[];
    }
  } catch {
    return ["archive-pdf"];
  }

  return ["archive-pdf"];
}
