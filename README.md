# Mesa247 — Lista de espera digital

Prueba técnica: el comensal escanea un QR y se une a la cola; el anfitrión ve la cola en una tablet y llama al siguiente.

| Carpeta | Qué hay |
|---|---|
| [`backend/`](backend/) | API en FastAPI + SQLAlchemy 2 + SQLite, con tests (pytest). |
| [`frontend/`](frontend/) | React 18 + TypeScript + Vite: pantallas del comensal (`/l/:slug`, `/t/:token`) y de la tablet (`/tablet`), con tests (Vitest). |

## Levantarlo con Docker (recomendado)

Requisitos: Docker con Compose v2 y `make`.

```bash
make up      # construye las imágenes, levanta todo y espera a que esté sano
make seed    # crea los locales demo e imprime los tokens de las tablets
```

- Comensal: http://localhost:8080/l/demo-lima
- Tablet: http://localhost:8080/tablet (pegar un token de Demo Lima que imprimió `make seed`)

| Comando | Qué hace |
|---|---|
| `make up` | Construye y levanta backend y frontend. |
| `make seed` | Crea los locales demo e imprime tokens nuevos. **Revoca los anteriores**, por eso no corre solo al arrancar. |
| `make logs` | Logs en vivo. |
| `make ps` | Estado de los contenedores. |
| `make test` | Tests del backend (pytest) y del frontend (Vitest), dentro de Docker. |
| `make down` | Detiene todo; la base se conserva. |
| `make clean` | Borra contenedores, imágenes **y la base de datos** (pide confirmación; `make clean CONFIRM=si` para no preguntar). |

Cómo queda armado:

- **frontend**: el build de producción servido por nginx en el puerto `8080`. nginx pasa `/api` al
  backend, así que todo está en el mismo origen y no hay CORS. No se usa el servidor de desarrollo de
  Vite: su proxy apunta a `localhost:8000`, que dentro del contenedor no es el backend.
- **backend**: uvicorn sin puerto publicado; solo se llega a través de nginx. Como nginx queda delante,
  `TRUSTED_PROXY_HOPS=1`: el rate limit toma la IP que nginx agrega al final de `X-Forwarded-For` y no
  la que pueda escribir el cliente.
- **Base de datos**: SQLite en el volumen `mesa247_db-data` (`/data/mesa.db`). Sobrevive a `make down`
  y a los reinicios; solo `make clean` la borra.
- **Otro puerto o acceso desde el celular**: `PUBLIC_BASE_URL` es la dirección que usa "Recuperar
  turno" para armar el enlace, y por defecto es `http://localhost:<WEB_PORT>`.
  ```bash
  make up WEB_PORT=9090
  make up PUBLIC_BASE_URL=http://192.168.1.20:8080   # IP de tu PC en la red local
  ```

## Levantarlo sin Docker

Cada carpeta tiene su README con los pasos. Backend primero, frontend después (en desarrollo, el
frontend consume la API a través del proxy de Vite):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.seed          # locales demo y tokens de tablet
uvicorn app.main:app --reload   # http://localhost:8000/docs
pytest
```

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
npm test
npm run build
```
