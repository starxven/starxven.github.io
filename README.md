# Generador de ideas de video con IA y exportación a MP4

Este proyecto permite describir una idea y generar un pack listo para un video: título, guion, estilo visual, prompt para imagen, prompt para video, archivo de texto y exportación a MP4.

Última actualización: 2026-09-05T18:57:32Z

## Requisitos

- Python 3.10+
- Una clave de API de OpenAI
- ffmpeg instalado en el sistema si quieres exportar vídeo real con más control

## Instalación

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edita `.env`:

```env
OPENAI_API_KEY=tu_clave_aqui
MODEL_NAME=gpt-4o-mini
```

## Ejecutar desde consola

```bash
python app.py --prompt "Un drone sobrevolando una ciudad futurista al amanecer, estilo cyberpunk" --duracion 2 --guardar salida.txt --export-mp4
```

Esto genera:
- un archivo de texto con la idea del video
- un MP4 simple con la secuencia visual creada a partir del contenido

También puedes usarlo sin parámetros y escribir la idea directamente en la consola.

## Ejecutar con interfaz gráfica

```bash
python app_gui.py
```

## Qué genera

- título
- descripción general
- guion por escenas
- prompt para imagen
- prompt para video
- estilo visual
- tono de voz
- palabras clave
- archivo de texto guardado opcional
- exportación a MP4

## Estructura

- `app.py`: lógica principal con consola
- `app_gui.py`: interfaz gráfica simple con Tkinter
- `test_app.py`: pruebas básicas
- `.env.example`: ejemplo de configuración
- `requirements.txt`: dependencias
