import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

const MUAPI_BASE = "https://api.muapi.ai/api/v1";
const MUAPI_KEY = process.env.MUAPI_API_KEY || "";

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "muapi-backend", status: "online" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, api_configured: Boolean(MUAPI_KEY) });
});

function cleanDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  return Math.max(5, Math.min(30, Math.round(n)));
}

app.post("/api/generate", async (req, res) => {
  try {
    if (!MUAPI_KEY) {
      return res.status(500).json({
        ok: false,
        error: "MUAPI_API_KEY no configurada"
      });
    }

    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "prompt is required"
      });
    }

    const duration = cleanDuration(req.body?.duration);

    // Ajusta este endpoint si tu cuenta de MuAPI usa otro nombre.
    const endpoint = `${MUAPI_BASE}/video/generate`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": MUAPI_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        duration,
        aspect_ratio: "16:9"
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data?.message || data?.error || "Error en MuAPI"
      });
    }

    const videoUrl =
      data?.data?.url ||
      data?.url ||
      data?.result?.url ||
      data?.video?.url;

    if (!videoUrl) {
      return res.status(502).json({
        ok: false,
        error: "MuAPI no devolvió una URL de video",
        raw: data
      });
    }

    return res.json({
      ok: true,
      url: videoUrl
    });
  } catch (error) {
    console.error("MuAPI error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error generando el video"
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Backend running on ${HOST}:${PORT}`);
});
