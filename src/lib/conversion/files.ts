import path from "node:path";
import JSZip from "jszip";
import type { UploadInput } from "./types";

export type NormalizedSource = {
  relativePath: string;
  buffer: Buffer;
};

export function sanitizeRelativePath(input: string) {
  const withoutDrive = input.replace(/^[a-zA-Z]:/, "");
  const normalized = withoutDrive.replace(/\\/g, "/").split("/").filter(Boolean);
  const safeParts = normalized.filter((part) => part !== "." && part !== "..");
  return safeParts.join("/") || "upload.pub";
}

export function toOutputStem(relativePath: string) {
  const parsed = path.posix.parse(sanitizeRelativePath(relativePath));
  return path.posix.join(parsed.dir, parsed.name);
}

export async function expandUploads(uploads: UploadInput[]): Promise<NormalizedSource[]> {
  const expanded: NormalizedSource[] = [];

  for (const upload of uploads) {
    const safePath = sanitizeRelativePath(upload.relativePath);
    if (safePath.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(upload.buffer);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      for (const entry of entries) {
        const entryPath = sanitizeRelativePath(entry.name);
        if (entryPath.toLowerCase().endsWith(".pub")) {
          expanded.push({
            relativePath: entryPath,
            buffer: Buffer.from(await entry.async("uint8array")),
          });
        }
      }
      continue;
    }

    if (safePath.toLowerCase().endsWith(".pub")) {
      expanded.push({
        relativePath: safePath,
        buffer: upload.buffer,
      });
    }
  }

  return expanded;
}

export function zipPath(...parts: string[]) {
  return parts
    .join("/")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
}
