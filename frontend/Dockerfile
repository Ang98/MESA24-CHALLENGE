# 1) Build de producción con Node. `make test` también usa esta etapa.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Sin VITE_API_BASE_URL: la app llama a /api en el mismo origen y nginx lo
# pasa al backend (nginx.conf).
RUN npm run build

# 2) Solo los archivos estáticos, servidos por nginx.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
