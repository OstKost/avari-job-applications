package main

import (
	"bufio"
	"context"
	"flag"
	"github.com/OstKost/avari-job-applications/apps/server/assets"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/httpapi"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
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
	personal := flag.Bool("personal", false, "Run a single-owner local instance")
	launcher := flag.Bool("launcher", false, "Accept shutdown through the native launcher's stdin")
	flag.Parse()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	addr := env("AVARI_ADDR", "127.0.0.1:8080")
	origin := env("AVARI_ORIGIN", "http://localhost:8080")
	if *personal {
		host, port, err := net.SplitHostPort(addr)
		parsed, originErr := url.Parse(origin)
		if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() || originErr != nil || parsed.Scheme != "http" || parsed.Port() == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil || (parsed.Hostname() != host && parsed.Hostname() != "localhost") || parsed.Port() != port {
			slog.Error("personal mode requires a matching loopback HTTP origin")
			os.Exit(1)
		}
		if os.Getenv("AVARI_SETUP_TOKEN") == "" {
			slog.Error("personal mode requires a setup secret from the launcher")
			os.Exit(1)
		}
	}
	listener, e := net.Listen("tcp", addr)
	if e != nil {
		slog.Error("listen", "error", e)
		os.Exit(1)
	}
	defer listener.Close()
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
	if *personal {
		users, err := store.Users()
		if err != nil || len(users) > 1 {
			slog.Error("personal mode requires a separate single-owner database")
			os.Exit(1)
		}
	}
	api := &httpapi.Server{Store: store, Origin: origin, Secure: len(origin) >= 8 && origin[:8] == "https://", Assets: web, TrustedProxy: !*personal && os.Getenv("AVARI_TRUST_PROXY") == "true", Personal: *personal}
	if *personal {
		api.SetupToken = os.Getenv("AVARI_SETUP_TOKEN")
		if *launcher {
			api.LauncherURL = os.Getenv("AVARI_LAUNCHER_URL")
			api.LauncherToken = os.Getenv("AVARI_LAUNCHER_TOKEN")
		}
	}
	server := &http.Server{Addr: addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if *personal && *launcher {
		go func() {
			reader := bufio.NewReader(os.Stdin)
			for {
				line, err := reader.ReadString('\n')
				if line == "shutdown\n" || err == io.EOF {
					stop()
					return
				}
				if err != nil {
					stop()
					return
				}
			}
		}()
	}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("listening", "address", server.Addr)
	if e = server.Serve(listener); e != nil && e != http.ErrServerClosed {
		slog.Error("server", "error", e)
		os.Exit(1)
	}
	<-shutdownDone
}
