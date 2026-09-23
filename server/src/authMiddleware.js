const { verifyAccessToken } = require("./security");

function authRequired(store) {
  return async (req, res, next) => {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    try {
      const payload = verifyAccessToken(token);
      const user = await store.findUserById(payload.sub);
      if (!user || user.status !== "active") return res.status(401).json({ error: "Account is unavailable" });
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired access token" });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to access this route" });
    }
    next();
  };
}

module.exports = { authRequired, requireRole };