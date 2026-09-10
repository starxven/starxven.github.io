const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY || '';
const DEMO_VIDEO_URL = process.env.DEMO_VIDEO_URL || 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

const VIDEOS_DIR = path.join(__dirname, '..', 'videos');
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/videos', express.static(VIDEOS_DIR));

const jobs = new Map();
let counter = 1;

function createJob(prompt, duration, kind = 'video') {
  const id = String(counter++);
  const job = {
    id,
    kind,
    prompt,
    duration,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url: null,
    error: null
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const current = jobs.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  jobs.set(id, next);
  return next;
}

function fakeVideoUrl(id) {
  return `${API_BASE_URL}/videos/generated-${id}.mp4`;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseMultipartForm(buffer, boundary) {
  const parts = buffer.toString('latin1').split(`--${boundary}`);
  const fields = {};

  for (const part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;

    const [rawHeaders, rawValue = ''] = part.split('\r\n\r\n');
    if (!rawHeaders || !rawValue) continue;

    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const cleanedValue = rawValue.replace(/\r\n$/, '').replace(/\r\n--$/, '');
    const valueBuffer = Buffer.from(cleanedValue, 'latin1');
    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/i);

    if (filenameMatch && filenameMatch[1]) {
      fields[name] = {
        filename: filenameMatch[1],
        size: valueBuffer.length
      };
      continue;
    }

    fields[name] = valueBuffer.toString('utf8');
  }

  return fields;
}

function getPhotoToVideoInput(req) {
  const contentType = String(req.headers['content-type'] || '');

  if (contentType.includes('multipart/form-data')) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return { error: 'multipart boundary is required' };
    }

    const fields = parseMultipartForm(req.body, boundaryMatch[1]);
    return {
      prompt: String(fields.prompt || '').trim(),
      allowNsfw: normalizeBoolean(fields.allow_nsfw),
      photo: fields.photo || null
    };
  }

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return {
      prompt: String(req.body.prompt || '').trim(),
      allowNsfw: normalizeBoolean(req.body.allow_nsfw),
      photo: req.body.photo || req.body.image || req.body.init_image || null
    };
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let parsed = {};

  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { error: 'invalid JSON body' };
    }
  }

  return {
    prompt: String(parsed.prompt || '').trim(),
    allowNsfw: normalizeBoolean(parsed.allow_nsfw),
    photo: parsed.photo || parsed.image || parsed.init_image || null
  };
}

async function simulateGeneration(jobId) {
  updateJob(jobId, { status: 'processing' });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  updateJob(jobId, {
    status: 'completed',
    url: fakeVideoUrl(jobId)
  });
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    api_configured: Boolean(REPLICATE_API_KEY)
  });
});

app.get('/videos/:fileName', (_req, res) => {
  res.redirect(DEMO_VIDEO_URL);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'Job not found' });
  }
  res.json({ ok: true, job });
});

app.get('/api/jobs', (_req, res) => {
  res.json({ ok: true, jobs: Array.from(jobs.values()).reverse() });
});

app.post('/api/generate', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const duration = Number(req.body?.duration || 10);

  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'prompt is required' });
  }

  const job = createJob(prompt, duration, 'video');
  simulateGeneration(job.id).catch((error) => {
    updateJob(job.id, {
      status: 'failed',
      error: error?.message || 'generation failed'
    });
  });

  res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    url: fakeVideoUrl(job.id)
  });
});

app.post('/api/generate-video', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const duration = Number(req.body?.duration || 10);

  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'prompt is required' });
  }

  const job = createJob(prompt, duration, 'video');
  simulateGeneration(job.id).catch((error) => {
    updateJob(job.id, {
      status: 'failed',
      error: error?.message || 'generation failed'
    });
  });

  res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    url: fakeVideoUrl(job.id)
  });
});

app.post('/api/photo-to-video', express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  const input = getPhotoToVideoInput(req);

  if (input.error) {
    return res.status(400).json({ ok: false, error: input.error });
  }

  if (!input.photo) {
    return res.status(400).json({ ok: false, error: 'photo is required' });
  }

  const prompt = input.prompt || 'Smooth animation and elegant motion';
  const job = createJob(prompt, 10, 'photo-to-video');
  updateJob(job.id, {
    allow_nsfw: input.allowNsfw,
    source: 'photo-upload'
  });

  simulateGeneration(job.id).catch((error) => {
    updateJob(job.id, {
      status: 'failed',
      error: error?.message || 'photo to video generation failed'
    });
  });

  res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    kind: 'photo-to-video',
    prompt,
    allow_nsfw: input.allowNsfw,
    url: fakeVideoUrl(job.id)
  });
});

app.post('/api/tts', (req, res) => {
  const text = String(req.body?.text || '').trim();
  const voiceId = String(req.body?.voiceId || '').trim();
  const format = String(req.body?.format || 'mp3_44100_128').trim();

  if (!text) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }

  res.json({
    ok: true,
    text,
    voiceId: voiceId || 'default',
    format,
    url: `${API_BASE_URL}/audio/generated-${Date.now()}.mp3`
  });
});

app.post('/api/generate-image', (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();

  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'prompt is required' });
  }

  res.json({
    ok: true,
    url: `https://placehold.co/1024x1024/png?text=${encodeURIComponent(prompt.slice(0, 30))}`
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`REPLICATE_API_KEY: ${REPLICATE_API_KEY ? 'configured' : 'missing'}`);
});
