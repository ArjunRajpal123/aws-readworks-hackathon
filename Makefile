.PHONY: web web-install web-build

# Run the Sound Along web app (frontend/) dev server.
web: web-install
	cd frontend && npm run dev

web-install:
	cd frontend && npm install

web-build: web-install
	cd frontend && npm run build
