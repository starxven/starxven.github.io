# 🚀 Setup th3dr4k3r.ia Backend

## Prerequisites

- Node.js v16+
- npm or yarn
- Replicate account (for AI video generation)

## Installation Steps

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Get Replicate API Key

1. Go to https://replicate.com
2. Sign up or log in
3. Go to **Account** → **API Tokens**
4. Copy your API token

### 3. Configure Environment

Edit `.env` in the root directory:

```env
REPLICATE_API_KEY=your_actual_api_key_here
PORT=3000
```

### 4. Start the Server

```bash
cd backend
npm start
```

You should see:
```
🚀 Server running on http://localhost:3000
✅ REPLICATE_API_KEY: configured
```

### 5. Test the API

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A beautiful sunset over mountains", "duration": 5}'
```

Response (example):
```json
{
  "ok": true,
  "url": "http://localhost:3000/videos/generated-1694123456789.mp4"
}
```

## Frontend Integration

The dashboard (`dashboard.html`) is already configured to:
- Call `/api/generate` for text-to-video
- Call `/api/generate-image` for image generation
- Call `/api/photo-to-video` for photo conversion
- Resolve the production backend URL from `config.js`

## Deployment

### Option A: Deploy on Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd backend
vercel --prod
```

### Option B: Deploy on Railway

1. Push code to GitHub
2. Go to https://railway.app
3. Create new project from GitHub repo
4. Add `REPLICATE_API_KEY` environment variable
5. Deploy

### Option C: Deploy on Render

1. Go to https://render.com
2. Create new Web Service
3. Connect GitHub repo
4. Set environment variables
5. Deploy

## Troubleshooting

### "REPLICATE_API_KEY not configured"
→ Check `.env` file and make sure key is set correctly

### "Video generation timeout"
→ The simulated backend delay is defined in `backend/server.js` inside `simulateGeneration()`

### CORS errors in browser
→ CORS is already enabled; check browser console for actual error

### Videos not downloading
→ Make sure the `/videos/...` URL returned by the backend is reachable from the browser

## API Endpoints

### POST /api/generate
Generate video from text prompt.

**Request:**
```json
{
  "prompt": "A drone flying over a cyberpunk city at dawn",
  "duration": 10
}
```

**Response:**
```json
{
  "ok": true,
  "jobId": "1",
  "status": "queued",
  "url": "http://localhost:3000/videos/generated-1.mp4"
}
```

### POST /api/photo-to-video
Convert an uploaded image into a simulated video result.

**Request:** `multipart/form-data`
- `photo`: image file
- `allow_nsfw`: `0` or `1`
- `prompt`: optional motion prompt

**Response:**
```json
{
  "ok": true,
  "jobId": "2",
  "status": "queued",
  "kind": "photo-to-video",
  "url": "http://localhost:3000/videos/generated-2.mp4"
}
```

### POST /api/generate-image
Generate image from text prompt.

**Request:**
```json
{
  "prompt": "A futuristic AI robot portrait"
}
```

**Response:**
```json
{
  "ok": true,
  "url": "https://replicate.delivery/..."
}
```

### GET /health
Server health check.

**Response:**
```json
{
  "ok": true,
  "api_configured": true
}
```

## FAQ

**Q: Do I need to pay for Replicate?**
A: No, but you get free credits ($5/month). Video generation is fast and cheap (~$0.03 per 10s video).

**Q: Can I use other AI models?**
A: Yes! Replace the backend implementation in `backend/server.js` with your preferred provider integration.

**Q: How long does video generation take?**
A: Typically 30-90 seconds depending on prompt complexity and queue.

---

Need help? Open an issue on GitHub!
