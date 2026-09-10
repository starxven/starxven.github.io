const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

async function withServer(run) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('GET /health returns JSON health information', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.api_configured, 'boolean');
    assert.equal(typeof payload.services, 'object');
  });
});

test('POST /api/generate validates missing prompt', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 5 })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'VALIDATION_ERROR');
  });
});

test('POST /api/generate-video validates missing prompt', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 5 })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'VALIDATION_ERROR');
  });
});

test('POST /api/photo-to-video requires a photo source', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/photo-to-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Animate this' })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'VALIDATION_ERROR');
  });
});

test('POST /api/photo-to-video accepts JSON data URL payloads', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/photo-to-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Animate this',
        photoData: 'data:image/png;base64,ZmFrZQ=='
      })
    });

    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'PROVIDER_NOT_CONFIGURED');
  });
});

test('POST /api/tts rejects unsafe format values', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hola', format: '../../bad' })
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'VALIDATION_ERROR');
  });
});
