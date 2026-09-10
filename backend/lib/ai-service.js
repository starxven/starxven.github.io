const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const GENERATED_DIR = path.join(__dirname, '..', 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const DEFAULT_REPLICATE_TEMPLATES = {
  video: {
    prompt: '{{prompt}}',
    duration: '{{duration}}'
  },
  image: {
    prompt: '{{prompt}}',
    aspect_ratio: '16:9',
    output_format: 'png'
  },
  photoToVideo: {
    prompt: '{{prompt}}',
    input_image: '{{image}}',
    duration: '{{duration}}',
    allow_nsfw: '{{allowNsfw}}'
  }
};

class HttpError extends Error {
  constructor(statusCode, message, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function toClampedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function trimOrEmpty(value) {
  return String(value || '').trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getReplicateApiBaseUrl() {
  return stripTrailingSlash(process.env.REPLICATE_API_BASE_URL || 'https://api.replicate.com/v1');
}

function getReplicateApiKey() {
  return trimOrEmpty(process.env.REPLICATE_API_KEY);
}

function getElevenLabsApiBaseUrl() {
  return stripTrailingSlash(process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io/v1');
}

function getElevenLabsApiKey() {
  return trimOrEmpty(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY);
}

function getDefaultElevenLabsVoiceId() {
  return trimOrEmpty(process.env.ELEVENLABS_DEFAULT_VOICE_ID || process.env.ELEVEN_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM');
}

function getDefaultElevenLabsModelId() {
  return trimOrEmpty(process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2');
}

function getReplicateTimeoutMs() {
  return toClampedInteger(process.env.REPLICATE_TIMEOUT_MS, 180000, 10000, 600000);
}

function getReplicatePollIntervalMs() {
  return toClampedInteger(process.env.REPLICATE_POLL_INTERVAL_MS, 2000, 500, 10000);
}

function getReplicateConfig(kind) {
  const prefix = kind === 'photoToVideo' ? 'REPLICATE_PHOTO_TO_VIDEO' : `REPLICATE_${kind.toUpperCase()}`;
  const model = trimOrEmpty(process.env[`${prefix}_MODEL`]);
  const version = trimOrEmpty(process.env[`${prefix}_VERSION`]);
  const template = parseTemplate(
    trimOrEmpty(process.env[`${prefix}_INPUT_TEMPLATE`]),
    DEFAULT_REPLICATE_TEMPLATES[kind]
  );

  return { model, version, template };
}

function parseTemplate(templateValue, fallback) {
  if (!templateValue) return fallback;

  try {
    return JSON.parse(templateValue);
  } catch (error) {
    throw new HttpError(
      500,
      'Provider input template is not valid JSON',
      'INVALID_PROVIDER_TEMPLATE',
      { templateValue, cause: error.message }
    );
  }
}

function applyTemplate(value, context) {
  if (Array.isArray(value)) {
    return value.map((item) => applyTemplate(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, applyTemplate(nestedValue, context)])
    );
  }

  if (typeof value !== 'string') {
    return value;
  }

  const exactMatch = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
  if (exactMatch) {
    return context[exactMatch[1]];
  }

  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const replacement = context[key];
    return replacement == null ? '' : String(replacement);
  });
}

function getHealthSummary() {
  const videoConfig = getReplicateConfig('video');
  const imageConfig = getReplicateConfig('image');
  const photoConfig = getReplicateConfig('photoToVideo');
  const replicateApiKey = getReplicateApiKey();
  const elevenLabsApiKey = getElevenLabsApiKey();

  return {
    ok: true,
    status: 'ok',
    api_configured: Boolean(replicateApiKey || elevenLabsApiKey),
    services: {
      replicate: Boolean(replicateApiKey),
      elevenlabs: Boolean(elevenLabsApiKey),
      video: Boolean(replicateApiKey && (videoConfig.model || videoConfig.version)),
      image: Boolean(replicateApiKey && (imageConfig.model || imageConfig.version)),
      photoToVideo: Boolean(replicateApiKey && (photoConfig.model || photoConfig.version)),
      tts: Boolean(elevenLabsApiKey)
    }
  };
}

async function generateVideoFromPrompt({ prompt, duration, baseUrl }) {
  return generateReplicateAsset('video', { prompt, duration }, { baseUrl, prefix: 'video', preferredExtension: 'mp4' });
}

async function generateImageFromPrompt({ prompt, baseUrl }) {
  return generateReplicateAsset('image', { prompt }, { baseUrl, prefix: 'image', preferredExtension: 'png' });
}

async function generateVideoFromPhoto({ prompt, duration, image, allowNsfw, baseUrl }) {
  return generateReplicateAsset(
    'photoToVideo',
    { prompt, duration, image, allowNsfw },
    { baseUrl, prefix: 'photo-video', preferredExtension: 'mp4' }
  );
}

async function generateSpeech({ text, voiceId, format, baseUrl }) {
  const elevenLabsApiKey = getElevenLabsApiKey();
  if (!elevenLabsApiKey) {
    throw new HttpError(503, 'ELEVENLABS_API_KEY is not configured', 'PROVIDER_NOT_CONFIGURED');
  }

  const resolvedVoiceId = trimOrEmpty(voiceId) || getDefaultElevenLabsVoiceId();
  const outputFormat = trimOrEmpty(format) || 'mp3_44100_128';
  const url = `${getElevenLabsApiBaseUrl()}/text-to-speech/${encodeURIComponent(resolvedVoiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'xi-api-key': elevenLabsApiKey
    },
    body: JSON.stringify({
      text,
      model_id: getDefaultElevenLabsModelId()
    })
  });

  if (!response.ok) {
    throw await createProviderError(response, 'ELEVENLABS_REQUEST_FAILED', 'Text-to-speech generation failed');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return persistBufferAsset(buffer, {
    baseUrl,
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    prefix: 'audio',
    preferredExtension: inferAudioExtension(outputFormat)
  });
}

async function generateReplicateAsset(kind, context, assetOptions) {
  if (!getReplicateApiKey()) {
    throw new HttpError(503, 'REPLICATE_API_KEY is not configured', 'PROVIDER_NOT_CONFIGURED');
  }

  const config = getReplicateConfig(kind);
  if (!config.model && !config.version) {
    throw new HttpError(503, `${kind} provider model is not configured`, 'PROVIDER_NOT_CONFIGURED');
  }

  const predictionPayload = {
    input: applyTemplate(config.template, context)
  };

  if (config.version) {
    predictionPayload.version = config.version;
  } else {
    predictionPayload.model = config.model;
  }

  const prediction = await createPrediction(predictionPayload);

  const resolvedPrediction = await waitForPrediction(prediction);
  const remoteUrl = extractAssetUrl(resolvedPrediction.output);

  if (!remoteUrl) {
    throw new HttpError(502, 'Provider response did not include a downloadable asset URL', 'INVALID_PROVIDER_RESPONSE', {
      output: resolvedPrediction.output
    });
  }

  return downloadRemoteAsset(remoteUrl, assetOptions);
}

async function createPrediction(payload) {
  const response = await fetch(`${getReplicateApiBaseUrl()}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${getReplicateApiKey()}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await createProviderError(response, 'REPLICATE_REQUEST_FAILED', 'Generation request failed');
  }

  return response.json();
}

async function waitForPrediction(prediction) {
  let current = prediction;
  const startedAt = Date.now();

  while (current) {
    if (current.status === 'succeeded') {
      return current;
    }

    if (current.status === 'failed' || current.status === 'canceled') {
      throw new HttpError(502, current.error || `Generation ${current.status}`, 'REPLICATE_PREDICTION_FAILED', current);
    }

    if (Date.now() - startedAt > getReplicateTimeoutMs()) {
      throw new HttpError(504, 'Generation timed out while waiting for the provider', 'PROVIDER_TIMEOUT', {
        predictionId: current.id,
        status: current.status
      });
    }

    await delay(getReplicatePollIntervalMs());
    const pollUrl = current.urls && current.urls.get
      ? current.urls.get
      : `${getReplicateApiBaseUrl()}/predictions/${encodeURIComponent(current.id)}`;

    current = await pollPrediction(pollUrl);
  }

  throw new HttpError(502, 'Provider response ended unexpectedly', 'INVALID_PROVIDER_RESPONSE');
}

async function pollPrediction(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${getReplicateApiKey()}`
    }
  });

  if (!response.ok) {
    throw await createProviderError(response, 'REPLICATE_POLL_FAILED', 'Could not fetch generation status');
  }

  return response.json();
}

function extractAssetUrl(output) {
  if (!output) return null;

  if (typeof output === 'string') {
    return output;
  }

  if (Array.isArray(output)) {
    for (const item of output) {
      const candidate = extractAssetUrl(item);
      if (candidate) return candidate;
    }
    return null;
  }

  if (typeof output === 'object') {
    if (typeof output.url === 'string') return output.url;

    for (const value of Object.values(output)) {
      const candidate = extractAssetUrl(value);
      if (candidate) return candidate;
    }
  }

  return null;
}

async function downloadRemoteAsset(sourceUrl, options) {
  validateProviderAssetUrl(sourceUrl);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new HttpError(502, 'Generated asset could not be downloaded from the provider', 'ASSET_DOWNLOAD_FAILED', {
      sourceUrl,
      status: response.status
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return persistBufferAsset(buffer, {
    ...options,
    sourceUrl,
    contentType: response.headers.get('content-type') || undefined
  });
}

function validateProviderAssetUrl(sourceUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch (_error) {
    throw new HttpError(502, 'Provider returned an invalid asset URL', 'INVALID_PROVIDER_RESPONSE');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new HttpError(502, 'Provider asset URL must use HTTPS', 'INVALID_PROVIDER_RESPONSE');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const allowedHosts = getAllowedProviderAssetHosts();
  const isAllowed = allowedHosts.some((candidate) => hostnameMatches(candidate, hostname));

  if (!isAllowed) {
    throw new HttpError(502, 'Provider returned an asset URL from an untrusted host', 'INVALID_PROVIDER_RESPONSE', {
      hostname
    });
  }
}

function persistBufferAsset(buffer, { baseUrl, contentType, prefix, preferredExtension, sourceUrl }) {
  const extension = inferFileExtension({ contentType, sourceUrl, preferredExtension });
  const filename = `${prefix}-${Date.now()}-${randomUUID()}.${extension}`;
  const outputPath = path.join(GENERATED_DIR, filename);

  fs.writeFileSync(outputPath, buffer);

  return {
    url: `${stripTrailingSlash(baseUrl)}/generated/${filename}`,
    filename,
    contentType: contentType || null
  };
}

function inferFileExtension({ contentType, sourceUrl, preferredExtension }) {
  const normalizedContentType = trimOrEmpty(contentType).toLowerCase().split(';')[0];
  const byContentType = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };

  if (normalizedContentType && byContentType[normalizedContentType]) {
    return byContentType[normalizedContentType];
  }

  if (sourceUrl) {
    try {
      const pathname = new URL(sourceUrl).pathname;
      const extension = path.extname(pathname).replace('.', '').toLowerCase();
      if (extension) return extension;
    } catch (_error) {
      if (String(sourceUrl).startsWith('data:')) {
        const match = String(sourceUrl).match(/^data:([^;,]+)/i);
        if (match && byContentType[match[1].toLowerCase()]) {
          return byContentType[match[1].toLowerCase()];
        }
      }
    }
  }

  return preferredExtension || 'bin';
}

function inferAudioExtension(format) {
  const normalized = trimOrEmpty(format).toLowerCase();
  if (normalized.startsWith('wav')) return 'wav';
  if (normalized.startsWith('ulaw')) return 'ulaw';
  if (normalized.startsWith('pcm')) return 'pcm';
  return 'mp3';
}

function getAllowedProviderAssetHosts() {
  const configured = trimOrEmpty(process.env.ALLOWED_PROVIDER_ASSET_HOSTS);
  if (configured) {
    return configured
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  return ['replicate.delivery', '*.replicate.delivery'];
}

function hostnameMatches(candidate, hostname) {
  if (candidate.startsWith('*.')) {
    const suffix = candidate.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return hostname === candidate;
}

async function createProviderError(response, code, fallbackMessage) {
  const rawText = await response.text();
  let payload;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    payload = rawText;
  }

  const message = extractErrorMessage(payload) || fallbackMessage;
  return new HttpError(response.status >= 500 ? 502 : response.status, message, code, payload);
}

function extractErrorMessage(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload.detail === 'string') return payload.detail;
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.message === 'string') return payload.message;
  if (payload.detail && typeof payload.detail === 'object') {
    return extractErrorMessage(payload.detail);
  }
  return null;
}

module.exports = {
  HttpError,
  generateImageFromPrompt,
  generateSpeech,
  generateVideoFromPhoto,
  generateVideoFromPrompt,
  getHealthSummary
};
