const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
// Allow CORS from any origin for testing; lock this down in production
app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));

const upload = multer({ dest: 'uploads/', limits: { fileSize: 12 * 1024 * 1024 } }); // 12MB

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// ensure logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

async function moderateImageBase64(base64) {
  if (!OPENAI_API_KEY) return { ok: true, detail: 'no-key' };
  try {
    const resp = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: base64 })
    });
    if (!resp.ok) return { ok: false, error: 'moderation-failed' };
    const data = await resp.json();
    const result = data.results && data.results[0] ? data.results[0] : null;
    return { ok: true, detail: result };
  } catch (err) {
    console.error('Moderation error', err);
    return { ok: false, error: 'moderation-exception' };
  }
}

function makeVideoFromImage(imagePath, outPath, duration = 6, width = 1280, height = 720) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-vf', `scale=${width}:${height},format=yuv420p`,
      '-c:v', 'libx264',
      '-t', String(duration),
      '-pix_fmt', 'yuv420p',
      outPath
    ];

    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', (d) => stderr += d.toString());
    ff.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}

function appendConsentLog(entry) {
  try {
    const file = path.join(logsDir, 'consent.log');
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to write consent log', e);
  }
}

app.post('/api/photo-to-video', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no-file' });

    const allowNSFW = req.body && (req.body.allow_nsfw === 'true' || req.body.allow_nsfw === '1');
    const userIdent = req.body && req.body.user ? req.body.user : null;

    const tempPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    if (!allowed.includes(ext)) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ ok: false, error: 'unsupported-format' });
    }

    const buffer = fs.readFileSync(tempPath);
    const base64 = buffer.toString('base64');

    // Moderation step
    const mod = await moderateImageBase64(base64);
    if (!mod.ok) {
      fs.unlinkSync(tempPath);
      return res.status(500).json({ ok: false, error: 'moderation-error', detail: mod.error || mod.detail });
    }

    const result = mod.detail || {};
    const flagged = result.flagged || false;
    const categories = result.categories || {};

    if (categories['sexual/minors'] || categories['child_sexual'] || categories['sexual_and_minor']) {
      fs.unlinkSync(tempPath);
      return res.status(403).json({ ok: false, error: 'blocked-minor-content' });
    }

    if (flagged && !allowNSFW) {
      fs.unlinkSync(tempPath);
      // Log attempted flagged upload without consent
      appendConsentLog({ time: new Date().toISOString(), user: userIdent, ip: req.ip, ua: req.get('User-Agent'), file: req.file.originalname, action: 'blocked-flagged-no-consent', moderation: result });
      return res.status(403).json({ ok: false, error: 'content-flagged', detail: result });
    }

    // Proceed to generate video
    const outName = `video_${Date.now()}.mp4`;
    const outDir = path.resolve(__dirname, 'public', 'media');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, outName);

    await makeVideoFromImage(tempPath, outPath, 6);

    // Clean up temp
    fs.unlinkSync(tempPath);

    // If NSFW consent was given, log it
    if (allowNSFW) {
      appendConsentLog({ time: new Date().toISOString(), user: userIdent, ip: req.ip, ua: req.get('User-Agent'), file: outName, action: 'consent-granted', moderation: result });
    }

    // Build absolute URL to return to client
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = process.env.BACKEND_URL || `${protocol}://${host}`;

    return res.json({ ok: true, url: `${baseUrl}/media/${outName}` });
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ ok: false, error: 'server-error', detail: err.message });
  }
});

// Route that forces download and registers download events (for auditing)
app.get('/media/download/:name', (req, res) => {
  try {
    const name = path.basename(req.params.name);
    const filePath = path.join(__dirname, 'public', 'media', name);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    // Log the download
    const user = req.query.user || null;
    appendConsentLog({ time: new Date().toISOString(), user, ip: req.ip, ua: req.get('User-Agent'), file: name, action: 'download' });

    return res.download(filePath, name);
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`photo-to-video server listening on ${PORT}`));
