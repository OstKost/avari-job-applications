.PHONY: install build build-ext test e2e dev dev-ext dev-all api admin release
install:
	npm ci
build:
	npm run build
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -o bin/avari ./apps/server/cmd/api
	CGO_ENABLED=0 go build -trimpath -o bin/avari-admin ./apps/server/cmd/admin
build-ext:
	npm run build:extension
	node scripts/package-extension.mjs
test:
	npm run typecheck
	npm test
	go test -race ./apps/server/...
	go vet ./apps/server/...
e2e: build
	AVARI_E2E=1 go test ./apps/server/internal/httpapi -run '^TestBrowser$$' -count=1 -timeout 10m
dev:
	npm run dev
dev-ext:
	npm run dev:extension
dev-all:
	npm run dev:all
api:
	go run ./apps/server/cmd/api
admin:
	go run ./apps/server/cmd/admin
release: build
	node scripts/release.mjs
