const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MOCK_AI_PROVIDER = '1';
process.env.ASSET_PROXY_ALLOWED_HOSTS = '*.replicate.delivery,127.0.0.1';
const { app, __internals } = require('./server');

let server;
let baseUrl;

test.before(() => {
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  if (server) server.close();
});

async function postJson(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

test('GET /health returns status payload', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'ok');
});

test('POST /api/generate validates prompt and supports success response', async () => {
  const bad = await postJson('/api/generate', { duration: 5 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.code, 'PROMPT_REQUIRED');

  const ok = await postJson('/api/generate', { prompt: 'cinematic waterfall', duration: 6 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.url, /\/api\/assets\?url=/);
});

test('POST /api/generate-video supports success response', async () => {
  const ok = await postJson('/api/generate-video', { prompt: 'night city timelapse', duration: 8 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.url, /\/api\/assets\?url=/);
});

test('POST /api/generate-image validates prompt and supports success response', async () => {
  const bad = await postJson('/api/generate-image', {});
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.code, 'PROMPT_REQUIRED');

  const ok = await postJson('/api/generate-image', { prompt: 'futuristic robot portrait' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.url, /\/api\/assets\?url=/);
});

test('POST /api/photo-to-video validates photo and supports success response', async () => {
  const bad = await postJson('/api/photo-to-video', { prompt: 'animate this photo' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.code, 'PHOTO_REQUIRED');

  const form = new FormData();
  form.append('photo', new Blob(['test-image-bytes'], { type: 'image/png' }), 'sample.png');
  form.append('prompt', 'soft cinematic movement');
  form.append('allow_nsfw', '0');
  const response = await fetch(`${baseUrl}/api/photo-to-video`, {
    method: 'POST',
    body: form
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.url, /\/api\/assets\?url=/);
});

test('POST /api/tts validates text and supports success response', async () => {
  const bad = await postJson('/api/tts', {});
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.code, 'TEXT_REQUIRED');

  const ok = await postJson('/api/tts', { text: 'hola mundo', format: 'mp3_44100_128' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.url, /\/generated\/tts-/);

  const served = await fetch(ok.body.url);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type') || '', /audio|octet-stream/i);
});

test('GET /api/assets rejects non-allowlisted hosts', async () => {
  const response = await fetch(`${baseUrl}/api/assets?url=${encodeURIComponent('https://example.com/test.mp4')}`);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'ASSET_HOST_FORBIDDEN');
});

test('GET /api/assets rejects allowlisted host resolving to private IP', async () => {
  const response = await fetch(`${baseUrl}/api/assets?url=${encodeURIComponent('http://127.0.0.1:3000/health')}`);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'ASSET_HOST_PRIVATE_IP');
});

test('asset fetch helper blocks redirect responses', async () => {
  const fakeFetch = async () => ({
    status: 302,
    ok: false,
    headers: {
      get(name) {
        return name.toLowerCase() === 'location' ? 'https://example.com/next' : null;
      }
    }
  });

  await assert.rejects(
    () => __internals.fetchUpstreamAsset('https://sub.replicate.delivery/video.mp4', fakeFetch),
    (error) => error && error.code === 'ASSET_REDIRECT_BLOCKED'
  );
});
