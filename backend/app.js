const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const aiService = require('./lib/ai-service');
const { HttpError } = aiService;

const GENERATED_DIR = path.join(__dirname, 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  }
});
const uploadPhoto = upload.single('photo');

function createApp({ services = aiService } = {}) {
  const app = express();
  const trustProxy = getTrustProxySetting();
  if (trustProxy !== false) {
    app.set('trust proxy', trustProxy);
  }

  app.use(cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new HttpError(403, 'Origin not allowed', 'CORS_NOT_ALLOWED'));
    }
  }));
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true, limit: '12mb' }));
  app.use('/generated', express.static(GENERATED_DIR, {
    fallthrough: false,
    index: false,
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
  }));

  app.get('/health', (_req, res) => {
    res.json(services.getHealthSummary());
  });

  async function handleGenerateVideo(req, res, next) {
    try {
      const prompt = requireText(req.body?.prompt, 'prompt');
      const duration = parseDuration(req.body?.duration);
      const result = await services.generateVideoFromPrompt({ prompt, duration, baseUrl: getBaseUrl(req) });
      res.json({ ok: true, url: result.url });
    } catch (error) {
      next(error);
    }
  }

  app.post('/api/generate', handleGenerateVideo);
  app.post('/api/generate-video', handleGenerateVideo);

  app.post('/api/generate-image', async (req, res, next) => {
    try {
      const prompt = requireText(req.body?.prompt, 'prompt');
      const result = await services.generateImageFromPrompt({ prompt, baseUrl: getBaseUrl(req) });
      res.json({ ok: true, url: result.url });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/photo-to-video', parsePhotoRequest, async (req, res, next) => {
    try {
      const prompt = optionalText(req.body?.prompt) || 'Smooth animation and elegant motion';
      const duration = parseDuration(req.body?.duration, 5);
      const allowNsfw = parseBoolean(req.body?.allow_nsfw ?? req.body?.allowNSFW);
      const image = getPhotoSource(req);

      if (!image) {
        throw new HttpError(400, 'photo is required', 'VALIDATION_ERROR');
      }

      const result = await services.generateVideoFromPhoto({
        prompt,
        duration,
        image,
        allowNsfw,
        baseUrl: getBaseUrl(req)
      });

      res.json({ ok: true, url: result.url });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tts', async (req, res, next) => {
    try {
      const text = requireText(req.body?.text, 'text');
      const voiceId = optionalText(req.body?.voiceId);
      const format = sanitizeFormat(optionalText(req.body?.format) || 'mp3_44100_128');
      const result = await services.generateSpeech({ text, voiceId, format, baseUrl: getBaseUrl(req) });
      res.json({ ok: true, url: result.url });
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Route not found', code: 'NOT_FOUND' });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ ok: false, error: error.message, code: 'UPLOAD_ERROR' });
    }

    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof HttpError ? error.message : 'Internal server error';

    if (!(error instanceof HttpError)) {
      console.error('[backend] unexpected error:', error);
    }

    res.status(statusCode).json({ ok: false, error: message, code });
  });

  return app;
}

function getBaseUrl(req) {
  const configured = optionalText(process.env.API_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');

  const protocol = req.protocol;
  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  return `${protocol}://${host}`;
}

function parsePhotoRequest(req, res, next) {
  if (req.is('multipart/form-data')) {
    uploadPhoto(req, res, next);
    return;
  }

  next();
}

function requireText(value, fieldName) {
  const normalized = optionalText(value);
  if (!normalized) {
    throw new HttpError(400, `${fieldName} is required`, 'VALIDATION_ERROR');
  }
  return normalized;
}

function optionalText(value) {
  return String(value || '').trim();
}

function parseDuration(value, fallback = 10) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 60) {
    throw new HttpError(400, 'duration must be an integer between 1 and 60', 'VALIDATION_ERROR');
  }
  return parsed;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = optionalText(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function sanitizeFormat(value) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new HttpError(400, 'format contains unsupported characters', 'VALIDATION_ERROR');
  }
  return value;
}

function getPhotoSource(req) {
  if (req.file && req.file.buffer) {
    const mimeType = req.file.mimetype || 'application/octet-stream';
    return `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
  }

  const fromBody = optionalText(req.body?.photoData || req.body?.imageData);
  return fromBody.startsWith('data:image/') ? fromBody : null;
}

function getTrustProxySetting() {
  const configured = optionalText(process.env.TRUST_PROXY);
  if (!configured) return false;
  if (/^\d+$/.test(configured)) return Number(configured);
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return configured;
}

function isAllowedOrigin(origin) {
  const configuredOrigins = optionalText(process.env.CORS_ORIGIN)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin);
  }

  return origin === 'null'
    || origin === 'http://localhost:3000'
    || origin === 'http://127.0.0.1:3000'
    || origin === 'http://localhost:8080'
    || origin === 'http://127.0.0.1:8080';
}

module.exports = { createApp };
