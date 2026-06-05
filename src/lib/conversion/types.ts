export type OutputMode = "archive-pdf" | "word-docx" | "modern-bundle";

export type UploadInput = {
  relativePath: string;
  buffer: Buffer;
  mimeType?: string;
  size?: number;
};

export type ConversionRequest = {
  uploads: UploadInput[];
  modes: OutputMode[];
};

export type ConversionFileReport = {
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

export type ConversionBatchReport = {
  generatedAt: string;
  files: ConversionFileReport[];
  warnings: string[];
  errors: string[];
};

export type ConversionResult = {
  zipBuffer: Buffer;
  report: ConversionBatchReport;
};

export type ToolAvailability = {
  libreOffice: boolean;
  poppler: boolean;
};
