.PHONY: web web-install web-build web-data

SAMPLE_PASSAGE ?= inputs/e1-p1.json

# Run the Sound Along web app (frontend/) dev server, backed by real Polly
# audio generated through the two deployed Lambda endpoints (etl/Makefile's
# run-api, via etl/run_api.py).
web: web-install web-data
	cd frontend && npm run dev

web-install:
	cd frontend && npm install

web-build: web-install
	cd frontend && npm run build

# Synthesizes the sample passage via the deployed /api/v1/text-to-speech API
# (the two Lambda functions) into frontend/public/sa/, so the player has
# real audio instead of falling back to the browser's built-in voice.
# Requires AWS credentials and rg-readworks-bb-api to be deployed; the API
# URL is resolved from that stack's CloudFormation output unless you pass
# API_URL=https://... yourself.
web-data:
	$(MAKE) -C etl run-api INPUT=$(SAMPLE_PASSAGE) API_URL=$(API_URL)
