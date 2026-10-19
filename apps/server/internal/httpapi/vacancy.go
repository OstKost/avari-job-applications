package httpapi

import (
	"github.com/OstKost/avari-job-applications/apps/server/internal/core"
	"github.com/OstKost/avari-job-applications/apps/server/internal/vacancy"
	"net/http"
)

func (s *Server) vacancyPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if err := read(r, &body); err != nil {
		fail(w, err)
		return
	}
	if len(body.URL) > 2048 {
		fail(w, core.Fail(400, "Слишком длинная ссылка"))
		return
	}
	canonical, _ := core.VacancyPreviewURL(body.URL)
	if canonical == "" {
		fail(w, core.Fail(400, "Укажите HTTPS-ссылку на вакансию поддерживаемого сайта"))
		return
	}
	preview, err := vacancy.Fetch(r.Context(), canonical)
	if err != nil {
		fail(w, core.Fail(422, err.Error()))
		return
	}
	write(w, 200, preview)
}
