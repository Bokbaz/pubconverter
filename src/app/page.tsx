"use client";

import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  FolderUp,
  Loader2,
  RefreshCcw,
  Upload,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

type OutputMode = "archive-pdf" | "word-docx" | "modern-bundle";

type Health = {
  ok: boolean;
  converter: {
    libreOffice: boolean;
    poppler: boolean;
  };
  jobs: {
    enabled: boolean;
    supabaseConfigured: boolean;
  };
};

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "completed" | "failed";

type JobFileReport = {
  sourcePath: string;
  status: "completed" | "failed";
  outputs: string[];
  stats: {
    textBoxesPreserved: number;
    imagesExtracted: number;
    pagesDetected: number;
    warnings: number;
  };
  warnings: string[];
  errors: string[];
};

type BatchReport = {
  generatedAt: string;
  files: JobFileReport[];
  warnings: string[];
  errors: string[];
};

type QueueJobResponse = {
  jobId: string;
  status: JobStatus;
  report?: BatchReport | null;
};

type PickedFile = {
  file: File;
  relativePath: string;
};

const modeOptions: Array<{
  id: OutputMode;
  label: string;
  detail: string;
  icon: typeof Archive;
}> = [
  {
    id: "archive-pdf",
    label: "Archive PDF",
    detail: "Faithful PDF output for records and review.",
    icon: Archive,
  },
  {
    id: "word-docx",
    label: "Word DOCX",
    detail: "Attempts a layout-preserving editable Word file.",
    icon: FileText,
  },
  {
    id: "modern-bundle",
    label: "Modern bundle",
    detail: "SVG/PDF/assets/report package for design tools.",
    icon: FileArchive,
  },
];

export default function Home() {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [selectedModes, setSelectedModes] = useState<OutputMode[]>(["archive-pdf"]);
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [message, setMessage] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const pubCount = useMemo(
    () => files.filter((item) => item.relativePath.toLowerCase().endsWith(".pub")).length,
    [files],
  );

  const zipCount = useMemo(
    () => files.filter((item) => item.relativePath.toLowerCase().endsWith(".zip")).length,
    [files],
  );

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => {
        setHealth(null);
      });
  }, []);

  useEffect(() => {
    if (!jobId || status === "completed" || status === "failed") {
      return;
    }

    const timer = window.setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) {
        return;
      }

      const data = (await res.json()) as QueueJobResponse & {
        downloadUrl?: string;
        error?: string;
      };
      setStatus(data.status);
      setReport(data.report ?? null);

      if (data.status === "completed") {
        setDownloadUrl(data.downloadUrl ?? `/api/jobs/${jobId}/download`);
        setMessage("Conversion complete. The download preserves the uploaded folder structure.");
      }

      if (data.status === "failed") {
        setMessage(data.error ?? "Conversion failed. Check the report for details.");
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [jobId, status]);

  function toggleMode(mode: OutputMode) {
    setSelectedModes((current) => {
      if (current.includes(mode)) {
        return current.length === 1 ? current : current.filter((item) => item !== mode);
      }
      return [...current, mode];
    });
  }

  function addFiles(fileList: FileList | File[]) {
    const next = Array.from(fileList).map((file) => ({
      file,
      relativePath: extractRelativePath(file),
    }));

    setFiles((current) => {
      const seen = new Set(current.map((item) => `${item.relativePath}:${item.file.size}`));
      const merged = [...current];
      for (const item of next) {
        const key = `${item.relativePath}:${item.file.size}`;
        if (!seen.has(key)) {
          merged.push(item);
          seen.add(key);
        }
      }
      return merged;
    });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      addFiles(event.target.files);
      event.target.value = "";
    }
  }

  async function startConversion() {
    if (files.length === 0) {
      setMessage("Add at least one .pub file, a folder, or a .zip archive first.");
      return;
    }

    setStatus("uploading");
    setMessage("Uploading files and preparing the conversion job.");
    setDownloadUrl(null);
    setReport(null);

    const formData = new FormData();
    for (const item of files) {
      formData.append("files", item.file, item.file.name);
      formData.append("paths", item.relativePath);
    }
    formData.append("modes", JSON.stringify(selectedModes));

    try {
      const queued = await fetch("/api/jobs", {
        method: "POST",
        body: formData,
      });

      if (queued.status === 412) {
        await runDirectConversion(formData);
        return;
      }

      if (!queued.ok) {
        const error = await queued.json().catch(() => null);
        throw new Error(error?.error ?? "Could not create the conversion job.");
      }

      const data = (await queued.json()) as QueueJobResponse & { downloadUrl?: string };
      setJobId(data.jobId);
      setStatus(data.status);
      setReport(data.report ?? null);
      setMessage(
        data.status === "completed"
          ? "Conversion complete."
          : "Job queued. The worker will process it and this page will update automatically.",
      );
      if (data.downloadUrl) {
        setDownloadUrl(data.downloadUrl);
      }
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Conversion failed.");
    }
  }

  async function runDirectConversion(formData: FormData) {
    setStatus("processing");
    setMessage("Running direct conversion on this server.");

    const res = await fetch("/api/convert", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw new Error(error?.error ?? "Direct conversion failed.");
    }

    const reportHeader = res.headers.get("x-conversion-report");
    if (reportHeader) {
      try {
        setReport(JSON.parse(atob(reportHeader)));
      } catch {
        setReport(null);
      }
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setStatus("completed");
    setMessage("Conversion complete. Download the ZIP package below.");
  }

  function reset() {
    setFiles([]);
    setStatus("idle");
    setMessage("");
    setJobId(null);
    setDownloadUrl(null);
    setReport(null);
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Tool status">
        <div>
          <p className="eyebrow">Publisher2X</p>
          <h1>Convert Microsoft Publisher files</h1>
        </div>
        <div className="health-strip">
          <HealthPill label="LibreOffice" ok={Boolean(health?.converter.libreOffice)} />
          <HealthPill label="Poppler" ok={Boolean(health?.converter.poppler)} />
          <HealthPill label="Supabase jobs" ok={Boolean(health?.jobs.enabled && health.jobs.supabaseConfigured)} />
        </div>
      </section>

      <section className="workspace">
        <div className="panel upload-panel">
          <div
            className={`dropzone ${dragActive ? "dropzone-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <Upload aria-hidden="true" />
            <div>
              <h2>Drop PUB files, folders, or ZIP archives</h2>
              <p>Folder paths are preserved in the final ZIP.</p>
            </div>
            <div className="drop-actions">
              <button className="button secondary" type="button" onClick={() => fileInput.current?.click()}>
                <Upload aria-hidden="true" />
                Files
              </button>
              <button className="button secondary" type="button" onClick={() => folderInput.current?.click()}>
                <FolderUp aria-hidden="true" />
                Folder
              </button>
            </div>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              multiple
              accept=".pub,.zip,application/zip"
              onChange={onFileInput}
            />
            <input
              ref={folderInput}
              className="visually-hidden"
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is supported by Chromium/WebKit for folder upload.
              webkitdirectory=""
              onChange={onFileInput}
            />
          </div>

          <div className="mode-grid" aria-label="Output modes">
            {modeOptions.map((mode) => {
              const Icon = mode.icon;
              const checked = selectedModes.includes(mode.id);
              return (
                <button
                  type="button"
                  key={mode.id}
                  className={`mode-card ${checked ? "mode-card-selected" : ""}`}
                  onClick={() => toggleMode(mode.id)}
                  aria-pressed={checked}
                >
                  <Icon aria-hidden="true" />
                  <span>{mode.label}</span>
                  <small>{mode.detail}</small>
                </button>
              );
            })}
          </div>

          <div className="action-row">
            <button className="button primary" type="button" onClick={startConversion} disabled={status === "uploading" || status === "processing"}>
              {status === "uploading" || status === "processing" ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
              Convert
            </button>
            <button className="button ghost" type="button" onClick={reset}>
              Clear
            </button>
          </div>

          {message ? <p className={`message ${status === "failed" ? "message-error" : ""}`}>{message}</p> : null}
        </div>

        <aside className="panel queue-panel" aria-label="Batch queue">
          <div className="queue-summary">
            <div>
              <span className="metric">{files.length}</span>
              <small>Total files</small>
            </div>
            <div>
              <span className="metric">{pubCount}</span>
              <small>PUB files</small>
            </div>
            <div>
              <span className="metric">{zipCount}</span>
              <small>ZIP archives</small>
            </div>
          </div>

          <div className="file-list">
            {files.length === 0 ? (
              <p className="empty">No files selected.</p>
            ) : (
              files.slice(0, 12).map((item) => (
                <div className="file-row" key={`${item.relativePath}:${item.file.size}`}>
                  <FileText aria-hidden="true" />
                  <span>{item.relativePath}</span>
                  <small>{formatBytes(item.file.size)}</small>
                </div>
              ))
            )}
            {files.length > 12 ? <p className="empty">+{files.length - 12} more files</p> : null}
          </div>
        </aside>
      </section>

      <section className="results">
        <div className="panel report-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Fidelity report</p>
              <h2>Conversion findings</h2>
            </div>
            <StatusBadge status={status} />
          </div>

          <ReportView report={report} />
        </div>

        <div className="panel preview-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Visual review</p>
              <h2>Before and after</h2>
            </div>
          </div>
          <div className="preview-grid">
            <div className="preview-box">
              <span>Original render</span>
              <p>Preview images appear when the worker has Poppler available.</p>
            </div>
            <div className="preview-box">
              <span>Converted output</span>
              <p>Warnings flag files that need manual review.</p>
            </div>
          </div>
          {downloadUrl ? (
            <a className="button download" href={downloadUrl} download="publisher2x-results.zip">
              <Download aria-hidden="true" />
              Download ZIP
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`health-pill ${ok ? "health-ok" : "health-warn"}`}>
      {ok ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}

function ReportView({ report }: { report: BatchReport | null }) {
  if (!report) {
    return <p className="empty">Run a conversion to generate a per-file report.</p>;
  }

  return (
    <div className="report-list">
      {report.files.map((file) => (
        <article className="report-row" key={file.sourcePath}>
          <div className="report-title">
            {file.status === "completed" ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            <strong>{file.sourcePath}</strong>
          </div>
          <div className="report-metrics">
            <span>{file.stats.textBoxesPreserved} text boxes</span>
            <span>{file.stats.imagesExtracted} images</span>
            <span>{file.stats.pagesDetected} pages</span>
            <span>{file.stats.warnings} warnings</span>
          </div>
          {file.warnings.length > 0 ? (
            <ul className="warning-list">
              {file.warnings.slice(0, 3).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
      {report.warnings.length > 0 ? (
        <p className="message">{report.warnings.length} batch-level warning(s) were added to the ZIP report.</p>
      ) : null}
    </div>
  );
}

function extractRelativePath(file: File) {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || file.name;
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
