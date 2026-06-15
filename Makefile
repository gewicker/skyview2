.PHONY: types web pi run dev clean tidy

# Generate web/src/shared/types.ts from the Go config + msg structs.
types:
	go run github.com/gzuidhof/tygo@latest generate

# Build the web bundle (display + control) into web/dist.
web:
	cd web && npm install && npm run build

# Cross-compile the Pi binary with the web assets embedded.
pi: web
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" \
		-o bin/skyview ./cmd/skyview

# Local dev: Go server + Vite dev server (run in two terminals).
run:
	go run ./cmd/skyview

dev:
	cd web && npm run dev

tidy:
	go mod tidy

clean:
	rm -rf bin web/dist
