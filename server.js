const express = require("express");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const PREDICTOR_PASSWORD = process.env.PREDICTOR_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;

const ROUND_DURATION_MS = 15000;
const HISTORY_LIMIT = 50;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;

app.use(cors({
  origin: ["https://njugunaalex873-png.github.io"],
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
let roundTimer = null;
const history = [];

function generateCrashPoint() {
  const random = crypto.randomInt(1, 1000000) / 1000000;
  return Number(
    Math.max(1.01, Math.min(100, 0.99 / (1 - random))).toFixed(2)
  );
}

function createRound() {
    // Avoid creating another round while one is still active.
    if (currentRound && currentRound.status !== "crashed") {
        return currentRound;
    }

    roundNumber++;

    const createdAt = new Date().toISOString();

    currentRound = {
        roundId: roundNumber,
        createdAt: createdAt,
        startedAt: null,
        endedAt: null,
        status: "waiting",
        crashAt: generateCrashPoint()
    };

    history.unshift({ ...currentRound });

    // Keep only the most recent rounds.
    if (history.length > HISTORY_LIMIT) {
        history.length = HISTORY_LIMIT;
    }

    console.log("Created round:", roundNumber);

    return currentRound;
}
function noCache(res) {
  res.set("Cache-Control", "no-store");
}

function publicRound() {
  if (!currentRound) return null;

  return {
    roundId: currentRound.roundId,
    createdAt: currentRound.createdAt,
    startedAt: currentRound.startedAt,
    endedAt: currentRound.endedAt,
    status: currentRound.status
  };
}

function completeRound() {
  if (!currentRound || currentRound.status !== "running") return;

  currentRound.status = "crashed";
  currentRound.endedAt = new Date().toISOString();

  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimer = null;
  }

  const saved = history.find(
    item => item.roundId === currentRound.roundId
  );

  if (saved) {
    saved.status = "crashed";
    saved.endedAt = currentRound.endedAt;
    saved.crashAt = currentRound.crashAt;
  }

  // Automatically create the next round after 2 seconds.
  setTimeout(() => {
    createRound();

    // Allow 5 seconds for betting before starting.
    setTimeout(() => {
  createRound();

  console.log("Betting open: 10 seconds");

  setTimeout(() => {
    const started = startRound();
    console.log("Round started:", started);
  }, 10000);
}, 2000);

function startRound() {
  if (!currentRound || currentRound.status !== "waiting") {
    return false;
  }

  currentRound.status = "running";
  currentRound.startedAt = new Date().toISOString();

  const saved = history.find(
    item => item.roundId === currentRound.roundId
  );

  if (saved) {
    saved.status = "running";
    saved.startedAt = currentRound.startedAt;
  }

  // Calculate how long it takes for the multiplier
  // to reach this round's crash point.
  const durationMs = Math.ceil(
    Math.log(currentRound.crashAt) / 0.12 * 1000
  );

  roundTimer = setTimeout(
    completeRound,
    Math.max(1, durationMs)
  );

  return true;
}

function startGameLoop() {
  createRound();

  console.log("First round created. Starting in 5 seconds...");

  setTimeout(() => {
    const started = startRound();
    console.log("First round start result:", started);
  }, 5000);
}

startGameLoop();


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

    if (
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < Date.now()
    ) {
      return null;
    }

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
      error: "Incorrect login details."
    });
  }

  noCache(res);

  res.json({
    token: signToken({
      expiresAt: Date.now() + TOKEN_LIFETIME_MS
    }),
    expiresInSeconds: TOKEN_LIFETIME_MS / 1000
  });
});

// Public game status: never disclose the upcoming multiplier.
app.get("/api/game-status", (req, res) => {
  noCache(res);
  res.json(publicRound());
});

// Private predictor: view the upcoming multiplier.
app.get("/api/next-round", requireLogin, (req, res) => {
  noCache(res);

  res.json({
    ...publicRound(),
    crashAt: currentRound.crashAt
  });
});

// Private predictor: recent rounds.
app.get("/api/history", requireLogin, (req, res) => {
  noCache(res);

  res.json({
    rounds: history.map(item => ({ ...item }))
  });
});

// Private testing: manually create the next round.
// Only permitted when the current round has ended.
app.post("/api/next-round", requireLogin, (req, res) => {
  if (
    currentRound &&
    currentRound.status !== "crashed"
  ) {
    return res.status(409).json({
      error: "The current round has not finished."
    });
  }

  createRound();
  startRound();

  noCache(res);

  res.status(201).json({
    ...publicRound(),
    crashAt: currentRound.crashAt
  });
});

// Private testing endpoint: start the current round.
app.post("/api/start-round", requireLogin, (req, res) => {
  if (!startRound()) {
    return res.status(409).json({
      error: "Round is not waiting to start."
    });
  }

  noCache(res);
  res.json(publicRound());
});
// Public demo endpoint: start a waiting round or join
// the current running round. Never reveal crashAt.
app.post("/api/game-start", (req, res) => {
  noCache(res);

  if (currentRound && currentRound.status === "waiting") {
    startRound();
  }

  if (currentRound && currentRound.status === "running") {
    return res.json(publicRound());
  }

  return res.status(409).json({
    error: "No round is available yet. Please try again shortly."
  });
});

// Private testing endpoint: view the current round's result.
app.get("/api/game-round", requireLogin, (req, res) => {
  noCache(res);

  res.json({
    ...publicRound(),
    crashAt: currentRound.crashAt
  });
});

// Server-authoritative multiplier for the public game.
// Reveal the crash point only after the round has crashed.
app.get("/api/game-multiplier", (req, res) => {
  noCache(res);

  if (!currentRound) {
    return res.json({
      roundId: null,
      status: "waiting",
      multiplier: null
    });
  }

  if (currentRound.status === "crashed") {
    return res.json({
      ...publicRound(),
      multiplier: null,
      crashAt: currentRound.crashAt
    });
  }

  if (currentRound.status !== "running") {
    return res.json({
      ...publicRound(),
      multiplier: null
    });
  }

  const elapsed =
    Date.now() - new Date(currentRound.startedAt).getTime();

  const multiplier = Number(
    Math.exp(Math.max(0, elapsed) * 0.00012).toFixed(2)
  );

  if (multiplier >= currentRound.crashAt) {
    completeRound();

    return res.json({
      ...publicRound(),
      multiplier: null,
      crashAt: currentRound.crashAt
    });
  }

  return res.json({
    ...publicRound(),
    multiplier
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SkyCrash Predictor API listening on port ${PORT}`);
});
