const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10kb" }));

const PORT = process.env.PORT || 3000;
const PREDICTOR_PASSWORD = process.env.PREDICTOR_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;

if (!PREDICTOR_PASSWORD || !TOKEN_SECRET) {
  console.error("Missing PREDICTOR_PASSWORD or TOKEN_SECRET.");
  process.exit(1);
}

let roundNumber = 0;
let currentRound = null;
const history = [];

function generateCrashPoint() {
  const random = crypto.randomInt(1, 1000000) / 1000000;
  return Number(
    Math.max(1.01, Math.min(100, 0.99 / (1 - random))).toFixed(2)
  );
}

function createRound() {
  roundNumber++;

  currentRound = {
    roundId: roundNumber,
    crashAt: generateCrashPoint(),
    createdAt: new Date().toISOString(),
    status: "waiting"
  };

  history.unshift({ ...currentRound });

  if (history.length > 20) history.pop();

  return currentRound;
}

createRound();

function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;

  const expected = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(encoded)
    .digest();

  let actual;

  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }

  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString()
    );

    if (payload.expiresAt < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

function requireLogin(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: "Please log in again." });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    service: "SkyCrash Predictor API",
    status: "online"
  });
});

app.post("/api/login", (req, res) => {
  const password = req.body && req.body.password;

  if (typeof password !== "string" || password.length > 200) {
    return res.status(400).json({ error: "Invalid login details." });
  }

  const supplied = Buffer.from(password);
  const expected = Buffer.from(PREDICTOR_PASSWORD);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  const token = signToken({
    expiresAt: Date.now() + 30 * 60 * 1000
  });

  res.set("Cache-Control", "no-store");
  res.json({ token, expiresInSeconds: 1800 });
});

app.get("/api/next-round", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(currentRound);
});

app.get("/api/history", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ rounds: history });
});

app.post("/api/next-round", requireLogin, (req, res) => {
  const round = createRound();

  res.set("Cache-Control", "no-store");
  res.status(201).json(round);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SkyCrash Predictor API listening on port ${PORT}`);
});
