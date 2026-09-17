FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Incluye tests/ para que `make test` corra pytest dentro de la imagen.
COPY . .

# Usuario sin privilegios. /data es el volumen de la base: se crea con este
# dueño para que el volumen nuevo herede los permisos.
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /data \
    && chown app:app /data
USER app

ENV DATABASE_URL=sqlite:////data/mesa.db

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/openapi.json', timeout=2)"

# --no-proxy-headers: la IP del cliente la resuelve la app con
# TRUSTED_PROXY_HOPS (app/ratelimit.py), no uvicorn.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
