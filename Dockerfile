FROM node:26-bookworm-slim AS web
WORKDIR /src
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages packages
COPY apps/web apps/web
COPY scripts scripts
COPY dist/avari-extension.zip dist/avari-extension.zip
ARG AVARI_VERSION=1.0.0
ARG CHROME_STORE_URL=
ARG GA_MEASUREMENT_ID=
ENV AVARI_VERSION=${AVARI_VERSION} VITE_CHROME_STORE_URL=${CHROME_STORE_URL} VITE_GA_MEASUREMENT_ID=${GA_MEASUREMENT_ID}
RUN npm run build:web

FROM golang:1.27-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/server apps/server
COPY --from=web /src/apps/server/assets/dist apps/server/assets/dist
RUN CGO_ENABLED=0 go build -trimpath -o /out/avari ./apps/server/cmd/api && CGO_ENABLED=0 go build -trimpath -o /out/avari-admin ./apps/server/cmd/admin

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/OstKost/avari-job-applications" io.avari.app="jobs"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata curl && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --no-create-home avari && mkdir -p /data/backups && chown -R avari:avari /data
COPY --from=backend /out/ /app/
USER 10001:10001
WORKDIR /app
ENV AVARI_DB=/data/avari.db AVARI_BACKUPS=/data/backups AVARI_ADDR=0.0.0.0:8080
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s CMD curl -fsS http://127.0.0.1:8080/readyz || exit 1
ENTRYPOINT ["/app/avari"]
