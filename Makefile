# Mesa247 con Docker. `make help` lista los comandos.

WEB_PORT ?= 8080
PUBLIC_BASE_URL ?= http://localhost:$(WEB_PORT)
export WEB_PORT PUBLIC_BASE_URL

COMPOSE := docker compose
FRONTEND_BUILD_IMAGE := mesa247-frontend-build

.DEFAULT_GOAL := help
.PHONY: help up down seed logs ps test clean

help: ## Lista los comandos
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'
	@echo ""
	@echo "  Puerto: WEB_PORT=$(WEB_PORT) (p. ej. make up WEB_PORT=9090)"

up: ## Construye y levanta todo, y espera a que esté sano
	$(COMPOSE) up -d --build --wait
	@echo ""
	@echo "Listo:"
	@echo "  Comensal: $(PUBLIC_BASE_URL)/l/demo-lima"
	@echo "  Tablet:   $(PUBLIC_BASE_URL)/tablet"
	@echo "La primera vez, corre 'make seed' para crear los locales demo y los tokens."

down: ## Detiene los contenedores (la base se conserva)
	$(COMPOSE) down

seed: ## Crea los locales demo e imprime tokens nuevos (revoca los anteriores)
	@$(COMPOSE) exec backend true 2>/dev/null || { echo "El backend no está corriendo: primero 'make up'."; exit 1; }
	$(COMPOSE) exec backend python -m scripts.seed

logs: ## Muestra los logs en vivo
	$(COMPOSE) logs -f

ps: ## Estado de los contenedores
	$(COMPOSE) ps

test: ## Corre los tests del backend y del frontend dentro de Docker
	$(COMPOSE) build backend
	$(COMPOSE) run --rm --no-deps backend python -m pytest -q -p no:cacheprovider
	docker build --target build -t $(FRONTEND_BUILD_IMAGE) ./frontend
	docker run --rm $(FRONTEND_BUILD_IMAGE) npm test

clean: ## Borra contenedores, imágenes y la BASE DE DATOS (pide confirmación)
	@echo "ATENCIÓN: esto borra la base de datos (turnos, eventos y tokens de tablet),"
	@echo "además de los contenedores y las imágenes del proyecto."
	@if [ "$(CONFIRM)" != "si" ]; then \
		printf "Escribe 'si' para continuar: "; read ans; \
		[ "$$ans" = "si" ] || { echo "Cancelado."; exit 1; }; \
	fi
	$(COMPOSE) down -v --rmi local --remove-orphans
	@docker image rm $(FRONTEND_BUILD_IMAGE) >/dev/null 2>&1 || true
