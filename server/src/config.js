const isProduction = process.env.NODE_ENV === "production";

module.exports = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || (isProduction ? "" : "sidra-dev-jwt-secret-change-me"),
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ||
    (isProduction ? "" : "sidra-dev-refresh-secret-change-me"),
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction,
};