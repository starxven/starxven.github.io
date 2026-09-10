# Backend setup

## Requirements

- Node.js 18+
- npm
- A Replicate API key for image/video generation
- An ElevenLabs API key if you want `/api/tts`

## Install

```bash
cd backend
npm install
```

## Configure environment

Copy `env.example` into either `backend/.env` or the repository root `.env` and fill in the values you need.

Minimum settings:

```env
REPLICATE_API_KEY=your_replicate_key
PORT=3000
CORS_ORIGIN=http://localhost:8080
ALLOWED_PROVIDER_ASSET_HOSTS=replicate.delivery,*.replicate.delivery
REPLICATE_VIDEO_MODEL=your_text_to_video_model
REPLICATE_PHOTO_TO_VIDEO_MODEL=your_image_to_video_model
```

Optional TTS settings:

```env
ELEVEN_API_KEY=your_elevenlabs_key
ELEVENLABS_DEFAULT_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

`env.example` also includes `REPLICATE_*_INPUT_TEMPLATE` overrides so you can adapt the request body to the exact Replicate model you deploy without editing application code.

## Start locally

```bash
cd backend
npm start
```

The backend listens on `PORT=3000` by default and serves generated files back from `/generated/*`.

## Health check

```bash
curl http://localhost:3000/health
```

Example response:

```json
{
  "ok": true,
  "status": "ok",
  "api_configured": true,
  "services": {
    "replicate": true,
    "elevenlabs": false,
    "video": true,
    "image": true,
    "photoToVideo": true,
    "tts": false
  }
}
```

## Route contract

### POST /api/generate
### POST /api/generate-video

Request:

```json
{
  "prompt": "A cinematic drone shot over a neon city",
  "duration": 10
}
```

Success response:

```json
{
  "ok": true,
  "url": "http://localhost:3000/generated/video-...mp4"
}
```

### POST /api/generate-image

Request:

```json
{
  "prompt": "A futuristic portrait with dramatic lighting"
}
```

### POST /api/photo-to-video

Accepts either multipart form data with a `photo` file field or JSON with a `photoData` / `imageData` data URL, plus optional `prompt`, `duration`, and NSFW flags. Supported NSFW flag names are `allow_nsfw` and `allowNSFW`.

### POST /api/tts

Request:

```json
{
  "text": "Hola mundo",
  "voiceId": "21m00Tcm4TlvDq8ikWAM",
  "format": "mp3_44100_128"
}
```

All error responses follow the same shape:

```json
{
  "ok": false,
  "error": "clear message",
  "code": "VALIDATION_ERROR"
}
```
