PYTHON := .venv/bin/python
DEPLOY_DIR := dist/deploy/stanford-lambdas-lineage

.PHONY: help setup prepare serve test lint build preview deploy

help:
	@printf '%s\n' \
	  'setup    Create the local Python virtual environment (uv preferred, python fallback)' \
	  'prepare  Validate source/lineage.json and generate ignored preloaded graph assets' \
	  'serve    Prepare and serve the static viewer at http://127.0.0.1:8000' \
	  'test     Run JavaScript and Python tests' \
	  'lint     Check Python/JavaScript syntax and whitespace' \
	  'build    Prepare and build the Cloudflare Worker package' \
	  'preview  Build and start the local Cloudflare Worker preview' \
	  'deploy   Build and deploy the Worker (requires cf auth login)'

setup:
	@if [ -x .venv/bin/python ]; then echo 'Using existing .venv'; \
	elif command -v uv >/dev/null 2>&1; then uv venv .venv; \
	else python3 -m venv .venv; fi

prepare:
	$(PYTHON) scripts/prepare_viewer.py

serve: prepare
	$(PYTHON) -m http.server 8000 --bind 127.0.0.1 --directory public

test:
	node --test tests/*.test.cjs
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py'

lint:
	$(PYTHON) -m compileall -q scripts tests
	node --check public/app.js
	node --check public/lineage.js
	node --check public/editor.js
	git diff --check

build: prepare
	$(PYTHON) scripts/package_site.py
	cd $(DEPLOY_DIR) && npm ci && npm run build

preview: build
	cd $(DEPLOY_DIR) && npm run dev

deploy: build
	cd $(DEPLOY_DIR) && npm run deploy
