const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));

const upload = multer({ dest: 'uploads/', limits: { fileSize: 12 * 1024 * 1024 } }); // 12MB

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function moderateImageBase64(base64) {
  // Calls OpenAI Moderation API. In production ensure the request meets the API's image moderation requirements.
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
    // Simple approach: loop image for `duration` seconds
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

app.post('/api/photo-to-video', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no-file' });

    const allowNSFW = req.body && (req.body.allow_nsfw === 'true' || req.body.allow_nsfw === '1');

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

    // Interpret moderation result (best-effort): if category 'sexual/minors' flagged, always block.
    const result = mod.detail || {};
    const flagged = result.flagged || false;
    const categories = result.categories || {};

    // If moderation explicitly indicates sexual content involving minors, block.
    if (categories['sexual/minors'] || categories['child_sexual'] || categories['sexual_and_minor']) {
      fs.unlinkSync(tempPath);
      return res.status(403).json({ ok: false, error: 'blocked-minor-content' });
    }

    // If flagged but user did not consent to NSFW, block.
    if (flagged && !allowNSFW) {
      fs.unlinkSync(tempPath);
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

    // Return public URL
    return res.json({ ok: true, url: `/media/${outName}` });
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ ok: false, error: 'server-error', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`photo-to-video server listening on ${PORT}`));
