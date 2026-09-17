# Mesa247 — backend (lista de espera digital)

Prueba tecnica: FastAPI + SQLAlchemy 2.x + SQLite. El diseno de dominio esta en la nota tecnica (enviada aparte).

**Requisitos:** Python 3.10+. Para levantar todo con Docker, ver el README de la raiz (`make up`).

## Levantar en 5 minutos

```bash
cd backend
python3 -m venv .venv          # o: uv venv --python 3.10 .venv
source .venv/bin/activate
pip install -r requirements.txt

python -m scripts.seed         # crea las tablas, los 2 locales demo y las tablets (imprime los tokens)
                               # volver a correrlo revoca los tokens anteriores y crea nuevos

uvicorn app.main:app --reload  # http://localhost:8000  (docs en /docs)
```

Prueba rapida (reemplazar `<TOKEN>` por un token de Demo Lima impreso por el seed):

```bash
curl -X POST http://localhost:8000/api/locations/demo-lima/entries \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: prueba-0001' \
  -d '{"name": "Ana", "phone": "+51987654321", "party_size": 2, "consent": true}'

curl http://localhost:8000/api/tablet/queue -H 'Authorization: Bearer <TOKEN>'
```

Tests:

```bash
pytest
```

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./mesa.db` | cadena de conexion del engine |
| `SERVICE_DAY_CUTOFF_HOUR` | `5` | corte del dia de servicio, hora local del local |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | base para `{PUBLIC_BASE_URL}/t/{public_token}` |
| `CORS_ORIGINS` | `http://localhost:5173` | origenes permitidos, separados por coma |
| `TRUSTED_PROXY_HOPS` | `0` | ver "IP del cliente" abajo |
| `RATE_IP_MAX` / `RATE_IP_WINDOW_S` | `20` / `600` | limite por IP + local |
| `RATE_PHONE_MAX` / `RATE_PHONE_WINDOW_S` | `3` / `3600` | limite por telefono + local |

### IP del cliente y `TRUSTED_PROXY_HOPS`

La IP real nunca se toma del primer valor de `X-Forwarded-For` (lo puede poner el cliente). Con
`TRUSTED_PROXY_HOPS = N > 0` se toma el elemento N-esimo **desde la derecha** de esa cabecera
(`parts[-N]`); si hay menos de N elementos o no hay cabecera, se usa `request.client.host`.
Con `N = 0` (default) se usa directamente `request.client.host`.

Con Docker (`docker-compose.yml` en la raiz) el valor es `1`: nginx queda delante y agrega la IP que
ve al final de la cabecera; el backend no publica su puerto, asi que nadie puede saltarse nginx.

En despliegue (Cloud Run, nota tecnica seccion 7): detras de Cloud Run directo, `1`; detras de un
balanceador externo de Google delante de Cloud Run, `2`. Verificarlo en el entorno real antes de confiar
en el rate limit por IP.

## Endpoints

Comensal (sin autenticacion):

- `GET  /api/locations/{slug}`
- `POST /api/locations/{slug}/entries` (requiere header `Idempotency-Key`, 8–100 caracteres)
- `GET  /api/entries/{public_token}`
- `POST /api/entries/{public_token}/on-my-way` (idempotente: un segundo toque
  sobre una entrada `called` que ya tiene el evento no crea otro, responde 200)
- `POST /api/entries/{public_token}/cancel`

Tablet (`Authorization: Bearer <token>`, token entregado por `scripts/seed.py`):

- `GET  /api/tablet/queue`
- `POST /api/tablet/entries/{id}/call`
- `POST /api/tablet/entries/{id}/seat`
- `POST /api/tablet/entries/{id}/no-show`
- `POST /api/tablet/entries/{id}/remove`
- `POST /api/tablet/entries/{id}/recover-link`
- `GET  /api/tablet/report?date=YYYY-MM-DD` (sin `date`, es el dia de hoy del local)

## Notas de diseno

- Todas las horas se guardan y devuelven en UTC (`...Z` en JSON). El `service_date` de cada local se
  calcula con su `timezone` y el corte `SERVICE_DAY_CUTOFF_HOUR`.
- Los duplicados (mismo local + dia + telefono, con estado `waiting`/`called`) los controla un indice
  unico parcial en SQLite, no la aplicacion. Lo mismo para "Voy en camino" (`on_my_way` en el payload
  publico): un indice unico parcial en `entry_events(entry_id) WHERE type = 'on_my_way'` garantiza un
  solo evento por entrada aunque lleguen dos toques simultaneos; si choca, se hace rollback del insert
  y se responde 200 con el estado actual (nunca 500).
- **`create_all()` no agrega indices nuevos a una `mesa.db` existente** (SQLAlchemy solo crea tablas que
  faltan). Si tu base es de antes de este cambio, borra `mesa.db` y vuelve a correr `python -m
  scripts.seed` para que el indice de `on_my_way` quede creado.
- **Pendiente para MySQL (Cloud SQL, piloto)**: los dos indices parciales usan `sqlite_where`, que
  SQLAlchemy ignora en otros dialectos. En MySQL quedarian como indices unicos completos: el de
  duplicados bloquearia volver a la cola el mismo dia aunque el turno anterior ya este cerrado, y el de
  `on_my_way` (unico sobre `entry_id`) haria fallar el segundo evento de cualquier entrada (`joined`
  y luego `called`). En la migracion se reemplazan por columnas calculadas con indice unico, p. ej.
  `IF(type = 'on_my_way', entry_id, NULL)` y `IF(status IN ('waiting','called'), phone_e164, NULL)`.
- En este corte el rate limit es en memoria y la notificacion es falsa (solo se invoca al llamar y
  solo para telefonos de Peru y Chile). El piloto trae el rate limit compartido entre instancias,
  el outbox con su worker y el SMS real (nota tecnica, secciones 2 y 7).
