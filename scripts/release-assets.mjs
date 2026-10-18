import { readFile } from "node:fs/promises";
import { releaseNotes, root } from "./release-notes.mjs";
import path from "node:path";

export async function loadReleaseAssets() {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const version = process.env.AVARI_VERSION || pkg.version;
  return {
    "release.json": JSON.stringify({ version }),
    "release-notes.json": JSON.stringify(await releaseNotes(version)),
  };
}

// The same assets are served by Vite dev, Vite preview and the embedded Go server.
export function releaseAssetsPlugin() {
  return {
    name: "avari-release-assets",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const filename = (req.url || "").split("?")[0].slice(1);
        if (!["release.json", "release-notes.json"].includes(filename))
          return next();
        if (!["GET", "HEAD"].includes(req.method || "")) {
          res.writeHead(405, { Allow: "GET, HEAD" });
          res.end();
          return;
        }
        try {
          const assets = await loadReleaseAssets();
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(req.method === "HEAD" ? undefined : assets[filename]);
        } catch (error) {
          server.config.logger.error(String(error));
          res.writeHead(503, {
            "Content-Type": "application/json; charset=utf-8",
          });
          res.end(
            JSON.stringify({ error: "Не удалось загрузить историю изменений" }),
          );
        }
      });
    },
    async generateBundle() {
      for (const [fileName, source] of Object.entries(
        await loadReleaseAssets(),
      )) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}
