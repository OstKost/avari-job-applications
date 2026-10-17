package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func postMultipart(t *testing.T, server *httptest.Server, path, fieldname, filename string, content []byte, extraFields map[string]string, headers map[string]string) (int, map[string]any) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	part, err := w.CreateFormFile(fieldname, filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	for k, v := range extraFields {
		_ = w.WriteField(k, v)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := http.NewRequest("POST", server.URL+path, &b)
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", w.FormDataContentType())
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	res, err := server.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	payload, _ := io.ReadAll(res.Body)
	var data map[string]any
	_ = json.Unmarshal(payload, &data)
	return res.StatusCode, data
}

func TestHTTPResumeEndpoints(t *testing.T) {
	store, _, server := setup(t)
	u, err := store.Register("resume-api@example.com", "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Admin("approve", u.ID, ""); err != nil {
		t.Fatal(err)
	}
	_, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": u.Email, "password": "secure-test-password"}, nil)
	csrf := login["csrf"].(string)
	headers := map[string]string{
		"Cookie":       cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value,
		"Origin":       server.URL,
		"X-CSRF-Token": csrf,
	}

	// 1. Initial list: empty
	status, res, _ := call(t, server, "GET", "/api/v1/resumes", nil, headers)
	if status != 200 {
		t.Fatalf("expected 200, got %d", status)
	}
	_ = res

	// 2. Upload new resume
	pdfContent := []byte("%PDF-1.4 my test resume")
	status, createRes := postMultipart(t, server, "/api/v1/resumes", "file", "cv.pdf", pdfContent, map[string]string{"title": "Мой CV"}, headers)
	if status != 201 {
		t.Fatalf("expected 201 on resume upload, got %d: %v", status, createRes)
	}
	resumeID := createRes["id"].(string)
	if createRes["title"] != "Мой CV" {
		t.Fatalf("unexpected title: %v", createRes["title"])
	}

	// 3. Upload new version
	txtContent := []byte("updated plain text resume")
	status, v2Res := postMultipart(t, server, "/api/v1/resumes/"+resumeID+"/versions", "file", "cv2.txt", txtContent, nil, headers)
	if status != 201 {
		t.Fatalf("expected 201 on version upload, got %d: %v", status, v2Res)
	}
	versionID := v2Res["id"].(string)
	if v2Res["versionNumber"].(float64) != 2 {
		t.Fatalf("expected version 2, got %v", v2Res["versionNumber"])
	}

	// 4. Download version 2
	req, err := http.NewRequest("GET", server.URL+"/api/v1/resumes/"+resumeID+"/versions/"+versionID+"/download", nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("download failed with status %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != string(txtContent) {
		t.Fatalf("downloaded content mismatch")
	}

	// 5. Rename resume
	status, renRes, _ := call(t, server, "PUT", "/api/v1/resumes/"+resumeID, map[string]string{"title": "Переименованное резюме"}, headers)
	if status != 200 || renRes["title"] != "Переименованное резюме" {
		t.Fatalf("rename failed: %d, %v", status, renRes)
	}

	// 6. Delete version 2
	status, delVerRes, _ := call(t, server, "DELETE", "/api/v1/resumes/"+resumeID+"/versions/"+versionID, nil, headers)
	if status != 200 || delVerRes["ok"] != true {
		t.Fatalf("delete version failed: %d, %v", status, delVerRes)
	}

	// 7. Delete whole resume
	status, delRes, _ := call(t, server, "DELETE", "/api/v1/resumes/"+resumeID, nil, headers)
	if status != 200 || delRes["ok"] != true {
		t.Fatalf("delete resume failed: %d, %v", status, delRes)
	}

	// List resumes again: empty
	status, listRes, _ := call(t, server, "GET", "/api/v1/resumes", nil, headers)
	if status != 200 {
		t.Fatal(status)
	}
	_ = listRes
}

func TestHTTPApplicationActivityAndReconcile(t *testing.T) {
	store, _, server := setup(t)
	u, err := store.Register("activity-api@example.com", "secure-test-password", "Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Admin("approve", u.ID, ""); err != nil {
		t.Fatal(err)
	}
	_, login, cookies := call(t, server, "POST", "/api/v1/auth/login", map[string]string{"email": u.Email, "password": "secure-test-password"}, nil)
	csrf := login["csrf"].(string)
	headers := map[string]string{
		"Cookie":       cookies[0].Name + "=" + cookies[0].Value + "; " + cookies[1].Name + "=" + cookies[1].Value,
		"Origin":       server.URL,
		"X-CSRF-Token": csrf,
	}

	// Create application via HTTP
	status, app, _ := call(t, server, "POST", "/api/v1/applications", map[string]any{
		"company":  "Яндекс",
		"position": "Архитектор",
		"stage":    "saved",
		"state":    "active",
	}, headers)
	if status != 200 {
		t.Fatalf("expected 200, got %d: %v", status, app)
	}
	if app["lastActivityAt"] == nil || app["lastActivityAt"] == "" {
		t.Fatal("expected lastActivityAt on created application")
	}
	if app["stale"] != false {
		t.Fatal("new application should not be stale")
	}

	// GET application detail
	appID := app["id"].(string)
	status, detail, _ := call(t, server, "GET", "/api/v1/applications/"+appID, nil, headers)
	if status != 200 {
		t.Fatalf("get detail failed: %d", status)
	}
	appDetail := detail["application"].(map[string]any)
	if appDetail["lastActivityAt"] == nil {
		t.Fatal("detail application missing lastActivityAt")
	}

	// Test reconcile endpoint
	status, recRes, _ := call(t, server, "POST", "/api/v1/reminders/reconcile", nil, headers)
	if status != 200 || recRes["ok"] != true {
		t.Fatalf("reconcile endpoint failed: %d, %v", status, recRes)
	}
}
