# th3dr4k3r.ia — GitHub Pages + Render

## Arquitectura

- `dashboard.html` y `config.js` → GitHub Pages.
- `server.js` → Render Web Service.
- Replicate/Wan 2.7 → generación real de vídeo.

## Importante

No subas `.env` ni ningún token de Replicate a GitHub.

### 1. Backend en Render

Crea un **Web Service** conectado al repositorio.

Build:
`npm install`

Start:
`npm start`

Añade la variable:
`REPLICATE_API_TOKEN`

El `render.yaml` incluido puede servir como configuración inicial.

### 2. Frontend en GitHub Pages

Después de desplegar Render, copia la URL que te da Render, por ejemplo:

`https://th3dr4k3r-api.onrender.com`

y ponla en `config.js`:

`window.APP_CONFIG = { API_BASE_URL: "https://th3dr4k3r-api.onrender.com" };`

### 3. Prueba

Abre:

`https://TU-SERVICIO.onrender.com/health`

Debe devolver JSON con `ok: true` y `api_configured: true`.

Después abre tu GitHub Pages y pulsa **Generar Video con IA**.

## Costes

Render ofrece Web Services gratuitos con limitaciones. La generación de vídeo mediante Replicate no es un servicio de inferencia gratuito: el modelo utilizado puede cobrar por el vídeo generado. Wan 2.7 está tarifado por segundo de vídeo en Replicate.

Los vídeos de Replicate obtenidos por API se eliminan automáticamente después de aproximadamente una hora si no guardas una copia en almacenamiento propio.
