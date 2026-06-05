import type { ConversionBatchReport, ConversionFileReport } from "./types";

export function createEmptyBatchReport(): ConversionBatchReport {
  return {
    generatedAt: new Date().toISOString(),
    files: [],
    warnings: [],
    errors: [],
  };
}

export function createFileReport(sourcePath: string): ConversionFileReport {
  return {
    sourcePath,
    status: "completed",
    outputs: [],
    stats: {
      textBoxesPreserved: 0,
      imagesExtracted: 0,
      pagesDetected: 0,
      warnings: 0,
    },
    warnings: [],
    errors: [],
  };
}

export function addWarning(report: ConversionFileReport, warning: string) {
  report.warnings.push(warning);
  report.stats.warnings = report.warnings.length;
}

export function addError(report: ConversionFileReport, error: string) {
  report.errors.push(error);
  report.status = "failed";
}

export function renderMarkdownReport(report: ConversionBatchReport) {
  const lines = [
    "# Publisher2X Conversion Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Batch Summary",
    "",
    `Files processed: ${report.files.length}`,
    `Batch warnings: ${report.warnings.length}`,
    `Batch errors: ${report.errors.length}`,
    "",
  ];

  for (const warning of report.warnings) {
    lines.push(`- Warning: ${warning}`);
  }

  for (const error of report.errors) {
    lines.push(`- Error: ${error}`);
  }

  lines.push("", "## File Results", "");

  for (const file of report.files) {
    lines.push(`### ${file.sourcePath}`, "");
    lines.push(`Status: ${file.status}`);
    lines.push(`Outputs: ${file.outputs.length ? file.outputs.join(", ") : "none"}`);
    lines.push(`Text boxes preserved: ${file.stats.textBoxesPreserved}`);
    lines.push(`Images extracted: ${file.stats.imagesExtracted}`);
    lines.push(`Pages detected: ${file.stats.pagesDetected}`);

    if (file.warnings.length > 0) {
      lines.push("", "Warnings:");
      for (const warning of file.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    if (file.errors.length > 0) {
      lines.push("", "Errors:");
      for (const error of file.errors) {
        lines.push(`- ${error}`);
      }
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
