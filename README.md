# Publisher2X

Publisher2X is a Vercel/Supabase-ready web tool for converting Microsoft Publisher `.pub` files into practical migration outputs:

- Archive PDF: a faithful PDF render for records and review.
- Word DOCX: an honest, best-effort editable Word export with fidelity warnings.
- Modern bundle: PDF, SVG where available, extracted image assets, and per-file reports for rebuilding in Canva, Affinity, Scribus, Inkscape, or similar tools.

The app is intentionally structured around a worker. Vercel serves the UI and API, Supabase stores private uploads/results and job state, and the worker runs LibreOffice, which includes libmspub support for Publisher import.

## What is included

- Drag-and-drop `.pub`, `.zip`, or whole folders.
- Batch processing with relative folder paths preserved in the returned ZIP.
- Three selectable output modes.
- Per-file fidelity report in the UI and inside the ZIP.
- Supabase-backed queue for production.
- Direct conversion endpoint for local testing or a server that has LibreOffice installed.
- Worker script plus Dockerfile with LibreOffice and Poppler installed.
- Private storage buckets and job tables.

## Important conversion note

Publisher is object-on-a-canvas. Word is text-in-a-flow. A perfect editable DOCX is not technically realistic for every file. Publisher2X treats the PDF render as the visual source of truth and makes the DOCX an honest editable attempt with warnings when the conversion path had to fall back.

## Local setup

1. Install Node.js 22 or newer.

2. Install dependencies.

```bash
npm install
```

3. Install LibreOffice.

Windows: install LibreOffice from the official installer, then set `LIBREOFFICE_PATH` if `soffice` is not on PATH.

macOS:

```bash
brew install --cask libreoffice
```

Linux:

```bash
sudo apt-get update
sudo apt-get install -y libreoffice poppler-utils
```

4. Copy environment values.

```bash
cp .env.example .env.local
```

5. For a simple local test without Supabase, keep:

```bash
SUPABASE_JOBS_ENABLED=false
```

6. Start the app.

```bash
npm run dev
```

7. Open `http://localhost:3000`, upload a `.pub` file, select output modes, and click Convert.

When Supabase jobs are disabled, the app falls back to `/api/convert` and returns a ZIP directly. This requires LibreOffice to be available to the server process.

## Supabase setup

1. Create a Supabase project.

2. Open SQL Editor and run:

```sql
-- paste the contents of supabase/schema.sql
```

This creates:

- `conversion_jobs`
- `conversion_job_files`
- private `publisher-sources` bucket
- private `publisher-results` bucket
- service-role-only RLS policies

3. In Project Settings, copy:

- Project URL
- Service role key

4. Add these to `.env.local` and to Vercel later:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_SOURCE_BUCKET=publisher-sources
SUPABASE_RESULT_BUCKET=publisher-results
SUPABASE_JOBS_ENABLED=true
RUN_SYNC_CONVERSION=false
CONVERSION_WORKER_TOKEN=replace-with-a-long-random-string
JOB_DELETE_AFTER_HOURS=24
```

## Worker setup

The worker processes queued jobs from Supabase. It must run in an environment that can install LibreOffice and Poppler.

### Option A: Docker

1. Build the worker image.

```bash
docker build -f Dockerfile.worker -t publisher2x-worker .
```

2. Run it with the same Supabase environment variables.

```bash
docker run --env-file .env.local publisher2x-worker
```

### Option B: Local process

1. Install LibreOffice and Poppler locally.

2. Run:

```bash
npm run worker
```

The worker polls `conversion_jobs` for queued jobs, downloads source files from Supabase Storage, converts them, uploads `publisher2x-results.zip`, and updates the report.

## Vercel deployment

1. Import the GitHub repo into Vercel.

2. Set the environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SOURCE_BUCKET
SUPABASE_RESULT_BUCKET
SUPABASE_JOBS_ENABLED=true
RUN_SYNC_CONVERSION=false
CONVERSION_WORKER_TOKEN
JOB_DELETE_AFTER_HOURS=24
```

3. Deploy.

4. Start the worker separately using Docker or another Node-capable host with LibreOffice installed.

Vercel should run the UI and queue API. The worker should run the native conversion pipeline.

## Privacy model

- Buckets are private.
- The browser never receives the Supabase service role key.
- Downloads are served through signed URLs or the app download endpoint.
- Jobs include `delete_after`; schedule a cleanup job to remove expired source and result files.
- Files are not used for any purpose other than conversion.

## Cleanup job

Run this periodically from a trusted environment:

```sql
delete from public.conversion_jobs
where delete_after < now();
```

Because `conversion_job_files` cascades on job deletion, database metadata is removed. Storage cleanup can be added with a small Supabase scheduled function or worker task that deletes the matching `job_id/` prefixes from both buckets before deleting the job row.

## Conversion pipeline details

Archive mode:

- LibreOffice imports `.pub` using libmspub.
- The app exports PDF.
- If your LibreOffice build supports a PDF/A filter, set `LIBREOFFICE_PDF_FILTER`.

Word mode:

- The app first attempts direct `.pub` to `.docx`.
- If unavailable, it attempts PDF render to DOCX.
- The ZIP report flags the fallback because PDF-to-Word often flattens structure.

Modern bundle:

- The PDF render is included.
- If Poppler `pdftocairo` is available, an SVG page export is included.
- If Poppler `pdfimages` is available, image assets are extracted.

## Useful commands

```bash
npm run dev
npm run build
npm run typecheck
npm run worker
```

## Roadmap

- Add authenticated accounts and billing.
- Add visual preview images and diff overlays as first-class stored artifacts.
- Add cleanup automation for expired storage prefixes.
- Add font detection and missing-font reporting.
- Add a desktop/offline build for sensitive documents.
