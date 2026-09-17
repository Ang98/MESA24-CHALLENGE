# Mesa247 — Lista de espera digital

Prueba técnica: el comensal escanea un QR y se une a la cola; el anfitrión ve la cola en una tablet y llama al siguiente.

| Carpeta | Qué hay |
|---|---|
| [`backend/`](backend/) | API en FastAPI + SQLAlchemy 2 + SQLite, con tests (pytest). |
| [`frontend/`](frontend/) | React 18 + TypeScript + Vite: pantallas del comensal (`/l/:slug`, `/t/:token`) y de la tablet (`/tablet`), con tests (Vitest). |

## Levantarlo

Cada carpeta tiene su README con los pasos. Backend primero, frontend después (el frontend lo
consume vía proxy en desarrollo):

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
