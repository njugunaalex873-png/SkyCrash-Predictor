const express = require("express");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

const PREDICTOR_PASSWORD = process.env.PREDICTOR_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
// Initiate an M-Pesa Daraja SANDBOX STK Push.
// This test endpoint does not credit player balances.
app.post("/api/mpesa/stkpush", async (req, res) => {
  try {
    if (
      !MPESA_CONSUMER_KEY ||
      !MPESA_CONSUMER_SECRET ||
      !MPESA_SHORTCODE ||
      !MPESA_PASSKEY ||
      !MPESA_CALLBACK_URL
    ) {
      return res.status(503).json({
        error: "M-Pesa sandbox is not configured."
      });
    }

    console.log("STK request body:", req.body);

const phone = String(req.body?.phone || "").replace(/\s+/g, "");
    const amount = Number(req.body?.amount);

    if (!/^254\d{9}$/.test(phone)) {
      return res.status(400).json({
        error: "Enter a Kenyan phone number like 254712345678."
      });
    }

    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 10000
    ) {
      return res.status(400).json({
        error: "Enter a whole-number sandbox amount between 1 and 10000."
      });
    }

    if (!MPESA_CALLBACK_URL.startsWith("https://")) {
      return res.status(500).json({
        error: "The callback URL must use HTTPS."
      });
    }

    // Obtain a Daraja sandbox OAuth access token.
    const credentials = Buffer.from(
      `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Daraja sandbox token request failed.");
      return res.status(502).json({
        error: "Could not connect to the M-Pesa sandbox."
      });
    }

    // Daraja expects an East Africa local timestamp.
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const timestamp = now.toISOString()
      .replace(/[-:T.Z]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`
    ).toString("base64");

    const stkResponse = await fetch(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          BusinessShortCode: MPESA_SHORTCODE,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: amount,
          PartyA: phone,
          PartyB: MPESA_SHORTCODE,
          PhoneNumber: phone,
          CallBackURL: MPESA_CALLBACK_URL,
          AccountReference: "SkyCrashTest",
          TransactionDesc: "Sandbox payment test"
        })
      }
    );

    const stkData = await stkResponse.json();

    if (!stkResponse.ok || stkData.ResponseCode !== "0") {
      console.error("Daraja sandbox STK request was rejected.");
      return res.status(502).json({
        error: "Safaricom did not accept the sandbox STK request."
      });
    }

    // Return request identifiers for testing only.
    // This is not proof of payment.
    return res.status(200).json({
      message: "Sandbox STK request accepted.",
      checkoutRequestId: stkData.CheckoutRequestID,
      customerMessage: stkData.CustomerMessage
    });
  } catch (error) {
    console.error("M-Pesa sandbox request failed:", error.message);

    return res.status(502).json({
      error: "Could not complete the sandbox STK request."
    });
  }
});
// M-Pesa Daraja sandbox configuration
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE;
const MPESA_PASSKEY = process.env.MPESA_PASSKEY;
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

const ROUND_DURATION_MS = 15000;
const HISTORY_LIMIT = 50;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;


app.use((req, res, next) => {
  if (req.path.startsWith("/api/mpesa")) {
    console.log("MPESA DIAGNOSTIC:", req.method, req.path);
    console.log("Request origin:", req.get("origin") || "none");
  }
  next();
});

app.use(cors({
  origin: ["https://njugunaalex873-png.github.io"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
}));

app.options(
  "/api/mpesa/stkpush",
  cors({
    origin: "https://njugunaalex873-png.github.io",
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
  })
);

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

console.log("Round crashed:", currentRound.roundId);

// Create the next round after 2 seconds.
setTimeout(() => {
createRound();

console.log("Next round created. Betting open.");

// Start the next round after 5 seconds.
setTimeout(() => {
  const started = startRound();
  console.log("Round started:", started);
}, 5000);

}, 2000);
}

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
// M-Pesa Daraja sandbox callback.
// Sandbox testing only: this endpoint does not credit balances.
app.post("/api/mpesa/callback", (req, res) => {
  const callback = req.body?.Body?.stkCallback;

  if (!callback) {
    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Invalid callback payload"
    });
  }

  console.log("M-Pesa sandbox callback received:", {
    checkoutRequestId: callback.CheckoutRequestID,
    merchantRequestId: callback.MerchantRequestID,
    resultCode: callback.ResultCode,
    resultDescription: callback.ResultDesc
  });

  // Acknowledge the notification without changing any balance.
  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Callback received"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SkyCrash Predictor API listening on port ${PORT}`);
});
