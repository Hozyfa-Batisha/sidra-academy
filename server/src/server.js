const config = require("./config");
const { createApp } = require("./app");
const { MysqlStore } = require("./store/mysqlStore");
const { MemoryStore } = require("./store/memoryStore");
const { bcrypt } = require("./security");

async function seed(store) {
  if (await store.findUserByEmail("admin@sidra.academy")) return;
  await store.createUser({
    role: "admin",
    name: "Sidra Administrator",
    email: "admin@sidra.academy",
    passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "Admin12345!", 12),
  });
}

async function main() {
  const store = config.databaseUrl ? new MysqlStore(config.databaseUrl) : new MemoryStore();
  await seed(store);
  const app = createApp({ store });
  app.listen(config.port, () => console.log(`Sidra API listening on :${config.port}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});