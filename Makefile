.PHONY: types web pi release run dev clean tidy

# Generate web/src/shared/types.ts from the Go config + msg structs.
types:
	go run github.com/gzuidhof/tygo@latest generate

# Build the web bundle (display + control) into web/dist.
web:
	cd web && npm install && npm run build

# Cross-compile the Pi binary with the web assets embedded.
# Target: Raspberry Pi 5 (Cortex-A76, ARMv8.2-A). GOARM64=v8.2 lets the compiler use
# the A76's instruction set; CGO off => one static binary; -s -w + -trimpath => small.
pi: web
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 GOARM64=v8.2 go build -trimpath -ldflags="-s -w" \
		-o bin/skyview ./cmd/skyview

# Build the release asset + checksum the self-updater fetches (upload both to a
# GitHub release; the Pi's skyview-updater pulls skyview-linux-arm64 + .sha256).
release: web
	mkdir -p dist
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 GOARM64=v8.2 go build -trimpath -ldflags="-s -w" \
		-o dist/skyview-linux-arm64 ./cmd/skyview
	cd dist && sha256sum skyview-linux-arm64 > skyview-linux-arm64.sha256

# Local dev: Go server + Vite dev server (run in two terminals).
run:
	go run ./cmd/skyview

dev:
	cd web && npm run dev

tidy:
	go mod tidy

clean:
	rm -rf bin web/dist
