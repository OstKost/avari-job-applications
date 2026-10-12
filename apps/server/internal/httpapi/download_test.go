package httpapi

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHTTPExtensionDownloadTokenAndStaticProtection(t *testing.T) {
	store, api, server := setup(t)
	api.Assets = fstest.MapFS{
		"downloads/avari-extension.zip": &fstest.MapFile{Data: []byte("PK-test-extension-zip-archive")},
		"index.html":                    &fstest.MapFile{Data: []byte("<html>app</html>")},
	}

	// 1. Direct access to /downloads/ is blocked
	res, e := server.Client().Get(server.URL + "/downloads/avari-extension.zip")
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("expected 404 for direct downloads/ access, got %d", res.StatusCode)
	}

	// 2. Unauthenticated management is rejected
	path := "/api/v1/extension/download"
	status, _, _ := call(t, server, "GET", path, nil, nil)
	if status != 401 {
		t.Fatalf("expected 401 for unauthenticated download link request, got %d", status)
	}

	// 3. Register and approve user
	u, e := store.Register("downloader@example.com", "secure-test-password", "Europe/Moscow")
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Admin("approve", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	_, _, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": u.Email, "password": "secure-test-password"}, nil)
	headers := map[string]string{"Cookie": cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value, "Origin": server.URL}

	// 4. Authenticated user gets personalized download URL
	status, linkRes, _ := call(t, server, "GET", path, nil, headers)
	if status != 200 {
		t.Fatalf("expected 200 for authenticated download link, got %d", status)
	}
	downloadURL := linkRes["url"].(string)
	if !strings.Contains(downloadURL, "/api/v1/extension/download/") || !strings.HasSuffix(downloadURL, "/avari-extension.zip") {
		t.Fatalf("unexpected download url: %s", downloadURL)
	}

	// 5. Download file via token link
	downloadReq, _ := http.NewRequest("GET", downloadURL, nil)
	downloadResp, e := server.Client().Do(downloadReq)
	if e != nil {
		t.Fatal(e)
	}
	defer downloadResp.Body.Close()
	if downloadResp.StatusCode != 200 {
		t.Fatalf("expected 200 for download, got %d", downloadResp.StatusCode)
	}
	body, _ := io.ReadAll(downloadResp.Body)
	if string(body) != "PK-test-extension-zip-archive" {
		t.Fatalf("unexpected content: %s", string(body))
	}
	if downloadResp.Header.Get("Content-Type") != "application/zip" {
		t.Fatalf("unexpected content type: %s", downloadResp.Header.Get("Content-Type"))
	}
	if downloadResp.Header.Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("unexpected cache control: %s", downloadResp.Header.Get("Cache-Control"))
	}
	if downloadResp.Header.Get("X-Robots-Tag") != "noindex, nofollow, noarchive" {
		t.Fatalf("unexpected robots tag: %s", downloadResp.Header.Get("X-Robots-Tag"))
	}

	// 6. Conditional request with ETag
	etag := downloadResp.Header.Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	condReq, _ := http.NewRequest("GET", downloadURL, nil)
	condReq.Header.Set("If-None-Match", etag)
	condResp, e := server.Client().Do(condReq)
	if e != nil {
		t.Fatal(e)
	}
	condResp.Body.Close()
	if condResp.StatusCode != 304 {
		t.Fatalf("expected 304, got %d", condResp.StatusCode)
	}

	// 7. Invalid token returns 404
	badReq, _ := http.NewRequest("GET", server.URL+"/api/v1/extension/download/0123456789abcdef0123456789abcdef/avari-extension.zip", nil)
	badResp, e := server.Client().Do(badReq)
	if e != nil {
		t.Fatal(e)
	}
	badResp.Body.Close()
	if badResp.StatusCode != 404 {
		t.Fatalf("expected 404 for non-existent token, got %d", badResp.StatusCode)
	}

	// 8. Blocking user revokes token
	if e = store.Admin("block", u.ID, ""); e != nil {
		t.Fatal(e)
	}
	blockedResp, e := server.Client().Do(downloadReq)
	if e != nil {
		t.Fatal(e)
	}
	blockedResp.Body.Close()
	if blockedResp.StatusCode != 404 {
		t.Fatalf("expected 404 for blocked user download token, got %d", blockedResp.StatusCode)
	}
}
