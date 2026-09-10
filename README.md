# Seguridad

- **No pongas API keys en frontend** (`dashboard.html`, `config.js`, etc.).
- Usa un backend/proxy para llamar a Replicate y ElevenLabs.
- Guarda las llaves en variables de entorno del backend.

## Frontend

Edita `config.js` y reemplaza:

```js
window.APP_CONFIG = {
  API_BASE_URL: "https://TU-BACKEND.com"
};
```

## Endpoints esperados por `dashboard.html`

- `POST /api/generate`
  - Body JSON: `{ "prompt": "..." }`
- `POST /api/tts`
  - Body JSON: `{ "text": "...", "voiceId": "...", "format": "..." }`

`dashboard.html` carga `config.js` en tiempo de ejecución y usa `window.APP_CONFIG.API_BASE_URL` como base para las llamadas al backend fuera de `localhost`. En desarrollo local mantiene `http://localhost:3000` como base.

Ambos deben responder JSON. El backend también mantiene `POST /api/generate-video` como alias compatible para generación de video.
