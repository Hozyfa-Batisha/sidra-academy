const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("./config");

function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomTemporaryPassword() {
  return `${crypto.randomBytes(9).toString("base64url")}A9!`;
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, type: "access" },
    config.jwtSecret,
    { expiresIn: "15m" },
  );
}

function issueRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, type: "refresh" },
    config.jwtRefreshSecret,
    { expiresIn: "7d" },
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload.type !== "access") throw new Error("Invalid access token");
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwtRefreshSecret);
  if (payload.type !== "refresh") throw new Error("Invalid refresh token");
  return payload;
}

module.exports = {
  bcrypt,
  hashToken,
  randomToken,
  randomTemporaryPassword,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};