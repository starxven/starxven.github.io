# th3dr4k3r.ia — generador de vídeo con IA

Frontend estático (GitHub Pages) + backend Node/Express (Render) que usa Replicate (Wan 2.7).

## Estructura

- `index.html`, `login.html`, `dashboard.html`, `style.css` → frontend (GitHub Pages).
- `config.js` → define `window.APP_CONFIG.API_BASE_URL` (URL pública del backend en Render).
- `backend/server.js` → backend Express. `backend/render.yaml` → configuración de Render.

## Autenticación

Demo solo en el navegador (localStorage): `login.html` guarda la sesión en `th3dr4k3r_session` y `dashboard.html` redirige a `login.html` si no existe. No es seguridad real.

## Backend

```bash
cd backend
npm install
cp .env.example .env   # define REPLICATE_API_TOKEN (o REPLICATE_API_KEY)
npm start              # escucha en PORT (por defecto 10000)
```

Endpoints:

- `GET /health` → `{ "ok": true, "api_configured": true }`
- `POST /api/generate` → body JSON `{ prompt, duration, aspectRatio, model, style, sound, init_image? }` (`init_image` = data URI base64). Responde `{ ok, url, ... }`.

Prueba:

```bash
curl -X POST http://localhost:10000/api/generate -H "Content-Type: application/json" \
  -d '{"prompt":"Atardecer sobre el mar","duration":5}'
```

## Despliegue

1. Render: Web Service con root directory `backend`, build `npm install`, start `npm start`, variable `REPLICATE_API_TOKEN`.
2. Pon la URL de Render en `config.js` (`API_BASE_URL`, sin `/api/generate`).
3. Abre `https://TU-SERVICIO.onrender.com/health` y comprueba `ok: true`.
4. Publica el frontend en GitHub Pages.

## Seguridad y costes

Nunca subas `.env` ni tokens al repositorio ni al frontend. Replicate cobra por segundo de vídeo y borra las salidas tras ~1 hora.
