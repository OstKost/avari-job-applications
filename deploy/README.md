# Avari.Jobs production operations

Production uses `jobs.avari.dev`, the OpenResty instance at `/opt/om/nginx`, and a dedicated Compose project with a persistent `avari-jobs-data` volume. The application listens on `127.0.0.1:18081`. The VPS deploy entry point is `/usr/local/sbin/avari-jobs-deploy` and accepts a stable release tag, a GHCR image digest and the registry username; it reads a short-lived GHCR token from stdin.

The GitHub `production` environment requires `AVARI_DEPLOY_SSH_KEY` and `AVARI_DEPLOY_HOST_KEY`. The `chrome-web-store` environment requires secret `CHROME_SERVICE_ACCOUNT_JSON` and variables `CHROME_SERVICE_ACCOUNT_EMAIL`, `CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID`. `CHROME_AUTO_PUBLISH` defaults to false. The first publication checklist and listing copy are in [Chrome-Web-Store.md](../docs/Chrome-Web-Store.md). Set repository variable `CHROME_STORE_URL` after the first public store publication; the next release displays its install link.

Push to `main` to verify. Create an annotated `vX.Y.Z` tag on a commit reachable from `main`, then push the tag. The release workflow verifies, builds an image and archives, creates a GitHub Release, deploys the pinned image, and checks the public site and downloadable ZIP. Chrome submission is an independent **Publish Chrome extension** workflow: enter the already deployed tag. It submits for Google review. Set `CHROME_AUTO_PUBLISH=true` to queue the same workflow after future successful deployments.

During deployment the helper sets `/opt/avari-jobs/maintenance`, stops the container, makes an integrity-checked SQLite backup, starts the new image and checks `/readyz` and `/release.json`. On failure it saves the failed database and restores the previous image and database. Previous backup files live under `/opt/avari-jobs/backups`. The helper keeps five backups. The Docker volume is never removed by the deploy script.

To administer users over an interactive SSH session: `sudo /usr/local/sbin/avari-jobs-admin`. The wrapper selects the same pinned image and volume as the app. Administrator access to the VPS is required; the CI deploy user is not granted this command.

For status/logs, open a root shell (`sudo -i`), set `export AVARI_IMAGE="$(awk '{print $2}' /opt/avari-jobs/current)"`, then run `docker compose -f /opt/avari-jobs/compose.production.yaml ps` or `docker compose -f /opt/avari-jobs/compose.production.yaml logs app`. Stop the app before restoring a backup; do not copy a live SQLite database file. After restoring, start the pinned image from `/opt/avari-jobs/current` and check `/readyz`.

## Web Push (VAPID) configuration

The server supports standard Web Push notifications (RFC 8291, RFC 8292). Configuration is controlled by three environment variables:

- `AVARI_VAPID_PUBLIC_KEY`: 65-byte uncompressed P-256 EC public point encoded as URL-safe base64 (without padding, begins with `0x04`).
- `AVARI_VAPID_PRIVATE_KEY`: 32-byte raw scalar private key in range `[1, N-1]` encoded as URL-safe base64 (without padding).
- `AVARI_VAPID_CONTACT`: Contact subscriber URI starting with `mailto:` (e.g. `mailto:admin@example.com`) or `https://` without credentials.

### Validation and Graceful Degradation
- If all three variables are absent/empty, Web Push is **gracefully disabled**. The server starts normally and `GET /api/v1/push/config` reports `{"enabled": false, "publicKey": ""}`.
- If partially configured or invalid (wrong key length, corrupted base64url, private key not matching public key, or malformed contact), the server will fail startup immediately with an actionable error.
- Web Push requires HTTPS (or `localhost` for local development) to establish a secure context.

### Validated Key Generation

Generate a valid P-256 VAPID keypair using Node.js standard `crypto` module (Node 16+):

```sh
node -e '
import("node:crypto").then(crypto => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  console.log("AVARI_VAPID_PUBLIC_KEY=" + ecdh.getPublicKey("base64url"));
  console.log("AVARI_VAPID_PRIVATE_KEY=" + ecdh.getPrivateKey("base64url"));
  console.log("AVARI_VAPID_CONTACT=mailto:admin@example.com");
});
'
```

Add these values to `/etc/avari/avari.env` (for systemd installations) or to your local git-ignored `.env` / production deployment environment (for Compose). Never commit generated private keys to the repository or paste them into tracked template files (such as `.env.example` or `deploy/avari.env.example`) or build logs.

### Operator Verification
After configuring VAPID keys and restarting the server:
1. Verify `GET /api/v1/push/config` returns `{"enabled": true, "publicKey": "..."}`.
2. In the web interface, navigate to **Настройки → Общие → Push-уведомления** and click to enable notifications. Confirm that the browser requests notification permission and subscription completes.
3. Use «Проверить» to queue a test notification, then verify its actual arrival on the device; a queued response is not a delivery receipt.

Real provider delivery must be checked separately after operator opt-in and valid VAPID configuration; the automated integration run does not prove APNs/FCM/Mozilla delivery or background timing on real devices.
