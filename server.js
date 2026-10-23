const express = require("express");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const PREDICTOR_PASSWORD = process.env.PREDICTOR_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;

// Allow your GitHub Pages websites to connect.
const allowedOrigins = [
  "https://njugunaalex873-png.github.io"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
}));

app.use(express.json({ limit: "10kb" }));

if (!PREDICTOR_PASSWORD || !TOKEN_SECRET) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

let roundNumber = 0;
let currentRound = null;
const history = [];
const TOKEN_LIFETIME = 30 * 60 * 1000;

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

  if (history.length > 50) {
    history.pop();
  }

  return currentRound;
}

// Start with the first round.
createRound();

function signToken(payload) {
  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString("base64url");

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

  const actual = Buffer.from(signature, "base64url");

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

  if (!verifyToken(token)) {
    return res.status(401).json({
      error: "Please log in again."
    });
  }

  next();
}

function noCache(res) {
  res.set("Cache-Control", "no-store");
}

app.get("/", (req, res) => {
  res.json({
    service: "SkyCrash Predictor API",
    status: "online"
  });
});

// Private predictor login.
app.post("/api/login", (req, res) => {
  const password = req.body && req.body.password;

  if (
    typeof password !== "string" ||
    password.length > 200
  ) {
    return res.status(400).json({
      error: "Invalid login details."
    });
  }

  const supplied = Buffer.from(password);
  const expected = Buffer.from(PREDICTOR_PASSWORD);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({
      error: "Incorrect password."
    });
  }

  const token = signToken({
    expiresAt: Date.now() + TOKEN_LIFETIME
  });

  noCache(res);

  res.json({
    token,
    expiresInSeconds: TOKEN_LIFETIME / 1000
  });
});

// Private endpoint: view the upcoming result.
app.get("/api/next-round", requireLogin, (req, res) => {
  noCache(res);
  res.json(currentRound);
});

// Private endpoint: view round history.
app.get("/api/history", requireLogin, (req, res) => {
  noCache(res);
  res.json({ rounds: history });
});

// Private testing endpoint: generate the next round.
// Only authenticated requests can call this endpoint.
app.post("/api/next-round", requireLogin, (req, res) => {
  const round = createRound();

  noCache(res);
  res.status(201).json(round);
});
// Public game status: never reveal the upcoming crash multiplier.
app.get("/api/game-status", (req, res) => {
  noCache(res);

  res.json({
    roundId: currentRound.roundId,
    createdAt: currentRound.createdAt,
    status: currentRound.status
  });
});
// Private game-testing endpoint.
// The game must authenticate before retrieving the result.
app.get("/api/game-round", requireLogin, (req, res) => {
  noCache(res);

  res.json({
    roundId: currentRound.roundId,
    crashAt: currentRound.crashAt,
    createdAt: currentRound.createdAt,
    status: currentRound.status
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SkyCrash Predictor API listening on port ${PORT}`);
});
