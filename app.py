import os
import time

import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
# El CORS es vital para que GitHub Pages pueda comunicarse con este servidor sin bloqueos
CORS(app, resources={r"/*": {"origins": "*"}})

# Configura KLING_API_KEY en tu archivo .env o en las variables del servidor
KLING_API_KEY = os.getenv("KLING_API_KEY", "")
KLING_API_BASE = os.getenv("KLING_API_BASE", "https://api.klingai.com").rstrip("/")
KLING_MODEL = os.getenv("KLING_MODEL", "kling-v3")
POLL_INTERVAL = float(os.getenv("KLING_POLL_INTERVAL", "5"))
POLL_TIMEOUT = float(os.getenv("KLING_POLL_TIMEOUT", "300"))
REQUEST_TIMEOUT = 30


def _headers():
    return {
        "Authorization": "Bearer " + KLING_API_KEY,
        "Content-Type": "application/json",
    }


def _endpoint(has_image):
    kind = "image2video" if has_image else "text2video"
    return f"{KLING_API_BASE}/v1/videos/{kind}"


def _extract_url(data):
    videos = (data.get("data") or {}).get("task_result", {}).get("videos") or []
    return videos[0].get("url") if videos else None


def _consultar(task_id, kind):
    return requests.get(
        f"{_endpoint(kind == 'image2video')}/{task_id}",
        headers=_headers(),
        timeout=REQUEST_TIMEOUT,
    )


@app.route('/generar-video', methods=['POST'])
def generar_video():
    if not KLING_API_KEY:
        return jsonify({"ok": False, "error": "KLING_API_KEY no está configurada en el servidor"}), 500

    datos = request.get_json(silent=True) or {}
    prompt = (datos.get('prompt') or '').strip()
    imagen = datos.get('image') or datos.get('init_image')
    if not prompt:
        return jsonify({"ok": False, "error": "El prompt es obligatorio"}), 400

    try:
        duracion = int(datos.get('duration') or 5)
    except (TypeError, ValueError):
        duracion = 5

    payload = {
        "model_name": KLING_MODEL,
        "prompt": prompt,
        "duration": str(duracion),
        "aspect_ratio": datos.get('aspectRatio') or datos.get('aspect_ratio') or "16:9",
    }
    if imagen:
        payload["image"] = imagen.split(",", 1)[1] if imagen.startswith("data:") and "," in imagen else imagen

    kind = "image2video" if imagen else "text2video"
    try:
        r = requests.post(_endpoint(bool(imagen)), json=payload, headers=_headers(), timeout=REQUEST_TIMEOUT)
        if r.status_code != 200:
            return jsonify({"ok": False, "error": f"Error en Kling AI: {r.text[:300]}"}), 502
        task_id = (r.json().get("data") or {}).get("task_id")
        if not task_id:
            return jsonify({"ok": False, "error": "Kling AI no devolvió task_id"}), 502

        # Polling hasta que el video esté listo
        limite = time.time() + POLL_TIMEOUT
        while time.time() < limite:
            time.sleep(POLL_INTERVAL)
            s = _consultar(task_id, kind)
            if s.status_code != 200:
                return jsonify({"ok": False, "error": f"Error consultando estado: {s.text[:300]}"}), 502
            sdata = s.json()
            estado = (sdata.get("data") or {}).get("task_status")
            if estado == "succeed":
                url = _extract_url(sdata)
                if not url:
                    return jsonify({"ok": False, "error": "El video no incluye URL"}), 502
                return jsonify({"ok": True, "url": url, "task_id": task_id})
            if estado == "failed":
                msg = (sdata.get("data") or {}).get("task_status_msg") or "La generación falló"
                return jsonify({"ok": False, "error": msg}), 502

        return jsonify({"ok": False, "error": "Tiempo de espera agotado", "task_id": task_id}), 504
    except requests.RequestException as e:
        return jsonify({"ok": False, "error": f"Error de conexión con Kling AI: {e}"}), 502
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# Consulta del estado del video (polling desde el frontend)
@app.route('/estado-video/<task_id>', methods=['GET'])
def estado_video(task_id):
    if not KLING_API_KEY:
        return jsonify({"ok": False, "error": "KLING_API_KEY no está configurada en el servidor"}), 500
    kind = "image2video" if request.args.get("tipo") == "image2video" else "text2video"
    try:
        r = _consultar(task_id, kind)
        data = r.json()
    except (requests.RequestException, ValueError) as e:
        return jsonify({"ok": False, "error": str(e)}), 502
    estado = (data.get("data") or {}).get("task_status")
    return jsonify({"ok": r.status_code == 200, "status": estado, "url": _extract_url(data), "raw": data}), (200 if r.status_code == 200 else 502)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv("PORT", "5000")))
