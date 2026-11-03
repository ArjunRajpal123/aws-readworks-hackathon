SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
ENV_FILE := .env

.PHONY: venv install run-post run-get clean

venv:
	python3 -m venv $(VENV)

install: venv
	$(PIP) install --upgrade pip -q
	$(PIP) install -r requirements.txt -q

# Usage: make run-post TEXT="Hello world" [VOICE_ID=Joanna] [LANGUAGE_CODE=en-US] [ENGINE=neural]
run-post: install
	@test -n "$(TEXT)" || (echo "Usage: make run-post TEXT=\"some text\"" && exit 1)
	@set -a; [ -f $(ENV_FILE) ] && source $(ENV_FILE); set +a; \
	$(PYTHON) scripts/invoke_local.py post --text "$(TEXT)" \
		$(if $(VOICE_ID),--voice-id "$(VOICE_ID)") \
		$(if $(LANGUAGE_CODE),--language-code "$(LANGUAGE_CODE)") \
		$(if $(ENGINE),--engine "$(ENGINE)")

# Usage: make run-get ID=<record-id>
run-get: install
	@test -n "$(ID)" || (echo "Usage: make run-get ID=<record-id>" && exit 1)
	@set -a; [ -f $(ENV_FILE) ] && source $(ENV_FILE); set +a; \
	$(PYTHON) scripts/invoke_local.py get --id "$(ID)"

clean:
	rm -rf $(VENV)
