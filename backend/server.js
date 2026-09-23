import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Replicate from "replicate";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

const REPLICATE_API_TOKEN =
  process.env.REPLICATE_API_TOKEN ||
  process.env.REPLICATE_API_KEY ||
  "";

if (!REPLICATE_API_TOKEN) {
  console.warn("WARNING: REPLICATE_API_TOKEN / REPLICATE_API_KEY is not configured.");
}

const replicate = new Replicate({
  auth: REPLICATE_API_TOKEN
});

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "th3dr4k3r.ia backend",
    status: "online"
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    api_configured: Boolean(REPLICATE_API_TOKEN)
  });
});

function cleanDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(2, Math.min(15, Math.round(n)));
}

function aspectToPrompt(aspectRatio) {
  if (aspectRatio === "9:16") return "vertical 9:16 composition";
  if (aspectRatio === "1:1") return "square 1:1 composition";
  return "widescreen 16:9 composition";
}

function resolutionFor(aspectRatio) {
  // Wan 2.7 I2V accepts resolution values such as 720p/1080p.
  return "720p";
}

function styleModifier(style) {
  const styles = {
    real: "photorealistic, natural motion, realistic lighting",
    stylized: "stylized cinematic visuals, polished art direction",
    cartoon: "animated/cartoon visual style, expressive motion",
    abstract: "abstract experimental visual style, dynamic shapes and motion"
  };
  return styles[style] || styles.real;
}

function modelModifier(model) {
  const models = {
    base: "",
    cinematic: "cinematic camera movement, film-like composition, dramatic lighting",
    short_ad: "commercial-quality presentation, clean product-ad style",
    dynamic: "dynamic camera movement, energetic pacing, strong motion"
  };
  return models[model] || "";
}

function soundModifier(sound) {
  // Wan 2.7 can generate synchronized audio. We translate the UI choice
  // into a textual direction instead of exposing an API key client-side.
  const sounds = {
    none: "no prominent music; keep audio minimal",
    ambient: "subtle ambient soundscape",
    upbeat: "upbeat energetic background music",
    epic: "epic cinematic music and impactful sound design",
    chill: "calm relaxing background music",
    tech: "futuristic electronic background music"
  };
  return sounds[sound] || sounds.none;
}

function dataUriToBuffer(dataUri) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUri || ""));
  if (!match) throw new Error("La imagen debe ser una data URI base64 válida.");

  const mime = match[1].toLowerCase();
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length) throw new Error("La imagen subida está vacía.");
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error("La imagen supera el límite de 20 MB.");
  }

  return { buffer, mime };
}

async function uploadImageIfPresent(dataUri) {
  if (!dataUri) return null;

  const { buffer, mime } = dataUriToBuffer(dataUri);
  const file = await replicate.files.create(buffer, {
    content_type: mime
  });

  return file.urls.get;
}

function outputUrl(output) {
  if (!output) return null;

  // Current Replicate JS FileOutput.
  if (typeof output.url === "function") {
    return String(output.url());
  }

  if (typeof output.url === "string") {
    return output.url;
  }

  if (Array.isArray(output) && output[0]) {
    return outputUrl(output[0]);
  }

  if (typeof output === "string") return output;

  return null;
}

app.post("/api/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "El backend no tiene configurado REPLICATE_API_TOKEN."
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
    const aspectRatio = ["16:9", "9:16", "1:1"].includes(req.body?.aspectRatio)
      ? req.body.aspectRatio
      : "16:9";

    const style = String(req.body?.style || "real");
    const model = String(req.body?.model || "base");
    const sound = String(req.body?.sound || "none");

    const imageUrl = await uploadImageIfPresent(req.body?.init_image);

    const finalPrompt = [
      prompt,
      aspectToPrompt(aspectRatio),
      styleModifier(style),
      modelModifier(model),
      soundModifier(sound)
    ].filter(Boolean).join(". ");

    let output;

    if (imageUrl) {
      output = await replicate.run("wan-video/wan-2.7-i2v", {
        input: {
          first_frame: imageUrl,
          prompt: finalPrompt,
          duration,
          resolution: resolutionFor(aspectRatio),
          enable_prompt_expansion: true
        }
      });
    } else {
      output = await replicate.run("wan-video/wan-2.7-t2v", {
        input: {
          prompt: finalPrompt,
          duration,
          resolution: resolutionFor(aspectRatio),
          aspect_ratio: aspectRatio,
          enable_prompt_expansion: true
        }
      });
    }

    const url = outputUrl(output);

    if (!url) {
      throw new Error("Replicate no devolvió una URL de vídeo.");
    }

    return res.json({
      ok: true,
      url,
      duration,
      aspectRatio,
      imageToVideo: Boolean(imageUrl)
    });
  } catch (error) {
    console.error("Generation error:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "Error generando el vídeo"
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`th3dr4k3r backend running on ${HOST}:${PORT}`);
});
