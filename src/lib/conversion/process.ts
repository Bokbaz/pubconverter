import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolAvailability } from "./types";

type CommandResult = {
  stdout: string;
  stderr: string;
};

const defaultTimeout = Number(process.env.LIBREOFFICE_TIMEOUT_MS ?? 180000);

export async function detectTools(): Promise<ToolAvailability> {
  const libreOffice = await resolveLibreOffice();
  const poppler = await resolveTool(["pdftoppm", "pdftocairo", "pdfimages"]);

  return {
    libreOffice: Boolean(libreOffice),
    poppler: Boolean(poppler),
  };
}

export async function resolveLibreOffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ].filter(Boolean) as string[];

  return resolveTool(candidates);
}

export async function resolveTool(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await runCommand(candidate, ["--version"], { timeoutMs: 8000 });
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

export async function convertWithLibreOffice(options: {
  inputPath: string;
  outputDir: string;
  target: string;
  expectedExtension: string;
  timeoutMs?: number;
}) {
  const libreOffice = await resolveLibreOffice();
  if (!libreOffice) {
    throw new Error("LibreOffice was not found. Install LibreOffice or set LIBREOFFICE_PATH.");
  }

  await fs.mkdir(options.outputDir, { recursive: true });

  const args = [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--nolockcheck",
    "--convert-to",
    options.target,
    "--outdir",
    options.outputDir,
    options.inputPath,
  ];

  await runCommand(libreOffice, args, {
    timeoutMs: options.timeoutMs ?? defaultTimeout,
  });

  const baseName = path.basename(options.inputPath, path.extname(options.inputPath));
  const expected = path.join(options.outputDir, `${baseName}.${options.expectedExtension}`);
  if (await fileExists(expected)) {
    return expected;
  }

  const entries = await fs.readdir(options.outputDir);
  const match = entries.find((entry) => entry.toLowerCase().endsWith(`.${options.expectedExtension.toLowerCase()}`));
  if (!match) {
    throw new Error(`LibreOffice completed without creating a .${options.expectedExtension} file.`);
  }

  return path.join(options.outputDir, match);
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    cwd?: string;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = windowlessTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out.`));
    }, options.timeoutMs ?? defaultTimeout);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function windowlessTimeout(callback: () => void, timeoutMs: number) {
  return setTimeout(callback, timeoutMs);
}
