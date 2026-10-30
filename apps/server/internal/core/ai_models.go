package core

// AIFields is optional as a whole so older clients cannot erase AI data.
type AIFields struct {
	Text        string     `json:"text"`
	Summary     string     `json:"summary"`
	Skills      []SkillRef `json:"skills"`
	Source      string     `json:"source"`
	ProcessedAt string     `json:"processedAt"`
	Provider    string     `json:"provider"`
	Model       string     `json:"model"`
	TextHash    string     `json:"textHash"`
	Stale       bool       `json:"stale"`
}
type SkillRef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
}
type Skill struct {
	SkillRef
	Aliases []string `json:"aliases"`
	Level   *int     `json:"level"`
	Base    bool     `json:"base"`
}
type AISettings struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey,omitempty"`
	HasKey   bool   `json:"hasKey"`
}
type Profile struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	ApplicationIDs []string `json:"applicationIds"`
	Content        string   `json:"content"`
	Version        int      `json:"version"`
	GeneratedAt    string   `json:"generatedAt"`
	UpdatedAt      string   `json:"updatedAt"`
}
type AIJob struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	TargetID  string `json:"targetId"`
	Status    string `json:"status"`
	InputHash string `json:"inputHash"`
	Result    string `json:"result"`
	Error     string `json:"error"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
type AIExtraction struct {
	Summary string     `json:"summary"`
	Skills  []SkillRef `json:"skills"`
}
type DirectionSuggestion struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}
type SkillCount struct {
	Skill
	Count int     `json:"count"`
	Share float64 `json:"share"`
}
type SkillStatistics struct {
	Total     int          `json:"total"`
	Processed int          `json:"processed"`
	Skills    []SkillCount `json:"skills"`
}

const aiMigration = `
CREATE TABLE IF NOT EXISTS ai_settings(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,provider TEXT NOT NULL,model TEXT NOT NULL,base_url TEXT NOT NULL,secret BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,canonical TEXT NOT NULL,category TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS skills_personal_name ON skills(user_id,canonical) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skills_base_name ON skills(canonical) WHERE user_id IS NULL;
CREATE TABLE IF NOT EXISTS skill_aliases(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,alias TEXT NOT NULL,skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,PRIMARY KEY(user_id,alias));
CREATE TABLE IF NOT EXISTS skill_levels(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,level INTEGER CHECK(level BETWEEN 0 AND 10),PRIMARY KEY(user_id,skill_id));
CREATE TABLE IF NOT EXISTS application_skills(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,application_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,PRIMARY KEY(user_id,application_id,skill_id));
CREATE INDEX IF NOT EXISTS application_skills_skill ON application_skills(user_id,skill_id);
CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,target_id TEXT NOT NULL,status TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_active ON ai_jobs(user_id,kind,target_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS ai_jobs_owner ON ai_jobs(user_id,created_at);
INSERT OR IGNORE INTO skills(id,user_id,name,canonical,category) VALUES
('base-react',NULL,'React','react','hard'),('base-sql',NULL,'SQL','sql','hard'),('base-javascript',NULL,'JavaScript','javascript','hard'),('base-typescript',NULL,'TypeScript','typescript','hard'),('base-python',NULL,'Python','python','hard'),('base-go',NULL,'Go','go','hard'),('base-c',NULL,'C','c','hard'),('base-cpp',NULL,'C++','c++','hard'),('base-csharp',NULL,'C#','c#','hard'),('base-java',NULL,'Java','java','hard'),('base-docker',NULL,'Docker','docker','hard'),('base-kubernetes',NULL,'Kubernetes','kubernetes','hard'),('base-postgresql',NULL,'PostgreSQL','postgresql','hard'),('base-git',NULL,'Git','git','hard'),('base-excel',NULL,'Excel','excel','hard'),('base-figma',NULL,'Figma','figma','hard'),('base-english',NULL,'Английский язык','английский язык','language'),('base-communication',NULL,'Коммуникация','коммуникация','soft'),('base-teamwork',NULL,'Командная работа','командная работа','soft');
`
