import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expandUploads, sanitizeRelativePath, toOutputStem, zipPath } from "./files";
import { convertWithLibreOffice, resolveTool, runCommand } from "./process";
import { addError, addWarning, createEmptyBatchReport, createFileReport, renderMarkdownReport } from "./report";
import type { ConversionRequest, ConversionResult, OutputMode } from "./types";

export async function convertBatch(request: ConversionRequest): Promise<ConversionResult> {
  const modes = normalizeModes(request.modes);
  const sources = await expandUploads(request.uploads);
  const report = createEmptyBatchReport();
  const zip = new JSZip();

  if (sources.length === 0) {
    report.errors.push("No .pub files were found in the upload.");
    zip.file("conversion-report.md", renderMarkdownReport(report));
    zip.file("conversion-report.json", JSON.stringify(report, null, 2));
    return {
      zipBuffer: Buffer.from(await zip.generateAsync({ type: "uint8array" })),
      report,
    };
  }

  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "publisher2x-"));

  try {
    for (const source of sources) {
      const safeRelativePath = sanitizeRelativePath(source.relativePath);
      const sourcePath = path.join(workRoot, "source", safeRelativePath);
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, source.buffer);

      const fileReport = await convertPublisherFile({
        sourcePath,
        relativePath: safeRelativePath,
        modes,
        zip,
      });
      report.files.push(fileReport);
    }
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true });
  }

  report.warnings.push(
    "DOCX conversion is inherently lossy because Publisher is page-canvas based and Word is flow based. Review warnings before relying on editable output.",
  );
  zip.file("conversion-report.md", renderMarkdownReport(report));
  zip.file("conversion-report.json", JSON.stringify(report, null, 2));

  return {
    zipBuffer: Buffer.from(await zip.generateAsync({ type: "uint8array" })),
    report,
  };
}

async function convertPublisherFile(options: {
  sourcePath: string;
  relativePath: string;
  modes: OutputMode[];
  zip: JSZip;
}) {
  const report = createFileReport(options.relativePath);
  const outputStem = toOutputStem(options.relativePath);
  const outputRoot = path.join(path.dirname(options.sourcePath), ".converted", path.basename(options.sourcePath, ".pub"));
  await fs.mkdir(outputRoot, { recursive: true });

  let pdfPath: string | null = null;

  try {
    if (options.modes.includes("archive-pdf") || options.modes.includes("modern-bundle") || options.modes.includes("word-docx")) {
      pdfPath = await createPdf(options.sourcePath, outputRoot, report);
      await addFileToZip(options.zip, pdfPath, zipPath(outputStem, "archive", `${path.basename(outputStem)}.pdf`), report);
    }

    if (options.modes.includes("word-docx")) {
      await createDocx(options.sourcePath, pdfPath, outputRoot, outputStem, options.zip, report);
    }

    if (options.modes.includes("modern-bundle")) {
      await createModernBundle(pdfPath, outputRoot, outputStem, options.zip, report);
    }

    options.zip.file(
      zipPath(outputStem, "fidelity-report.json"),
      JSON.stringify(
        {
          sourcePath: options.relativePath,
          outputs: report.outputs,
          warnings: report.warnings,
          errors: report.errors,
          stats: report.stats,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    addError(report, error instanceof Error ? error.message : "Unknown conversion failure.");
    options.zip.file(zipPath(outputStem, "conversion-error.txt"), report.errors.join("\n"));
  }

  return report;
}

async function createPdf(sourcePath: string, outputRoot: string, report: ReturnType<typeof createFileReport>) {
  const filter = process.env.LIBREOFFICE_PDF_FILTER || "pdf";
  const pdfPath = await convertWithLibreOffice({
    inputPath: sourcePath,
    outputDir: outputRoot,
    target: filter,
    expectedExtension: "pdf",
  });

  report.stats.pagesDetected = Math.max(report.stats.pagesDetected, await detectPdfPageCount(pdfPath));
  addWarning(
    report,
    filter === "pdf"
      ? "PDF/A strict export was not forced. Set LIBREOFFICE_PDF_FILTER for a PDF/A profile if your LibreOffice build supports it."
      : "PDF export used the configured LibreOffice export filter.",
  );
  return pdfPath;
}

async function createDocx(
  sourcePath: string,
  pdfPath: string | null,
  outputRoot: string,
  outputStem: string,
  zip: JSZip,
  report: ReturnType<typeof createFileReport>,
) {
  const docxRoot = path.join(outputRoot, "docx");
  await fs.mkdir(docxRoot, { recursive: true });

  try {
    const directDocx = await convertWithLibreOffice({
      inputPath: sourcePath,
      outputDir: docxRoot,
      target: "docx",
      expectedExtension: "docx",
    });
    await addFileToZip(zip, directDocx, zipPath(outputStem, "word", `${path.basename(outputStem)}.docx`), report);
    addWarning(report, "DOCX was generated by LibreOffice. Compare the report and output because Publisher objects may shift in Word.");
    return;
  } catch (directError) {
    addWarning(
      report,
      `Direct PUB to DOCX conversion was not available from this LibreOffice build: ${errorMessage(directError)}`,
    );
  }

  if (!pdfPath) {
    addWarning(report, "DOCX fallback was skipped because no PDF render was available.");
    return;
  }

  try {
    const fallbackDocx = await convertWithLibreOffice({
      inputPath: pdfPath,
      outputDir: docxRoot,
      target: "docx",
      expectedExtension: "docx",
    });
    await addFileToZip(zip, fallbackDocx, zipPath(outputStem, "word", `${path.basename(outputStem)}.docx`), report);
    addWarning(report, "DOCX was generated from the PDF render. Text may be editable, but object structure can be flattened.");
  } catch (fallbackError) {
    addWarning(report, `PDF to DOCX fallback failed: ${errorMessage(fallbackError)}`);
    zip.file(
      zipPath(outputStem, "word", "DOCX-NOT-CREATED.txt"),
      [
        "A DOCX file could not be created by the installed LibreOffice build.",
        "The archive PDF is included and should be used as the visual source of truth.",
      ].join("\n"),
    );
  }
}

async function createModernBundle(
  pdfPath: string | null,
  outputRoot: string,
  outputStem: string,
  zip: JSZip,
  report: ReturnType<typeof createFileReport>,
) {
  if (!pdfPath) {
    addWarning(report, "Modern bundle export was skipped because no PDF render was available.");
    return;
  }

  await addFileToZip(zip, pdfPath, zipPath(outputStem, "modern", `${path.basename(outputStem)}.pdf`), report);

  const pdftocairo = await resolveTool(["pdftocairo"]);
  if (pdftocairo) {
    try {
      const svgPrefix = path.join(outputRoot, "modern-page");
      await runCommand(pdftocairo, ["-svg", pdfPath, `${svgPrefix}.svg`], { timeoutMs: 120000 });
      const svgPath = `${svgPrefix}.svg`;
      await addFileToZip(zip, svgPath, zipPath(outputStem, "modern", "page-1.svg"), report);
    } catch (error) {
      addWarning(report, `SVG export failed: ${errorMessage(error)}`);
    }
  } else {
    addWarning(report, "Poppler pdftocairo was not found, so SVG page export was skipped.");
  }

  const pdfimages = await resolveTool(["pdfimages"]);
  if (pdfimages) {
    try {
      const assetPrefix = path.join(outputRoot, "asset");
      await runCommand(pdfimages, ["-png", pdfPath, assetPrefix], { timeoutMs: 120000 });
      const entries = await fs.readdir(outputRoot);
      const assets = entries.filter((entry) => entry.startsWith("asset") && entry.toLowerCase().endsWith(".png"));
      report.stats.imagesExtracted = assets.length;
      for (const asset of assets) {
        await addFileToZip(zip, path.join(outputRoot, asset), zipPath(outputStem, "modern", "assets", asset), report);
      }
    } catch (error) {
      addWarning(report, `Asset extraction failed: ${errorMessage(error)}`);
    }
  } else {
    addWarning(report, "Poppler pdfimages was not found, so embedded image extraction was skipped.");
  }

  zip.file(
    zipPath(outputStem, "modern", "README.txt"),
    [
      "Modern-tool export bundle",
      "",
      "Use the PDF as the visual source of truth.",
      "Use SVG pages where available for editable canvas reconstruction.",
      "Use extracted PNG assets at their original PDF-rendered resolution.",
    ].join("\n"),
  );
}

async function addFileToZip(zip: JSZip, localPath: string, destinationPath: string, report: ReturnType<typeof createFileReport>) {
  const file = await fs.readFile(localPath);
  zip.file(destinationPath, file);
  report.outputs.push(destinationPath);
}

async function detectPdfPageCount(pdfPath: string) {
  const pdfinfo = await resolveTool(["pdfinfo"]);
  if (!pdfinfo) {
    return 0;
  }

  try {
    const result = await runCommand(pdfinfo, [pdfPath], { timeoutMs: 30000 });
    const match = result.stdout.match(/^Pages:\s+(\d+)/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function normalizeModes(modes: OutputMode[]) {
  const valid = new Set<OutputMode>(["archive-pdf", "word-docx", "modern-bundle"]);
  const normalized = modes.filter((mode): mode is OutputMode => valid.has(mode));
  return normalized.length > 0 ? normalized : (["archive-pdf"] satisfies OutputMode[]);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
