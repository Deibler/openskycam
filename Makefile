.PHONY: check lint test deploy worker-check dashboard-check docs-check processor-check store-check setup-check status
# The relay host for status, test and deploy: make status HOST=<ssh-host>
need-host = $(if $(HOST),,$(error Set HOST to the relay ssh host, for example: make $@ HOST=pi@relay))

# Is video arriving? Worker health (newest segment's age) plus the relay's last uploads.
status:
	$(need-host)
	@set -e; . ./.env; printf 'header = "Authorization: Bearer %s"\n' "$$INGEST_TOKEN" | curl --silent --show-error --config - "$$INGEST_URL/v1/status"; echo
	@ssh $(HOST) 'journalctl -t upload.sh -n 5 -o cat --no-pager; \
	  echo "waiting to upload: $$(ls ~/skyvision/spool/pending | wc -l)  set aside: $$(ls ~/skyvision/spool/quarantine | wc -l)"'

# All application checks, relay and store lint, and the camera MCP self-test.
check: worker-check dashboard-check docs-check processor-check store-check setup-check lint
	python3 camera_mcp.py --check

# Shell scripts that run on the relay, store, and processor hosts, and the installer.
lint:
	shellcheck -x external/relay/*.sh external/store/deploy.sh processor/install-model-sync.sh processor/install-workshop.sh setup/install.sh

worker-check:
	cd package/worker && npm run --silent check

dashboard-check:
	cd package/dashboard && npm run --silent check

# Builds the documentation site and checks every internal link.
docs-check:
	cd package/docs && npm run --silent check

processor-check:
	cd processor && python3 -m unittest discover -s tests -v

store-check:
	cd external/store && python3 -m unittest discover -s tests -v

# The guided setup's parsing and validation (npm run setup).
setup-check:
	node --test setup/lib.check.mjs

# Run the uploader self-test on the relay host (needs bash 5 + ffmpeg there).
test:
	$(need-host)
	ssh $(HOST) 'mkdir -p /tmp/skyvision-test'
	scp -q external/relay/upload.sh external/relay/test_upload.sh $(HOST):/tmp/skyvision-test/
	ssh $(HOST) 'bash /tmp/skyvision-test/test_upload.sh; s=$$?; rm -rf /tmp/skyvision-test; exit $$s'

# Install or update the relay: make deploy HOST=<ssh-host>
deploy:
	$(need-host)
	external/relay/deploy.sh $(HOST)
