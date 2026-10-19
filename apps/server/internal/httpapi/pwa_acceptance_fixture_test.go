package httpapi

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/OstKost/avari-job-applications/apps/server/assets"
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/webpush"
	sherwebpush "github.com/SherClockHolmes/webpush-go"
)

// dynamicFS wraps an atomic pointer to fs.FS so the test-only endpoint can toggle build A and B.
type dynamicFS struct {
	current *atomic.Pointer[fs.FS]
}

func (d *dynamicFS) Open(name string) (fs.File, error) {
	target := *d.current.Load()
	return target.Open(name)
}

// buildAssetVariants reads the embedded assets and creates build A and build B memory filesystems.
func buildAssetVariants(embedded fs.FS) (fs.FS, fs.FS, error) {
	filesA := make(map[string][]byte)
	filesB := make(map[string][]byte)

	err := fs.WalkDir(embedded, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(embedded, path)
		if err != nil {
			return err
		}
		filesA[path] = data
		filesB[path] = bytes.Clone(data)
		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	// 1. Mark index.html with data-pwa-build="A" for build A
	idxA, ok := filesA["index.html"]
	if !ok {
		return nil, nil, fmt.Errorf("index.html missing from assets")
	}
	idxAStr := string(idxA)
	if strings.Count(idxAStr, "<html") != 1 || strings.Contains(idxAStr, "data-pwa-build") {
		return nil, nil, fmt.Errorf("index.html must contain exactly one unmarked <html> tag")
	}
	idxAStr = strings.Replace(idxAStr, "<html", `<html data-pwa-build="A"`, 1)
	filesA["index.html"] = []byte(idxAStr)

	// 2. Mark index.html with data-pwa-build="B" for build B
	idxBStr := string(filesB["index.html"])
	idxBStr = strings.Replace(idxBStr, "<html", `<html data-pwa-build="B"`, 1)
	filesB["index.html"] = []byte(idxBStr)

	// Keep both precache revisions consistent with their HTML bytes. A change to
	// the generated Workbox manifest must fail this fixture instead of simulating
	// an update whose index.html can silently remain cached as build A.
	for _, files := range []map[string][]byte{filesA, filesB} {
		sw, ok := files["sw.js"]
		if !ok {
			return nil, nil, fmt.Errorf("sw.js missing from assets")
		}
		revised, err := acceptanceIndexRevision(sw, files["index.html"])
		if err != nil {
			return nil, nil, err
		}
		files["sw.js"] = revised
	}
	asFS := func(files map[string][]byte) fs.FS {
		result := fstest.MapFS{}
		for name, data := range files {
			result[name] = &fstest.MapFile{Data: data, Mode: 0444}
		}
		return result
	}
	return asFS(filesA), asFS(filesB), nil
}

// acceptanceIndexRevision deliberately accepts only the generated manifest
// format we inspected; zero or multiple matches must fail closed.
func acceptanceIndexRevision(sw, index []byte) ([]byte, error) {
	pattern := regexp.MustCompile(`\{"revision":"[a-f0-9]+","url":"index\.html"\}`)
	matches := pattern.FindAllIndex(sw, -1)
	if len(matches) != 1 {
		return nil, fmt.Errorf("expected exactly 1 index.html precache revision, found %d", len(matches))
	}
	revision := fmt.Sprintf("%x", sha256.Sum256(index))
	replacement := []byte(fmt.Sprintf(`{"revision":"%s","url":"index.html"}`, revision))
	result := make([]byte, 0, len(sw)+len(replacement))
	result = append(result, sw[:matches[0][0]]...)
	result = append(result, replacement...)
	result = append(result, sw[matches[0][1]:]...)
	return result, nil
}

func TestPWAAcceptanceAssetVariants(t *testing.T) {
	original := []byte(`precache([{"revision":"abcd","url":"index.html"},{"revision":"abcd","url":"asset.js"}]);`)
	fixture := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte(`<html><body>acceptance</body></html>`)},
		"sw.js":      &fstest.MapFile{Data: original},
	}
	a, b, err := buildAssetVariants(fixture)
	if err != nil {
		t.Fatal(err)
	}
	for name, variant := range map[string]fs.FS{"A": a, "B": b} {
		index, err := fs.ReadFile(variant, "index.html")
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(index, []byte(`data-pwa-build="`+name+`"`)) {
			t.Fatalf("missing %s build marker", name)
		}
		sw, err := fs.ReadFile(variant, "sw.js")
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(sw, []byte(fmt.Sprintf("%x", sha256.Sum256(index)))) {
			t.Fatalf("%s HTML revision mismatch", name)
		}
		if !bytes.Contains(sw, []byte(`{"revision":"abcd","url":"asset.js"}`)) {
			t.Fatal("unrelated asset changed")
		}
	}
	swA, _ := fs.ReadFile(a, "sw.js")
	swB, _ := fs.ReadFile(b, "sw.js")
	if bytes.Equal(swA, swB) {
		t.Fatal("A/B workers must differ")
	}
	for _, invalid := range [][]byte{[]byte(`no manifest`), append(bytes.Clone(original), original...)} {
		if _, err := acceptanceIndexRevision(invalid, []byte("index")); err == nil {
			t.Fatal("expected missing/duplicate revision rejection")
		}
	}
	if !bytes.Equal(fixture["sw.js"].Data, original) {
		t.Fatal("embedded input mutated")
	}
}

// TestPWAAcceptance runs the end-to-end browser acceptance suite against a dedicated HTTP test server.
// Only gates on AVARI_PWA_E2E=1 so standard AVARI_E2E suite never runs twice.
func TestPWAAcceptance(t *testing.T) {
	if os.Getenv("AVARI_PWA_E2E") != "1" {
		t.Skip("skipping dedicated PWA acceptance tests: set AVARI_PWA_E2E=1 to run")
	}

	// Check if embedded dist assets exist
	web, err := fs.Sub(assets.Files, "dist")
	if err != nil {
		t.Fatalf("embedded dist assets unavailable; run npm run build first: %v", err)
	}

	// Read index.html to ensure build is populated
	if _, err := fs.ReadFile(web, "index.html"); err != nil {
		t.Fatalf("index.html unavailable; run npm run build first: %v", err)
	}

	fsA, fsB, err := buildAssetVariants(web)
	if err != nil {
		t.Fatalf("failed to construct A/B asset variants: %v", err)
	}

	var activeFS atomic.Pointer[fs.FS]
	activeFS.Store(&fsA)

	dynamic := &dynamicFS{current: &activeFS}

	// Setup database store
	store, err := core.Open(filepath.Join(t.TempDir(), "pwa_acceptance.sqlite"))
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer store.Close()

	// Seed approved isolated pwa user
	pwaUser, err := store.Register("pwa@example.com", "browser-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatalf("failed to register pwa user: %v", err)
	}
	if err := store.Admin("approve", pwaUser.ID, ""); err != nil {
		t.Fatalf("failed to approve pwa user: %v", err)
	}
	otherUser, err := store.Register("pwa-other@example.com", "browser-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Admin("approve", otherUser.ID, ""); err != nil {
		t.Fatal(err)
	}

	// Seed unique company, vacancy, task, and note for pwa user
	uniqueCompany := fmt.Sprintf("Acme Corp PWA %d", time.Now().UnixNano()%100000)
	app, err := store.SaveApplication(pwaUser.ID, core.Application{
		Company:  uniqueCompany,
		Position: "Senior PWA Acceptance Engineer",
		Stage:    "applied",
		State:    "active",
		URL:      "https://hh.ru/vacancy/99887766",
	}, "", "manual")
	if err != nil {
		t.Fatalf("failed to seed application: %v", err)
	}

	fixtureZone, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	todayDate := time.Now().In(fixtureZone).Format("2006-01-02")
	_, err = store.SaveTask(pwaUser.ID, core.Task{
		ApplicationID: app.ID,
		Title:         "Review PWA Acceptance Criteria",
		Kind:          "task",
		Date:          todayDate,
		Time:          "14:00",
		State:         "open",
	}, "", "manual")
	if err != nil {
		t.Fatalf("failed to seed task: %v", err)
	}

	_, err = store.AddNote(pwaUser.ID, core.Note{
		ApplicationID: app.ID,
		Text:          "Unique acceptance criteria verified for offline replay.",
	}, "", "manual")
	if err != nil {
		t.Fatalf("failed to seed note: %v", err)
	}

	// Configure Web Push transport & service
	privKey, pubKey, err := sherwebpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("failed to generate VAPID keys: %v", err)
	}
	cfg, err := webpush.NewConfig(webpush.VAPIDConfig{
		PublicKey:  pubKey,
		PrivateKey: privKey,
		Contact:    "mailto:admin@avari.test",
	})
	if err != nil {
		t.Fatalf("failed to create webpush config: %v", err)
	}
	tr, err := webpush.NewTransport(cfg)
	if err != nil {
		t.Fatalf("failed to create webpush transport: %v", err)
	}
	pushSvc := core.NewPushNotificationService(store, tr)

	api := &Server{
		Store:         store,
		Assets:        dynamic,
		PushTransport: tr,
		PushService:   pushSvc,
	}

	// Setup HTTP handler with test-only endpoint /__test/pwa-build-b
	baseHandler := api.Handler()
	testMux := http.NewServeMux()
	testMux.HandleFunc("POST /__test/pwa-expire-session", func(w http.ResponseWriter, r *http.Request) {
		if _, err := store.DB.Exec("UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE user_id=?", pwaUser.ID); err != nil {
			http.Error(w, "could not expire fixture session", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	testMux.HandleFunc("/__test/pwa-build-b", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Toggle to Build B
		activeFS.Store(&fsB)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"build":"B","swUpdated":true}`))
	})
	testMux.HandleFunc("/__test/pwa-build-a", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Reset to Build A
		activeFS.Store(&fsA)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"build":"A","swUpdated":false}`))
	})
	testMux.HandleFunc("/__test/pwa-seed-info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w, `{"email":"pwa@example.com","company":%q,"applicationId":%q}`, uniqueCompany, app.ID)
	})
	testMux.Handle("/", baseHandler)

	server := httptest.NewServer(testMux)
	defer server.Close()
	api.Origin = server.URL

	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatalf("failed to resolve root path: %v", err)
	}

	// Execute Playwright test specifically for pwa-acceptance.spec.ts
	cmd := exec.Command("npx", "playwright", "test", "tests/e2e/pwa-acceptance.spec.ts")
	if grep := os.Getenv("AVARI_PWA_E2E_GREP"); grep != "" {
		cmd.Args = append(cmd.Args, "--grep", grep)
		t.Logf("PWA acceptance subset selected explicitly: %s", grep)
	}
	cmd.Dir = root
	cmd.Env = append(
		os.Environ(),
		"AVARI_PWA_TEST_URL="+server.URL,
		"AVARI_PWA_TEST_COMPANY="+uniqueCompany,
		"AVARI_PWA_TEST_APP_ID="+app.ID,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		t.Fatalf("Playwright acceptance tests failed: %v", err)
	}
}
