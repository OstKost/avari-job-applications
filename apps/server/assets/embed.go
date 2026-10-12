package assets

import "embed"

// Files contains the production web build. Run npm run build:web before go build.
//
//go:embed all:dist
var Files embed.FS
