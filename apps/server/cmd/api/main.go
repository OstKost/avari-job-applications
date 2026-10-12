package main

import (
	"context"
	"github.com/OstKost/avari-job-applications/apps/server/assets"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/httpapi"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func env(name, defaultValue string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return defaultValue
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	store, e := core.Open(env("AVARI_DB", "data/avari.db"))
	if e != nil {
		slog.Error("database", "error", e)
		os.Exit(1)
	}
	defer store.Close()
	web, e := fs.Sub(assets.Files, "dist")
	if e != nil {
		panic(e)
	}
	origin := env("AVARI_ORIGIN", "http://localhost:8080")
	api := &httpapi.Server{Store: store, Origin: origin, Secure: len(origin) >= 8 && origin[:8] == "https://", Assets: web, TrustedProxy: os.Getenv("AVARI_TRUST_PROXY") == "true"}
	server := &http.Server{Addr: env("AVARI_ADDR", "127.0.0.1:8080"), Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("listening", "address", server.Addr)
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		slog.Error("server", "error", e)
		os.Exit(1)
	}
}
