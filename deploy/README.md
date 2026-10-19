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

## Telegram (disabled until acceptance)

The integration is off by default. It only starts with `AVARI_TELEGRAM_ENABLED=true` on `https://jobs.avari.dev`; personal mode and local origins reject enabled configuration. Local development must never use the production token. Tests use an in-process fake Bot API.

Configure these values through the private production environment:

- `AVARI_TELEGRAM_ENABLED=false` until the acceptance checks below are complete.
- `AVARI_TELEGRAM_BOT_TOKEN`: the token issued by BotFather.
- `AVARI_TELEGRAM_BOT_USERNAME`: the bot username without `@`.
- `AVARI_TELEGRAM_WEBHOOK_SECRET`: 32–256 characters from `A-Z`, `a-z`, `0-9`, `_`, `-`; generate independently of the bot token.

Forward all four variables to the app container. With the intended production environment loaded, run `/app/avari -telegram-setup` (or the server binary's corresponding path) as a one-shot deployment step. This explicitly registers the HTTPS webhook and Russian commands for private chats. Normal startup does not register or replace webhooks. Telegram authenticates deliveries with `X-Telegram-Bot-Api-Secret-Token`; see the [Bot API webhook documentation](https://core.telegram.org/bots/api#setwebhook). Do not put tokens or deep links in command arguments, logs or tracked files.

Schema 12 adds independent Telegram tables. Existing journal JSON exports contain neither bindings nor secrets. SQLite backups include the integration state and must remain private. Incoming events are acknowledged after SQLite commit. One worker processes the durable inbox serially; journal changes, drafts, receipts and queued responses commit atomically. Outgoing sends retry temporary failures and `retry_after`; delivery is at least once (Telegram `sendMessage` has no idempotency key, so a crash after Telegram accepts a send can duplicate a response). Domain mutations remain idempotent. Drafts expire after 24 hours.

Morning and evening digests are independent of Web Push, default off, run on weekdays at 09:00/18:00 in the account timezone and expire at 09:15/18:15. Forbidden Bot API responses switch automatic delivery off while preserving the binding. Users can unblock the bot and explicitly enable digests again. Disconnecting preserves web sessions; blocking or administrative session revocation cancels pending login authorizations.

Before enabling the production bot, use a separate test bot in an isolated acceptance deployment and check: registration activation and TUI approval, website confirmation of a linked identity, explicit login confirmation with matching code, original-browser completion, disconnect, forwarded text and unavailable vacancy pages, duplicate callbacks, timezone scheduling, and retry/blocked-bot behavior. Automated tests do not prove delivery through Telegram's real infrastructure. The integration remains disabled until this external check is complete.

### GitHub production environment

Store `AVARI_TELEGRAM_BOT_TOKEN` and `AVARI_TELEGRAM_WEBHOOK_SECRET` as environment secrets; set variables `AVARI_TELEGRAM_BOT_USERNAME=AvariJobsBot` and `AVARI_TELEGRAM_ENABLED=true` after acceptance. Release CI passes the four settings as JSON on stdin to the restricted `avari-jobs-deploy --telegram-config` entry point. It preserves unrelated `.env` settings and atomically writes `/opt/avari-jobs/.env` with mode 0600. Invalid settings are rejected without changing the file. Install the checked-in deploy helper and production Compose file on the VPS when updating deployment infrastructure. The release registers the webhook after readiness, then checks the bot identity, webhook URL and private-chat commands before recording deployment success.

The release workflow verifies a tagged commit already on `main`. For a bot acceptance run, keep the main website on its existing version, run the candidate binary with a separate SQLite database on a free loopback port, and temporarily proxy only an isolated HTTPS webhook path to it. Switch the bot to the production webhook only during the release's normal setup step; remove the temporary proxy, service and database afterwards. Never import acceptance bindings into production.

### Optional polling fallback

`AVARI_TELEGRAM_DELIVERY_MODE` defaults to `webhook`. Set the GitHub production variable to `polling` only when choosing the outbound long-polling fallback for a VPS whose HTTPS ingress Telegram cannot reach. Setup then deletes the Telegram webhook without dropping pending updates and configures the same private-chat commands. The application receives authenticated Bot API batches, commits each batch and its next offset atomically in SQLite, and acknowledges remotely on the next poll. Failed storage never advances the cursor. After an empty acknowledged batch the cursor resets to zero, supporting Telegram's random ID restart after a week of inactivity. Existing conversation processing, deduplication, ownership checks and delivery queues are shared by both modes. Run only one polling instance per bot token. The public webhook route still requires the secret if used; local/personal deployments still reject an enabled integration.

### Existing VPS AWG route

The production VPS already runs `awg-quick@awg0`. Its peer routes Telegram address ranges through `awg0`; reuse this tunnel rather than installing a second VPN. The production delivery mode is `polling`, because Telegram webhook connections time out before reaching the VPS. Docker's existing forwarding and masquerade rules also route application Bot API requests through AWG. Verify HTTPS from the application network namespace, not only from the host, after changing networking. Keep AWG peer keys outside this repository and CI secrets; the bot only needs the existing host route.

Check `systemctl is-active awg-quick@awg0`, resolve `api.telegram.org` and check `ip route get <resolved-IP>` selects `awg0`. Polling requires outbound HTTPS and exactly one running consumer. Stop any isolated acceptance consumer before enabling production. Switching back to webhook requires restoring reachable inbound HTTPS; AWG outbound routing alone does not provide webhook ingress.
