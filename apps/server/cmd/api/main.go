package main

import (
	"bufio"
	"context"
	"flag"
	"github.com/OstKost/avari-job-applications/apps/server/assets"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/httpapi"
	"github.com/OstKost/avari-job-applications/apps/server/internal/telegram"
	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
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
	telegramSetup := flag.Bool("telegram-setup", false, "Register Telegram webhook and private-chat commands, then exit")
	flag.Parse()
	var logLevel slog.Level
	if levelStr := os.Getenv("AVARI_LOG_LEVEL"); levelStr != "" {
		if err := logLevel.UnmarshalText([]byte(levelStr)); err != nil {
			logLevel = slog.LevelInfo
		}
	} else {
		logLevel = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	})))
	addr := env("AVARI_ADDR", "127.0.0.1:47831")
	origin := env("AVARI_ORIGIN", "http://localhost:47831")
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
	telegramEnabled := os.Getenv("AVARI_TELEGRAM_ENABLED") == "true"
	telegramMode := env("AVARI_TELEGRAM_DELIVERY_MODE", "webhook")
	if telegramEnabled && telegramMode != "webhook" && telegramMode != "polling" {
		slog.Error("invalid Telegram delivery mode")
		os.Exit(1)
	}
	telegramToken, telegramUsername, telegramSecret := os.Getenv("AVARI_TELEGRAM_BOT_TOKEN"), os.Getenv("AVARI_TELEGRAM_BOT_USERNAME"), os.Getenv("AVARI_TELEGRAM_WEBHOOK_SECRET")
	if err := telegram.Validate(telegramEnabled, *personal, origin, telegramToken, telegramUsername, telegramSecret); err != nil {
		slog.Error("invalid Telegram configuration", "error", err)
		os.Exit(1)
	}
	telegramClient := &telegram.Client{Token: telegramToken}
	if *telegramSetup {
		if !telegramEnabled {
			slog.Error("Telegram is disabled")
			os.Exit(1)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := telegramClient.Configure(ctx, origin, telegramSecret, telegramMode); err != nil {
			slog.Error("Telegram setup failed", "error", err)
			os.Exit(1)
		}
		return
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
	vapidCfg := webpush.VAPIDConfig{
		PublicKey:  os.Getenv("AVARI_VAPID_PUBLIC_KEY"),
		PrivateKey: os.Getenv("AVARI_VAPID_PRIVATE_KEY"),
		Contact:    os.Getenv("AVARI_VAPID_CONTACT"),
	}
	cfg, err := webpush.NewConfig(vapidCfg)
	if err != nil {
		slog.Error("invalid VAPID configuration", "error", err)
		os.Exit(1)
	}

	pushTransport, err := webpush.NewTransport(cfg)
	if err != nil {
		slog.Error("failed to create webpush transport", "error", err)
		os.Exit(1)
	}

	pushService := core.NewPushNotificationService(store, pushTransport)
	if cfg.Enabled() {
		slog.Info("web push notifications enabled", "contact", os.Getenv("AVARI_VAPID_CONTACT"))
	} else {
		slog.Info("web push notifications disabled (no VAPID keys configured)")
	}

	api := &httpapi.Server{
		Store:            store,
		TelegramEnabled:  telegramEnabled,
		TelegramUsername: telegramUsername,
		TelegramSecret:   telegramSecret,
		Origin:           origin,
		Secure:           len(origin) >= 8 && origin[:8] == "https://",
		Assets:           web,
		TrustedProxy:     !*personal && os.Getenv("AVARI_TRUST_PROXY") == "true",
		Personal:         *personal,
		PushTransport:    pushTransport,
		PushService:      pushService,
	}
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
	if telegramEnabled {
		worker := &telegram.Service{Store: store, Client: telegramClient, Origin: origin, Polling: telegramMode == "polling"}
		done := make(chan struct{})
		go func() { defer close(done); worker.Run(ctx) }()
		defer func() { stop(); <-done }()
	}
	go func() {
		// Startup reconciliation
		nowUTC := time.Now().UTC()
		if err := store.ReconcileReminders(ctx, nowUTC); err != nil && ctx.Err() == nil {
			slog.Error("failed startup reminder reconciliation", "error", err)
		}
		if err := pushService.ReconcileDigests(ctx, nowUTC); err != nil && ctx.Err() == nil {
			slog.Error("failed startup push digest reconciliation", "error", err)
		}
		if err := pushService.ProcessOutbox(ctx, nowUTC); err != nil && ctx.Err() == nil {
			slog.Error("failed startup push outbox processing", "error", err)
		}

		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case t := <-ticker.C:
				current := t.UTC()
				if err := store.ReconcileReminders(ctx, current); err != nil && ctx.Err() == nil {
					slog.Error("failed scheduled reminder reconciliation", "error", err)
				}
				if err := pushService.ReconcileDigests(ctx, current); err != nil && ctx.Err() == nil {
					slog.Error("failed scheduled push digest reconciliation", "error", err)
				}
				if err := pushService.ProcessOutbox(ctx, current); err != nil && ctx.Err() == nil {
					slog.Error("failed scheduled push outbox processing", "error", err)
				}
			}
		}
	}()
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
