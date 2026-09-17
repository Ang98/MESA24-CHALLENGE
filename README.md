# Mesa247 — Lista de espera digital

Prueba técnica: el comensal escanea un QR y se une a la cola; el anfitrión ve la cola en una tablet y llama al siguiente.

| Carpeta | Qué hay |
|---|---|
| [`backend/`](backend/) | API en FastAPI + SQLAlchemy 2 + SQLite, con tests (pytest). |

## Levantarlo

Cada carpeta tiene su README con los pasos. Para el backend:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.seed          # locales demo y tokens de tablet
uvicorn app.main:app --reload   # http://localhost:8000/docs
pytest
```
