SHELL := /bin/bash

# Common knobs (override on the command line, e.g. make etl-local PROFILE=dev TRACK=tts-1)
INPUT   ?= inputs/rws-*.json
PROFILE ?=
TRACK   ?=
STACK   ?=

UV_PY  := uv run python
AWSOPT  = $(if $(PROFILE),--profile $(PROFILE)) $(if $(TRACK),--track $(TRACK))

.DEFAULT_GOAL := help
.PHONY: help install test test-etl test-lambda \
        etl-extract etl-local etl-aws \
        fe-install fe-dev fe-build fe-preview \
        cdk-install cdk-synth cdk-diff cdk-deploy cdk-destroy \
        clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: fe-install cdk-install ## Install Python (uv), frontend and CDK dependencies
	uv sync

# ---------- Tests (offline, no AWS calls) ----------

test: ## Run ETL + lambda tests
	uv run --with pytest --with openpyxl pytest etl/tests lambda/tests -q

test-etl: ## Run ETL tests only
	uv run --with pytest --with openpyxl pytest etl/tests -q

test-lambda: ## Run lambda tests only
	uv run --with pytest --with openpyxl pytest lambda/tests -q

# ---------- ETL ----------

etl-extract: ## Regenerate inputs/rws-*.json from docs/RW_Sentences.xlsx
	cd etl && uv run --with openpyxl python extract_sentences.py

etl-local: ## Polly -> frontend/public/sa/ [INPUT= PROFILE= TRACK=]
	cd etl && $(UV_PY) run_local.py $(INPUT) $(AWSOPT)

etl-aws: ## Polly -> deployed S3 + DynamoDB [INPUT= PROFILE= TRACK= STACK=]
	cd etl && $(UV_PY) run_aws.py $(INPUT) $(AWSOPT) $(if $(STACK),--stack $(STACK))

# ---------- Frontend (Vue + Vite) ----------

fe-install: ## Install frontend dependencies
	cd frontend && npm ci

fe-dev: ## Start the Vite dev server
	cd frontend && npm run dev

fe-build: ## Production build of the frontend
	cd frontend && npm run build

# ---------- Infra (CDK) ----------

cdk-install: ## Install CDK dependencies
	cd infra/cdk && npm ci

cdk-synth: ## cdk synth
	cd infra/cdk && npx cdk synth

cdk-diff: ## cdk diff
	cd infra/cdk && npx cdk diff

cdk-deploy: ## cdk deploy --all
	cd infra/cdk && npx cdk deploy --all

cdk-destroy: ## cdk destroy --all
	cd infra/cdk && npx cdk destroy --all

# ---------- Housekeeping ----------

clean: ## Remove build outputs and caches
	rm -rf frontend/dist infra/cdk/cdk.out
	find . -name __pycache__ -type d -prune -not -path './.venv/*' -exec rm -rf {} +
