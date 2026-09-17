# Mesa247 — frontend (lista de espera digital)

Prueba técnica: React 18 + TypeScript + Vite. Consume la API en `backend/` (FastAPI).

**Requisitos:** Node 20+. Para levantar todo con Docker, ver el README de la raíz (`make up`): ahí el
build se sirve con nginx (`nginx.conf`), que pasa `/api` al backend en el mismo origen.

## Levantar en 5 minutos

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

El backend debe estar levantado en `http://localhost:8000` (ver `backend/README.md`). El
`vite.config.ts` trae un proxy de `/api` hacia `http://localhost:8000`, así que en desarrollo
no hace falta configurar CORS ni una URL absoluta.

Otros comandos:

```bash
npm test         # Vitest (jsdom)
npm run build    # tsc -b && vite build
npm run lint     # eslint
```

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `VITE_API_BASE_URL` | `''` (vacío) | Base de la API. Vacío = usa el proxy `/api` de Vite. Se necesita un valor absoluto (p. ej. `http://localhost:8000`) solo si el frontend se sirve desde otro origen que no pasa por el proxy de Vite (por ejemplo, `npm run build` + `npm run preview`, o producción). |

Copiar `.env.example` a `.env` para personalizarla.

## Probar de punta a punta

1. Backend levantado y con datos demo:
   ```bash
   cd backend
   source .venv/bin/activate
   python -m scripts.seed   # crea demo-lima, demo-santiago y sus tokens de tablet
   uvicorn app.main:app --reload
   ```
2. Frontend:
   ```bash
   cd frontend
   npm run dev
   ```
3. **Comensal**: abrir `http://localhost:5173/l/demo-lima`, llenar el formulario (nombre,
   teléfono, cuántos son, aceptar el consentimiento) y unirse. Queda en `/t/{token}`, viendo su
   tiempo de espera y su puesto en la cola.
4. **Tablet**: abrir `http://localhost:5173/tablet` y pegar uno de los tokens que imprime
   `python -m scripts.seed` para "Demo Lima" (cada puerta tiene el suyo). Desde ahí se puede
   Llamar / Sentar / No vino / Quitar / Recuperar turno.
5. **Desde el celular en la misma red (LAN)**: `npm run dev` ya expone `server.host: true`, así
   que Vite imprime una URL `http://<IP-de-tu-LAN>:5173`; abrirla desde el celular. Con el proxy
   de Vite (el default, `VITE_API_BASE_URL` vacío) el navegador del celular solo habla con ese
   mismo Vite dev server — el reenvío a `http://localhost:8000` lo hace Vite del lado del
   servidor, así que **no hace falta tocar `CORS_ORIGINS`**. Sí conviene definir
   `PUBLIC_BASE_URL=http://<IP-de-tu-LAN>:5173` en el backend antes de levantar `uvicorn`, porque
   ese valor arma la URL que devuelve "Recuperar turno" en la tablet (`{PUBLIC_BASE_URL}/t/{token}`)
   y sin la IP correcta esa URL no abriría en el celular.

   Si en cambio se configura `VITE_API_BASE_URL` apuntando directo a otro origen (por ejemplo,
   sirviendo el frontend con `npm run build` + `npm run preview` sin pasar por el proxy), ahí sí
   hace falta `CORS_ORIGINS=http://<IP-de-tu-LAN>:5173` (o el origen que corresponda) en el
   backend. En ese caso, para que el aviso de "Demasiados intentos" muestre los minutos exactos
   de espera, el backend también debe exponer el header `Retry-After` en CORS
   (`expose_headers`); si no lo expone, el frontend no puede leerlo desde JavaScript y usa 60
   segundos por defecto.

## Reporte diario

El reporte no tiene pantalla en este frontend (no es para el anfitrión de la tablet, sino para
quien opera el piloto). Se consulta directo contra la API con el token de una tablet del local:

```bash
curl 'http://localhost:8000/api/tablet/report?date=YYYY-MM-DD' \
  -H 'Authorization: Bearer <TOKEN>'
```

Sin el parámetro `date`, devuelve el reporte del día de hoy del local (según su `timezone` y el
corte de servicio). Campos de la respuesta (`ReportResponse`, ver nota técnica sección 4):

| Campo | Significado |
|---|---|
| `date` | Día de servicio consultado (`YYYY-MM-DD`). |
| `is_today` | Si ese día sigue en curso (todavía puede cambiar) o ya cerró. |
| `joined` | Total de grupos (entradas a la cola) ese día, no de personas — cada `party_size` cuenta como 1. |
| `seated` | Se sentaron (`status = seated`). |
| `left` | Se fueron sin sentarse: canceladas (`cancelled`) más, si el día ya cerró, las que seguían en `waiting`. |
| `no_show` | El anfitrión las marcó "No vino" (`status = no_show`). |
| `in_progress` | Solo si `is_today`: siguen en `waiting` o `called` en este momento. Si el día ya cerró, es 0. |
| `unclosed` | Solo si el día ya cerró: seguían en `called` — probablemente se sentaron y nadie tocó "Sentar"; también sirve para ver si los anfitriones usan bien la app. Si `is_today`, es 0 (esos casos todavía cuentan como `in_progress`). |
| `removed` | El anfitrión las quitó de la cola (`status = removed`), fuera de todas las categorías anteriores. |
| `avg_wait_min` | Espera media en minutos, de `joined_at` a la sentada, solo con las que se sentaron (`null` si nadie se sentó ese día). |

## Estructura

```
src/
  main.tsx  App.tsx  styles.css
  api/client.ts      fetch + ApiError {status, code, currentStatus, retryAfter}
  api/types.ts       espejo de backend/app/schemas.py
  api/public.ts      getLocation, joinQueue, getEntry, onMyWay, cancelEntry
  api/tablet.ts      getQueue, callEntry, seatEntry, noShowEntry, removeEntry, recoverLink
  lib/phone.ts       países, armar E.164, validar
  lib/idempotency.ts generar clave de Idempotency-Key
  lib/storage.ts     localStorage con try/catch (si falla, la app funciona igual)
  lib/waitText.ts    texto del tiempo de espera
  lib/usePolling.ts  intervalo de refresco + refresco inmediato en visibilitychange
  components/PhoneInput.tsx
  pages/JoinPage.tsx    /l/:slug   — el comensal se une a la cola
  pages/TurnPage.tsx    /t/:token  — el comensal ve su turno (waiting / called / final)
  pages/TabletPage.tsx  /tablet    — el anfitrión ve y opera la cola
```

Cualquier ruta que no sea `/l/:slug`, `/t/:token` o `/tablet` muestra "Página no encontrada".

## Tests

Vitest + Testing Library + jest-dom, en jsdom. `fetch` se mockea con `src/testSupport/mockFetch.ts`
porque todo pasa por `api/client.ts`; la lógica de negocio sin efectos vive en `lib/` (funciones
puras); los intervalos de polling son constantes exportadas (`TURN_POLL_INTERVAL_MS`,
`TABLET_POLL_INTERVAL_MS` en `lib/usePolling.ts`).

| Archivo | Qué cubre |
|---|---|
| `src/App.test.tsx` | Test de humo: jsdom + React Router + Testing Library + jest-dom quedan bien configurados. |
| `src/api/client.test.ts` | El timeout de `apiFetch`: si el backend no responde, aborta y lo trata como error de red. |
| `src/lib/phone.test.ts` | Validación de teléfono de Perú/Chile y de otro país, y el armado del E.164. |
| `src/lib/idempotency.test.ts` | Formato y largo de la Idempotency-Key generada, y que cada llamada da una distinta. |
| `src/lib/waitText.test.ts` | El texto del rango de espera (`groups_ahead` = 0 vs. mayor a 0). |
| `src/lib/usePolling.test.ts` | El intervalo llama al callback de inmediato y en cada tick, y salta un tick si el anterior sigue en curso. |
| `src/pages/JoinPage.test.tsx` | El formulario para unirse: Idempotency-Key, reintento tras error de red, consentimiento obligatorio, avisos de error (409, 429), y la redirección/limpieza de storage según el turno guardado. |
| `src/pages/TurnPage.test.tsx` | La pantalla de turno: puesto, texto de tiempo de espera, `on_my_way`, cada estado final, 404, el aviso de SMS no soportado, y las carreras entre el sondeo y las acciones ("Ya no voy"/"Voy en camino" siempre ganan sobre un GET atrasado, y no se lanza un GET mientras una acción sigue en curso). |
| `src/pages/TabletPage.test.tsx` | La pantalla de la tablet: formulario de token, 401, botones por estado, minutos de espera, "En camino", teléfono parcial, banner sin conexión y recuperar turno. |
