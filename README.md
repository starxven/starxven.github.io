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

- `dashboard.html` carga `config.js` antes de ejecutar su script.
- En `localhost` y `127.0.0.1`, el dashboard usa `http://localhost:3000`.
- Fuera de local, el dashboard usa `window.APP_CONFIG.API_BASE_URL` y rechaza rutas relativas o el mismo origen de GitHub Pages para evitar peticiones a `https://starxven.github.io/api/...`.

## Endpoints esperados por `dashboard.html`

- `POST /api/generate`
  - Body JSON: `{ "prompt": "...", "duration": 10 }`
- `POST /api/generate-video`
  - Body JSON: `{ "prompt": "..." }`
- `POST /api/tts`
  - Body JSON: `{ "text": "...", "voiceId": "...", "format": "..." }`

Ambos deben responder JSON.
