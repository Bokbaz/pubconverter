import { claimNextJob, processJob } from "../src/lib/storage/jobStore";

const pollMs = Number(process.env.WORKER_POLL_MS || 5000);

async function main() {
  console.log("Publisher2X worker started.");

  while (true) {
    const job = await claimNextJob();

    if (!job) {
      await sleep(pollMs);
      continue;
    }

    console.log(`Processing job ${job.id}`);
    try {
      await processJob(job.id);
      console.log(`Completed job ${job.id}`);
    } catch (error) {
      console.error(`Failed job ${job.id}`, error);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
