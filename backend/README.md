# Backend API

## Run locally

```bash
cd backend
npm install
PORT=3000 npm start
```

## Required env vars

- `REPLICATE_API_KEY` for video/image generation
- `ELEVEN_API_KEY` for text-to-speech

Optional:

- `PUBLIC_BASE_URL` for absolute URLs behind a proxy
- `CORS_ORIGIN` comma-separated allowed origins (`*` by default)
- `REPLICATE_TEXT_TO_VIDEO_MODEL`
- `REPLICATE_TEXT_TO_IMAGE_MODEL`
- `REPLICATE_IMAGE_TO_VIDEO_MODEL`
- `ELEVEN_DEFAULT_VOICE_ID`
- `ELEVEN_DEFAULT_FORMAT`

## Supported endpoints

- `GET /health`
- `POST /api/generate`
- `POST /api/generate-video`
- `POST /api/generate-image`
- `POST /api/photo-to-video`
- `POST /api/tts`
