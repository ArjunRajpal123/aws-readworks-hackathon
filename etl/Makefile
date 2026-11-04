.PHONY: run-local run-aws run-api

PYTHON ?= uv run --project .. python
INPUT ?= inputs/e1-p1.json

# Usage: make run-local [INPUT=inputs/e1-p1.json] [SA_DIR=...]
# Direct Amazon Polly calls; writes frontend/public/sa/ for the local Vite dev server.
run-local:
	$(PYTHON) run_local.py $(INPUT) $(if $(SA_DIR),--sa-dir $(SA_DIR),)

# Usage: make run-aws [INPUT=inputs/e1-p1.json] [STACK=rg-readworks-bb-storage]
# Direct Amazon Polly calls; writes to the deployed S3 media bucket + DynamoDB
# reference table (resolved from the storage stack's CloudFormation outputs).
run-aws:
	$(PYTHON) run_aws.py $(INPUT) $(if $(STACK),--stack $(STACK),)

# Usage: make run-api [INPUT=inputs/e1-p1.json] [API_URL=https://...]
# Gets audio + word timing from the deployed /api/v1/text-to-speech API (the
# two Lambda functions) instead of calling Polly directly; writes
# frontend/public/sa/ for the local Vite dev server. API_URL is resolved
# from the rg-readworks-bb-api stack's CloudFormation output if omitted.
run-api:
	$(PYTHON) run_api.py $(INPUT) $(if $(API_URL),--api-url $(API_URL),)
