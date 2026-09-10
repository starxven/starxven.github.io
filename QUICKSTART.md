# Quick start

```bash
cd backend
npm install
cp ../env.example .env
npm start
```

Then configure the provider-specific values in `backend/.env`:

- `REPLICATE_API_KEY`
- `CORS_ORIGIN`
- `REPLICATE_VIDEO_MODEL`
- `REPLICATE_PHOTO_TO_VIDEO_MODEL`
- optional `ELEVEN_API_KEY`

Test the local server:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A beautiful sunset over mountains","duration":5}'
```

If your Replicate model needs different input fields, update the matching `REPLICATE_*_INPUT_TEMPLATE` value in `.env` instead of editing the backend code.
