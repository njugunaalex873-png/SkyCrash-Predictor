const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PREDICTOR_API_KEY;

if (!API_KEY) {
  console.error("Missing PREDICTOR_API_KEY environment variable.");
  process.exit(1);
}

// Demo configuration.
// Set the same API key in Render's environment variables.
// Do not put your API key in public frontend code.
let roundNumber = 0;
let currentRound = null;
const history = [];

function generateCrashPoint() {
  const random = crypto.randomInt(1, 1000000) / 1000000;

  const multiplier = Math.max(
    1.01,
    Math.min(100, 0.99 / (1 - random))
  );

  return Number(multiplier.toFixed(2));
}

function createRound() {
  roundNumber += 1;

  currentRound = {
    roundId: roundNumber,
    crashAt: generateCrashPoint(),
    createdAt: new Date().toISOString(),
    status: "waiting"
  };

  history.unshift({
    roundId: currentRound.roundId,
    crashAt: currentRound.crashAt,
    createdAt: currentRound.createdAt
  });

  if (history.length > 20) {
    history.pop();
  }

  return currentRound;
}

// Create an initial round when the server starts.
createRound();

function requireApiKey(req, res, next) {
  const providedKey = req.get("x-api-key");

  if (
    typeof providedKey !== "string" ||
    Buffer.byteLength(providedKey) !== Buffer.byteLength(API_KEY) ||
    !crypto.timingSafeEqual(
      Buffer.from(providedKey),
      Buffer.from(API_KEY)
    )
  ) {
    return res.status(401).json({
      error: "Unauthorized"
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

// Private endpoint: reveals the current demo round result.
app.get("/api/next-round", requireApiKey, (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    roundId: currentRound.roundId,
    crashAt: currentRound.crashAt,
    createdAt: currentRound.createdAt,
    status: currentRound.status
  });
});

// Private endpoint: view recent demo rounds.
app.get("/api/history", requireApiKey, (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    rounds: history
  });
});

// Private endpoint: create the next demo round.
// Your game integration will call this when appropriate.
app.post("/api/next-round", requireApiKey, (req, res) => {
  const round = createRound();

  res.set("Cache-Control", "no-store");

  res.status(201).json({
    roundId: round.roundId,
    crashAt: round.crashAt,
    createdAt: round.createdAt,
    status: round.status
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SkyCrash Predictor API listening on port ${PORT}`);
});
