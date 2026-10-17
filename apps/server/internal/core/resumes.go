package core

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"path/filepath"
	"strings"
)

const (
	MaxResumeFileSize    = 20 * 1024 * 1024  // 20 MiB per file
	MaxAccountResumeSize = 500 * 1024 * 1024 // 500 MiB per account
)

var allowedResumeFormats = map[string]string{
	".pdf":  "PDF",
	".md":   "MD",
	".txt":  "TXT",
	".docx": "DOCX",
	".doc":  "DOC",
	".odt":  "ODT",
	".rtf":  "RTF",
}

// ValidateResumeFile validates extension, size, and magic bytes / signatures.
func ValidateResumeFile(filename string, content []byte) (string, error) {
	if len(content) == 0 {
		return "", Fail(400, "Файл резюме пуст")
	}
	if int64(len(content)) > MaxResumeFileSize {
		return "", Fail(400, "Размер файла превышает лимит 20 МБ")
	}

	ext := strings.ToLower(filepath.Ext(filename))
	format, ok := allowedResumeFormats[ext]
	if !ok {
		return "", Fail(400, "Неподдерживаемый формат резюме. Разрешены: PDF, MD, TXT, DOCX, DOC, ODT, RTF")
	}

	// Validate content header
	switch format {
	case "PDF":
		if !bytes.HasPrefix(content, []byte("%PDF-")) {
			return "", Fail(400, "Файл повреждён или не является PDF")
		}
	case "RTF":
		if !bytes.HasPrefix(content, []byte("{\\rtf")) {
			return "", Fail(400, "Файл повреждён или не является RTF")
		}
	case "DOC":
		// Compound File Binary format (OLE): 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1
		oleHeader := []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}
		if !bytes.HasPrefix(content, oleHeader) {
			return "", Fail(400, "Файл повреждён или не является DOC")
		}
	case "DOCX", "ODT":
		// PK Zip header: 0x50, 0x4B, 0x03, 0x04
		if !bytes.HasPrefix(content, []byte{0x50, 0x4B, 0x03, 0x04}) {
			return "", Fail(400, "Файл повреждён или не является документом архива")
		}
	case "TXT", "MD":
		// Text / Markdown: check for binary zero bytes in first 512 bytes
		sample := content
		if len(sample) > 512 {
			sample = sample[:512]
		}
		if bytes.IndexByte(sample, 0) != -1 {
			return "", Fail(400, "Файл содержит недопустимые бинарные данные")
		}
	}

	return format, nil
}

// Resumes returns all resumes with their sequential versions for the user.
func (s *Store) Resumes(user string) ([]Resume, error) {
	rows, err := s.DB.Query("SELECT id, title, created_at, updated_at FROM resumes WHERE user_id=? ORDER BY created_at DESC, id", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	resumes := []Resume{}
	for rows.Next() {
		var r Resume
		if err := rows.Scan(&r.ID, &r.Title, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.Versions = []ResumeVersion{}
		resumes = append(resumes, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	vRows, err := s.DB.Query("SELECT id, resume_id, version_number, filename, format, size, checksum, created_at FROM resume_versions WHERE user_id=? ORDER BY version_number ASC", user)
	if err != nil {
		return nil, err
	}
	defer vRows.Close()

	versionsByResume := map[string][]ResumeVersion{}
	for vRows.Next() {
		var v ResumeVersion
		if err := vRows.Scan(&v.ID, &v.ResumeID, &v.VersionNumber, &v.Filename, &v.Format, &v.Size, &v.Checksum, &v.CreatedAt); err != nil {
			return nil, err
		}
		versionsByResume[v.ResumeID] = append(versionsByResume[v.ResumeID], v)
	}
	if err := vRows.Err(); err != nil {
		return nil, err
	}

	for i := range resumes {
		if vers, ok := versionsByResume[resumes[i].ID]; ok {
			resumes[i].Versions = vers
		}
	}
	return resumes, nil
}

// Resume returns a single logical resume with its versions.
func (s *Store) Resume(user, id string) (Resume, error) {
	var r Resume
	err := s.transaction(func(tx *sql.Tx) error {
		err := tx.QueryRow("SELECT id, title, created_at, updated_at FROM resumes WHERE id=? AND user_id=?", id, user).Scan(&r.ID, &r.Title, &r.CreatedAt, &r.UpdatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return Fail(404, "Резюме не найдено")
		}
		if err != nil {
			return err
		}

		rows, err := tx.Query("SELECT id, resume_id, version_number, filename, format, size, checksum, created_at FROM resume_versions WHERE resume_id=? AND user_id=? ORDER BY version_number ASC", id, user)
		if err != nil {
			return err
		}
		defer rows.Close()

		r.Versions = []ResumeVersion{}
		for rows.Next() {
			var v ResumeVersion
			if err := rows.Scan(&v.ID, &v.ResumeID, &v.VersionNumber, &v.Filename, &v.Format, &v.Size, &v.Checksum, &v.CreatedAt); err != nil {
				return err
			}
			r.Versions = append(r.Versions, v)
		}
		return rows.Err()
	})
	return r, err
}

func checkAccountResumeQuota(tx *sql.Tx, user string, additionalSize int64) error {
	var totalSize sql.NullInt64
	err := tx.QueryRow("SELECT coalesce(sum(size), 0) FROM resume_versions WHERE user_id=?", user).Scan(&totalSize)
	if err != nil {
		return err
	}
	if totalSize.Int64+additionalSize > MaxAccountResumeSize {
		return Fail(400, "Превышен лимит 500 МБ для резюме в аккаунте")
	}
	return nil
}

// CreateResume creates a new logical resume and uploads its version 1.
func (s *Store) CreateResume(user, title, filename string, content []byte) (Resume, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		// Default title to base filename without extension
		title = strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	}
	if textLength(title) > 200 {
		return Resume{}, Fail(400, "Название резюме не должно превышать 200 символов")
	}
	filename = filepath.Base(filename)
	if filename == "" || filename == "." {
		return Resume{}, Fail(400, "Некорректное имя файла")
	}

	format, err := ValidateResumeFile(filename, content)
	if err != nil {
		return Resume{}, err
	}

	sum := sha256.Sum256(content)
	checksum := hex.EncodeToString(sum[:])
	size := int64(len(content))

	var res Resume
	err = s.transaction(func(tx *sql.Tx) error {
		if err := checkAccountResumeQuota(tx, user, size); err != nil {
			return err
		}

		resID := ID()
		nowStamp := now()
		_, err := tx.Exec("INSERT INTO resumes(id, user_id, title, created_at, updated_at) VALUES(?,?,?,?,?)", resID, user, title, nowStamp, nowStamp)
		if err != nil {
			return err
		}

		verID := ID()
		_, err = tx.Exec("INSERT INTO resume_versions(id, resume_id, user_id, version_number, filename, format, size, checksum, content, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
			verID, resID, user, 1, filename, format, size, checksum, content, nowStamp)
		if err != nil {
			return err
		}

		res = Resume{
			ID:        resID,
			Title:     title,
			CreatedAt: nowStamp,
			UpdatedAt: nowStamp,
			Versions: []ResumeVersion{
				{
					ID:            verID,
					ResumeID:      resID,
					VersionNumber: 1,
					Filename:      filename,
					Format:        format,
					Size:          size,
					Checksum:      checksum,
					CreatedAt:     nowStamp,
				},
			},
		}
		return nil
	})
	return res, err
}

// AddResumeVersion uploads a new sequential version to an existing resume.
func (s *Store) AddResumeVersion(user, resumeID, filename string, content []byte) (ResumeVersion, error) {
	filename = filepath.Base(filename)
	if filename == "" || filename == "." {
		return ResumeVersion{}, Fail(400, "Некорректное имя файла")
	}

	format, err := ValidateResumeFile(filename, content)
	if err != nil {
		return ResumeVersion{}, err
	}

	sum := sha256.Sum256(content)
	checksum := hex.EncodeToString(sum[:])
	size := int64(len(content))

	var ver ResumeVersion
	err = s.transaction(func(tx *sql.Tx) error {
		var title string
		err := tx.QueryRow("SELECT title FROM resumes WHERE id=? AND user_id=?", resumeID, user).Scan(&title)
		if errors.Is(err, sql.ErrNoRows) {
			return Fail(404, "Резюме не найдено")
		}
		if err != nil {
			return err
		}

		if err := checkAccountResumeQuota(tx, user, size); err != nil {
			return err
		}

		var maxVer int
		err = tx.QueryRow("SELECT coalesce(max(version_number), 0) FROM resume_versions WHERE resume_id=?", resumeID).Scan(&maxVer)
		if err != nil {
			return err
		}
		nextVer := maxVer + 1
		verID := ID()
		nowStamp := now()

		_, err = tx.Exec("INSERT INTO resume_versions(id, resume_id, user_id, version_number, filename, format, size, checksum, content, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
			verID, resumeID, user, nextVer, filename, format, size, checksum, content, nowStamp)
		if err != nil {
			return err
		}

		_, err = tx.Exec("UPDATE resumes SET updated_at=? WHERE id=?", nowStamp, resumeID)
		if err != nil {
			return err
		}

		ver = ResumeVersion{
			ID:            verID,
			ResumeID:      resumeID,
			VersionNumber: nextVer,
			Filename:      filename,
			Format:        format,
			Size:          size,
			Checksum:      checksum,
			CreatedAt:     nowStamp,
		}
		return nil
	})
	return ver, err
}

// RenameResume updates the title of a logical resume.
func (s *Store) RenameResume(user, id, newTitle string) (Resume, error) {
	newTitle = strings.TrimSpace(newTitle)
	if newTitle == "" || textLength(newTitle) > 200 {
		return Resume{}, Fail(400, "Название резюме должно содержать от 1 до 200 символов")
	}

	var res Resume
	err := s.transaction(func(tx *sql.Tx) error {
		nowStamp := now()
		result, err := tx.Exec("UPDATE resumes SET title=?, updated_at=? WHERE id=? AND user_id=?", newTitle, nowStamp, id, user)
		if err != nil {
			return err
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			return Fail(404, "Резюме не найдено")
		}
		return tx.QueryRow("SELECT id, title, created_at, updated_at FROM resumes WHERE id=?", id).Scan(&res.ID, &res.Title, &res.CreatedAt, &res.UpdatedAt)
	})
	if err != nil {
		return res, err
	}
	return s.Resume(user, id)
}

// DeleteResume deletes a logical resume and all its versions.
func (s *Store) DeleteResume(user, id string) error {
	return s.transaction(func(tx *sql.Tx) error {
		_, _ = tx.Exec("DELETE FROM resume_versions WHERE resume_id=? AND user_id=?", id, user)
		result, err := tx.Exec("DELETE FROM resumes WHERE id=? AND user_id=?", id, user)
		if err != nil {
			return err
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			return Fail(404, "Резюме не найдено")
		}
		return nil
	})
}

// DeleteResumeVersion deletes a single version. If it was the last version, the logical resume is also removed.
func (s *Store) DeleteResumeVersion(user, resumeID, versionID string) error {
	return s.transaction(func(tx *sql.Tx) error {
		result, err := tx.Exec("DELETE FROM resume_versions WHERE id=? AND resume_id=? AND user_id=?", versionID, resumeID, user)
		if err != nil {
			return err
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			return Fail(404, "Версия резюме не найдена")
		}

		var count int
		err = tx.QueryRow("SELECT count(*) FROM resume_versions WHERE resume_id=?", resumeID).Scan(&count)
		if err != nil {
			return err
		}
		if count == 0 {
			_, err = tx.Exec("DELETE FROM resumes WHERE id=?", resumeID)
			return err
		}
		_, err = tx.Exec("UPDATE resumes SET updated_at=? WHERE id=?", now(), resumeID)
		return err
	})
}

// ResumeVersionDownload retrieves file metadata and content for safe attachment download.
func (s *Store) ResumeVersionDownload(user, resumeID, versionID string) (filename, format string, size int64, content io.ReadSeeker, err error) {
	var raw []byte
	err = s.DB.QueryRow("SELECT filename, format, size, content FROM resume_versions WHERE id=? AND resume_id=? AND user_id=?", versionID, resumeID, user).
		Scan(&filename, &format, &size, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", 0, nil, Fail(404, "Версия резюме не найдена")
	}
	if err != nil {
		return "", "", 0, nil, err
	}
	return filename, format, size, bytes.NewReader(raw), nil
}
