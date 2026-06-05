import { randomUUID } from "node:crypto";
import type { ConversionBatchReport, OutputMode, UploadInput } from "@/lib/conversion/types";
import { convertBatch } from "@/lib/conversion/engine";
import { sanitizeRelativePath } from "@/lib/conversion/files";
import { getSupabaseAdmin, isSupabaseConfigured, jobsEnabled, resultBucket, sourceBucket } from "./supabaseAdmin";

export type StoredJobStatus = "queued" | "processing" | "completed" | "failed";

export type StoredJob = {
  id: string;
  status: StoredJobStatus;
  modes: OutputMode[];
  source_prefix: string;
  result_path: string | null;
  report: ConversionBatchReport | null;
  error_message: string | null;
};

export function canUseSupabaseJobs() {
  return jobsEnabled() && isSupabaseConfigured();
}

export async function createJob(uploads: UploadInput[], modes: OutputMode[]) {
  if (!canUseSupabaseJobs()) {
    throw new Error("Supabase jobs are not enabled.");
  }

  const supabase = getSupabaseAdmin();
  const jobId = randomUUID();
  const sourcePrefix = `${jobId}/source`;
  const deleteAfterHours = Number(process.env.JOB_DELETE_AFTER_HOURS || 24);
  const deleteAfter = new Date(Date.now() + deleteAfterHours * 60 * 60 * 1000).toISOString();

  const fileRows = [];
  for (const upload of uploads) {
    const relativePath = sanitizeRelativePath(upload.relativePath);
    const storagePath = `${sourcePrefix}/${relativePath}`;
    const uploaded = await supabase.storage.from(sourceBucket()).upload(storagePath, upload.buffer, {
      contentType: upload.mimeType || "application/octet-stream",
      upsert: false,
    });

    if (uploaded.error) {
      throw uploaded.error;
    }

    fileRows.push({
      job_id: jobId,
      relative_path: relativePath,
      storage_path: storagePath,
      size_bytes: upload.size ?? upload.buffer.byteLength,
      mime_type: upload.mimeType ?? null,
    });
  }

  const inserted = await supabase
    .from("conversion_jobs")
    .insert({
      id: jobId,
      status: "queued",
      modes,
      source_prefix: sourcePrefix,
      original_file_count: uploads.length,
      delete_after: deleteAfter,
    })
    .select("*")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  if (fileRows.length > 0) {
    const filesInserted = await supabase.from("conversion_job_files").insert(fileRows);
    if (filesInserted.error) {
      throw filesInserted.error;
    }
  }

  if (process.env.RUN_SYNC_CONVERSION === "true") {
    await processJob(jobId);
    return getJob(jobId);
  }

  return inserted.data as StoredJob;
}

export async function getJob(jobId: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase.from("conversion_jobs").select("*").eq("id", jobId).single();
  if (result.error) {
    throw result.error;
  }
  return result.data as StoredJob;
}

export async function getJobDownloadUrl(job: StoredJob) {
  if (!job.result_path) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const signed = await supabase.storage.from(resultBucket()).createSignedUrl(job.result_path, 60 * 15);
  if (signed.error) {
    throw signed.error;
  }
  return signed.data.signedUrl;
}

export async function downloadJobResult(job: StoredJob) {
  if (!job.result_path) {
    throw new Error("No result is available for this job.");
  }

  const supabase = getSupabaseAdmin();
  const downloaded = await supabase.storage.from(resultBucket()).download(job.result_path);
  if (downloaded.error) {
    throw downloaded.error;
  }
  return Buffer.from(await downloaded.data.arrayBuffer());
}

export async function claimNextJob() {
  const supabase = getSupabaseAdmin();
  const selected = await supabase
    .from("conversion_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selected.error) {
    throw selected.error;
  }

  if (!selected.data) {
    return null;
  }

  const updated = await supabase
    .from("conversion_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", selected.data.id)
    .eq("status", "queued")
    .select("*")
    .single();

  if (updated.error) {
    return null;
  }

  return updated.data as StoredJob;
}

export async function processJob(jobId: string) {
  const supabase = getSupabaseAdmin();
  const job = await getJob(jobId);
  await supabase.from("conversion_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", jobId);

  try {
    const files = await supabase.from("conversion_job_files").select("*").eq("job_id", jobId);
    if (files.error) {
      throw files.error;
    }

    const uploads: UploadInput[] = [];
    for (const file of files.data ?? []) {
      const downloaded = await supabase.storage.from(sourceBucket()).download(file.storage_path);
      if (downloaded.error) {
        throw downloaded.error;
      }
      uploads.push({
        relativePath: file.relative_path,
        buffer: Buffer.from(await downloaded.data.arrayBuffer()),
        mimeType: file.mime_type ?? undefined,
        size: file.size_bytes ?? undefined,
      });
    }

    const converted = await convertBatch({
      uploads,
      modes: job.modes,
    });

    const resultPath = `${jobId}/publisher2x-results.zip`;
    const uploaded = await supabase.storage.from(resultBucket()).upload(resultPath, converted.zipBuffer, {
      contentType: "application/zip",
      upsert: true,
    });
    if (uploaded.error) {
      throw uploaded.error;
    }

    const update = await supabase
      .from("conversion_jobs")
      .update({
        status: "completed",
        result_path: resultPath,
        report: converted.report,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (update.error) {
      throw update.error;
    }
  } catch (error) {
    await supabase
      .from("conversion_jobs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    throw error;
  }
}
