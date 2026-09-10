const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Agent, fetch } = require('undici');
require('dotenv').config();

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1');
const directDispatcher = new Agent();

const PORT = Number(process.env.PORT || 3000);
const REPLICATE_API_KEY = String(process.env.REPLICATE_API_KEY || '').trim();
const ELEVEN_API_KEY = String(process.env.ELEVEN_API_KEY || '').trim();
const REPLICATE_TEXT_TO_VIDEO_MODEL = process.env.REPLICATE_TEXT_TO_VIDEO_MODEL || 'kwaivgi/kling-v1.6-standard';
const REPLICATE_TEXT_TO_IMAGE_MODEL = process.env.REPLICATE_TEXT_TO_IMAGE_MODEL || 'black-forest-labs/flux-schnell';
const REPLICATE_IMAGE_TO_VIDEO_MODEL = process.env.REPLICATE_IMAGE_TO_VIDEO_MODEL || 'kwaivgi/kling-v1.6-standard';
const ELEVEN_DEFAULT_VOICE_ID = process.env.ELEVEN_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const ELEVEN_DEFAULT_FORMAT = process.env.ELEVEN_DEFAULT_FORMAT || 'mp3_44100_128';
const ELEVEN_MODEL_ID = process.env.ELEVEN_MODEL_ID || 'eleven_multilingual_v2';
const REPLICATE_TIMEOUT_MS = Number(process.env.REPLICATE_TIMEOUT_MS || 180000);
const REPLICATE_POLL_INTERVAL_MS = Number(process.env.REPLICATE_POLL_INTERVAL_MS || 2500);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 10);
const MOCK_AI_PROVIDER = process.env.MOCK_AI_PROVIDER === '1';

const GENERATED_DIR = path.join(__dirname, '..', 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });
const ASSET_PROXY_ALLOWED_HOSTS = String(
  process.env.ASSET_PROXY_ALLOWED_HOSTS || '*.replicate.delivery,replicate.delivery,replicate.com'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

const allowedOrigins = String(process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/generated', express.static(GENERATED_DIR, { maxAge: '1d', etag: true }));

function getBaseUrl(req) {
  const forcedBase = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (forcedBase) return forcedBase.replace(/\/+$/, '');
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${protocol}://${host}`;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function fail(res, status, message, code = 'BAD_REQUEST', details = undefined) {
  return res.status(status).json({
    ok: false,
    error: message,
    code,
    ...(details ? { details } : {})
  });
}

function clampDuration(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) return 10;
  return Math.min(30, Math.max(1, Math.round(value)));
}

function firstUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstUrl(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'video', 'image', 'audio', 'output', 'result']) {
      const found = firstUrl(value[key]);
      if (found) return found;
    }
  }
  return null;
}

function toProxyUrl(req, rawUrl) {
  if (!rawUrl) return null;
  if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;
  const base = getBaseUrl(req);
  return `${base}/api/assets?url=${encodeURIComponent(rawUrl)}`;
}

function isAllowedAssetHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  return ASSET_PROXY_ALLOWED_HOSTS.some((rule) => {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }
    return normalized === rule;
  });
}

function isPrivateIpAddress(ip) {
  if (!net.isIP(ip)) return true;

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }

  const value = ip.toLowerCase();
  return (
    value === '::1' ||
    value.startsWith('fe80:') ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('::ffff:127.') ||
    value.startsWith('::ffff:10.') ||
    value.startsWith('::ffff:192.168.') ||
    /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  );
}

async function assertPublicResolvedHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      const error = new Error('Resolved host is not public');
      error.code = 'ASSET_HOST_PRIVATE_IP';
      error.status = 403;
      throw error;
    }
    return;
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) {
    const error = new Error('Could not resolve asset host');
    error.code = 'ASSET_HOST_UNRESOLVED';
    error.status = 400;
    throw error;
  }

  const invalid = records.find((record) => isPrivateIpAddress(record.address));
  if (invalid) {
    const error = new Error('Resolved host is not public');
    error.code = 'ASSET_HOST_PRIVATE_IP';
    error.status = 403;
    throw error;
  }
}

async function fetchUpstreamAsset(url, fetchImpl = fetch, dispatcher = directDispatcher) {
  const upstream = await fetchImpl(url, { redirect: 'manual', dispatcher });
  if (upstream.status >= 300 && upstream.status < 400) {
    const error = new Error('Redirects are not allowed for proxied assets');
    error.code = 'ASSET_REDIRECT_BLOCKED';
    error.status = 403;
    throw error;
  }
  return upstream;
}

async function replicateRequest(pathname, payload) {
  const response = await fetch(`https://api.replicate.com/v1${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${REPLICATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.detail || data?.error || `Replicate request failed (${response.status})`;
    const error = new Error(message);
    error.code = 'REPLICATE_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

async function replicateGet(pathname) {
  const response = await fetch(`https://api.replicate.com/v1${pathname}`, {
    headers: {
      Authorization: `Token ${REPLICATE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.detail || data?.error || `Replicate polling failed (${response.status})`;
    const error = new Error(message);
    error.code = 'REPLICATE_POLL_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

async function waitForPrediction(predictionId) {
  const started = Date.now();
  while (Date.now() - started < REPLICATE_TIMEOUT_MS) {
    const prediction = await replicateGet(`/predictions/${predictionId}`);
    const status = prediction?.status;
    if (status === 'succeeded') return prediction;
    if (status === 'failed' || status === 'canceled') {
      const message = prediction?.error || `Prediction ${status}`;
      const error = new Error(message);
      error.code = 'REPLICATE_PREDICTION_FAILED';
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, REPLICATE_POLL_INTERVAL_MS));
  }
  const error = new Error(`Replicate timed out after ${REPLICATE_TIMEOUT_MS}ms`);
  error.code = 'REPLICATE_TIMEOUT';
  throw error;
}

async function runReplicateModel(model, input) {
  if (!REPLICATE_API_KEY) {
    const error = new Error('REPLICATE_API_KEY is not configured');
    error.code = 'MISSING_REPLICATE_API_KEY';
    error.status = 503;
    throw error;
  }
  const created = await replicateRequest('/predictions', { model, input });
  if (created?.status === 'succeeded') return created;
  if (!created?.id) {
    const error = new Error('Replicate did not return a prediction id');
    error.code = 'REPLICATE_INVALID_RESPONSE';
    throw error;
  }
  return waitForPrediction(created.id);
}

async function generateVideoFromPrompt(prompt, duration) {
  if (MOCK_AI_PROVIDER) {
    return `https://replicate.delivery/mock/video-${Date.now()}.mp4`;
  }
  const prediction = await runReplicateModel(REPLICATE_TEXT_TO_VIDEO_MODEL, {
    prompt,
    duration: clampDuration(duration)
  });
  const outputUrl = firstUrl(prediction?.output);
  if (!outputUrl) {
    const error = new Error('No output URL returned by Replicate');
    error.code = 'REPLICATE_NO_OUTPUT';
    throw error;
  }
  return outputUrl;
}

async function generateImageFromPrompt(prompt) {
  if (MOCK_AI_PROVIDER) {
    return `https://replicate.delivery/mock/image-${encodeURIComponent(prompt.slice(0, 24))}.png`;
  }
  const prediction = await runReplicateModel(REPLICATE_TEXT_TO_IMAGE_MODEL, { prompt });
  const outputUrl = firstUrl(prediction?.output);
  if (!outputUrl) {
    const error = new Error('No image URL returned by Replicate');
    error.code = 'REPLICATE_NO_OUTPUT';
    throw error;
  }
  return outputUrl;
}

async function generateVideoFromPhoto(photoDataUri, prompt, allowNsfw) {
  if (MOCK_AI_PROVIDER) {
    return `https://replicate.delivery/mock/photo-video-${Date.now()}.mp4`;
  }
  const prediction = await runReplicateModel(REPLICATE_IMAGE_TO_VIDEO_MODEL, {
    image: photoDataUri,
    prompt,
    allow_nsfw: allowNsfw
  });
  const outputUrl = firstUrl(prediction?.output);
  if (!outputUrl) {
    const error = new Error('No video URL returned for photo-to-video');
    error.code = 'REPLICATE_NO_OUTPUT';
    throw error;
  }
  return outputUrl;
}

async function generateTts(text, voiceId, format) {
  if (MOCK_AI_PROVIDER) {
    const extension = String(format || ELEVEN_DEFAULT_FORMAT).startsWith('pcm') ? 'pcm' : 'mp3';
    const filename = `tts-${crypto.randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(GENERATED_DIR, filename), Buffer.from(`MOCK:${text}:${voiceId || ELEVEN_DEFAULT_VOICE_ID}`));
    return filename;
  }

  if (!ELEVEN_API_KEY) {
    const error = new Error('ELEVEN_API_KEY is not configured');
    error.code = 'MISSING_ELEVEN_API_KEY';
    error.status = 503;
    throw error;
  }

  const selectedVoiceId = (voiceId || ELEVEN_DEFAULT_VOICE_ID).trim();
  if (!selectedVoiceId) {
    const error = new Error('voiceId is required');
    error.code = 'VOICE_ID_REQUIRED';
    error.status = 400;
    throw error;
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(selectedVoiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVEN_API_KEY,
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: ELEVEN_MODEL_ID,
      output_format: format || ELEVEN_DEFAULT_FORMAT
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const message = errData?.detail?.message || errData?.detail || `ElevenLabs request failed (${response.status})`;
    const error = new Error(message);
    error.code = 'ELEVEN_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }

  const outputFormat = String(format || ELEVEN_DEFAULT_FORMAT);
  const extension = outputFormat.startsWith('pcm') ? 'pcm' : 'mp3';
  const filename = `tts-${crypto.randomUUID()}.${extension}`;
  const target = path.join(GENERATED_DIR, filename);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, bytes);
  return filename;
}

function errorToResponse(error) {
  const status = Number(error?.status) || 502;
  const message = error?.message || 'Unexpected backend error';
  const code = error?.code || 'BACKEND_ERROR';
  return { status, message, code };
}

app.get('/health', (_req, res) => {
  const replicateConfigured = Boolean(REPLICATE_API_KEY);
  const elevenConfigured = Boolean(ELEVEN_API_KEY);
  res.json({
    ok: true,
    status: 'ok',
    api_configured: replicateConfigured,
    providers: {
      replicate: replicateConfigured,
      elevenlabs: elevenConfigured
    }
  });
});

app.get('/api/assets', async (req, res) => {
  const assetUrl = String(req.query?.url || '').trim();
  if (!assetUrl || !/^https?:\/\//i.test(assetUrl)) {
    return fail(res, 400, 'A valid asset URL is required', 'INVALID_ASSET_URL');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(assetUrl);
  } catch {
    return fail(res, 400, 'A valid asset URL is required', 'INVALID_ASSET_URL');
  }

  if (!isAllowedAssetHost(parsedUrl.hostname)) {
    return fail(res, 403, 'Asset host not allowed', 'ASSET_HOST_FORBIDDEN');
  }

  try {
    await assertPublicResolvedHost(parsedUrl.hostname);
    const upstream = await fetchUpstreamAsset(parsedUrl.toString());
    if (!upstream.ok) {
      return fail(res, 502, `Upstream returned ${upstream.status}`, 'ASSET_FETCH_FAILED');
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!upstream.body) {
      return fail(res, 502, 'Asset response body is empty', 'ASSET_EMPTY_BODY');
    }
    res.status(200);
    await pipeline(Readable.fromWeb(upstream.body), res);
    return undefined;
  } catch (error) {
    const parsed = errorToResponse(error);
    return fail(res, parsed.status, parsed.message, parsed.code);
  }
});

async function handleVideoGenerate(req, res) {
  const prompt = String(req.body?.prompt || '').trim();
  const duration = clampDuration(req.body?.duration);
  if (!prompt) return fail(res, 400, 'prompt is required', 'PROMPT_REQUIRED');

  try {
    const rawUrl = await generateVideoFromPrompt(prompt, duration);
    return res.json({ ok: true, url: toProxyUrl(req, rawUrl) });
  } catch (error) {
    const parsed = errorToResponse(error);
    return fail(res, parsed.status, parsed.message, parsed.code);
  }
}

app.post('/api/generate', handleVideoGenerate);
app.post('/api/generate-video', handleVideoGenerate);

app.post('/api/generate-image', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return fail(res, 400, 'prompt is required', 'PROMPT_REQUIRED');

  try {
    const rawUrl = await generateImageFromPrompt(prompt);
    return res.json({ ok: true, url: toProxyUrl(req, rawUrl) });
  } catch (error) {
    const parsed = errorToResponse(error);
    return fail(res, parsed.status, parsed.message, parsed.code);
  }
});

app.post('/api/photo-to-video', upload.single('photo'), async (req, res) => {
  const prompt = String(req.body?.prompt || 'Smooth animation and elegant motion').trim();
  const allowNsfw = parseBoolean(req.body?.allow_nsfw);

  let photoDataUri = '';
  if (req.file?.buffer?.length) {
    const mime = req.file.mimetype || 'image/jpeg';
    photoDataUri = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
  } else if (typeof req.body?.photoData === 'string' && req.body.photoData.trim()) {
    photoDataUri = req.body.photoData.trim();
  }

  if (!photoDataUri) {
    return fail(res, 400, 'photo upload is required', 'PHOTO_REQUIRED');
  }

  try {
    const rawUrl = await generateVideoFromPhoto(photoDataUri, prompt, allowNsfw);
    return res.json({ ok: true, url: toProxyUrl(req, rawUrl) });
  } catch (error) {
    const parsed = errorToResponse(error);
    return fail(res, parsed.status, parsed.message, parsed.code);
  }
});

app.post('/api/tts', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const voiceId = String(req.body?.voiceId || '').trim();
  const format = String(req.body?.format || '').trim();
  if (!text) return fail(res, 400, 'text is required', 'TEXT_REQUIRED');

  try {
    const filename = await generateTts(text, voiceId, format || ELEVEN_DEFAULT_FORMAT);
    const base = getBaseUrl(req);
    return res.json({
      ok: true,
      url: `${base}/generated/${encodeURIComponent(filename)}`
    });
  } catch (error) {
    const parsed = errorToResponse(error);
    return fail(res, parsed.status, parsed.message, parsed.code);
  }
});

app.use((error, _req, res, _next) => {
  if (error && error.message === 'Origin not allowed by CORS') {
    return fail(res, 403, error.message, 'CORS_FORBIDDEN');
  }
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return fail(res, 413, `File too large. Max ${MAX_UPLOAD_MB}MB`, 'FILE_TOO_LARGE');
  }
  const parsed = errorToResponse(error);
  return fail(res, parsed.status, parsed.message, parsed.code);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    console.log(`REPLICATE_API_KEY: ${REPLICATE_API_KEY ? 'configured' : 'missing'}`);
    console.log(`ELEVEN_API_KEY: ${ELEVEN_API_KEY ? 'configured' : 'missing'}`);
  });
}

module.exports = {
  app,
  __internals: {
    fetchUpstreamAsset
  }
};
