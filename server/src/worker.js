const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const config = require("./config");
const { MysqlStore } = require("./store/mysqlStore");
const {
  generateRollingSlots,
  markUnattendedSlotsForReview,
  sendTeacherHoursDigests,
} = require("./workerJobs");

const QUEUE_NAME = "sidra-academy-worker";

async function startWorker() {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for the worker");
  const store = new MysqlStore(config.databaseUrl);
  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: redis });
  await queue.upsertJobScheduler("slot-generator-daily", { pattern: "0 2 * * *", tz: "UTC" }, {
    name: "slot-generator",
    data: {},
  });
  await queue.upsertJobScheduler("attendance-watchdog-hourly", { every: 60 * 60 * 1000 }, {
    name: "attendance-watchdog",
    data: {},
  });
  await queue.upsertJobScheduler("teacher-hours-digest-monthly", { pattern: "0 9 1 * *", tz: "UTC" }, {
    name: "teacher-hours-digest",
    data: {},
  });

  const worker = new Worker(QUEUE_NAME, async (job) => {
    if (job.name === "slot-generator") {
      const result = await generateRollingSlots(store);
      console.info("slot-generator completed", result);
      return result;
    }
    if (job.name === "attendance-watchdog") {
      const result = await markUnattendedSlotsForReview(store);
      console.info("attendance-watchdog completed", result);
      if (result.pendingReview > 0) {
        await queue.add("admin-pending-review-notification", result, { removeOnComplete: 100, removeOnFail: 500 });
      }
      return result;
    }
    if (job.name === "admin-pending-review-notification") {
      console.warn("Admin action required: unattended class slots are pending review.", job.data);
      return { acknowledged: true };
    }
    if (job.name === "teacher-hours-digest") {
      const result = await sendTeacherHoursDigests(store);
      console.info("teacher-hours-digest completed", result);
      return result;
    }
    throw new Error(`Unknown worker job: ${job.name}`);
  }, { connection: redis });

  worker.on("failed", (job, error) => console.error(`Job ${job?.name || "unknown"} failed`, error));
  console.info("Sidra worker ready; daily slots, hourly attendance, and monthly teacher digest are scheduled.");
  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await redis.quit();
    await store.close();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startWorker().catch((error) => {
  console.error(error);
  process.exit(1);
});
