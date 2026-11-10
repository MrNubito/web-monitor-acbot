# Web Monitor ACBot

Independent web edition of Discord Log Monitor. The original project, executable, `.env` and running bot are not modified. This folder contains a fork of the control code; it never imports the original installation's configuration.

## Start locally

Requires Node.js 24 or later and Windows for the ACBot window controls.

```sh
npm install
npm run setup
npm start
```

Open **http://127.0.0.1:17942**. Enter that address and the password created during setup. The password is stored as a scrypt hash in `data/access.json`. Sessions expire after eight hours and are invalidated when the service restarts. Run `npm run setup` again to replace the password.

The dashboard starts empty. In **Settings**, configure the local ACBot folders, devices, log paths and Discord credentials for this separate installation. Settings live in `data/.env`, not in the desktop app. Empty secret inputs preserve saved credentials; the API does not return their values. Saving settings takes effect on the next monitor start. Do not start two Discord monitors with the same bot token at once.

## Included

- Responsive English dashboard, connection/login screen and instance controls.
- Session and latest-recorded-day statistics from ACBot `stats.db` or JSON files. Empty states show unavailable data rather than invented totals.
- Live log polling every two seconds, pause, filtering and monitor console.
- Start/pause/stop/show/hide ACBot, open/close ACBot and LDPlayer, and emulator screenshots.
- Visible Screenshot and Live view buttons beside the instance controls. Live view requests sequential authenticated screenshots, with fast/normal/low-bandwidth refresh options, fullscreen and PNG download. It is a live image preview rather than an H.264 video player. It stops on emulator changes, navigation, hidden tabs, disconnection or capture errors. No credentials are placed in image URLs.
- Global and named profile editor with the existing friendly names, categories, value validation, backups and per-field conflict detection. Complex values can be edited as JSON. After saving, restart-and-Start is available separately.
- Complete copied configuration interface, including Discord, monitoring/recovery and Android Autostart. Android is retained as an optional feature; this migration focuses on the desktop edition.
- Separate local agent with authenticated APIs, bounded login attempts, explicit origin allowlist and loopback binding. Monitoring does not open another unauthenticated server.

The original Windows scripts are retained. Window control requires an unlocked interactive Windows session. The browser cannot execute these actions without the local PC agent.

## GitHub Pages

Suggested repository name: **web-monitor-acbot**.

1. Create the repository in your GitHub account.
2. Push this new folder's source to its `main` branch.
3. Set **Settings → Pages → Source → GitHub Actions**.
4. Run the included **Publish web dashboard** workflow if it did not run on push.

The workflow publishes only `web/`. It does **not** publish the PC service, credentials, profiles, screenshots or `data/`. The address will be `https://YOUR-USERNAME.github.io/web-monitor-acbot/`.

GitHub Pages hosts the interface. A reachable **HTTPS PC-agent endpoint** is still required for remote control. No public tunnel, external account or domain has been created by this project. The current setup is local-only until that endpoint is configured.

For a tunnel, point it at `http://127.0.0.1:17942`. Keep the agent bound to loopback. In the private, ignored file `data/network.json`, add the exact public agent URL and the GitHub origin:

```json
{
  "publicUrl": "https://YOUR-AGENT-ENDPOINT",
  "allowedOrigins": ["https://YOUR-USERNAME.github.io"]
}
```

Use the HTTPS agent URL in the web login screen. Do not put the password, a Discord token or a tunnel credential into the public frontend, repository, URL query string or workflow. Configure tunnel and identity access before relying on remote use. A temporary tunnel URL changes when recreated and is not a permanent production address.

## Development and validation

```sh
npm test
```

Tests cover authentication, expired/revoked sessions, login limits, hostile origins/hosts, secret redaction/preservation, stats sources and profile conflict handling. Runtime data is ignored by Git. The forked legacy control engine is under `service/agent`; browser-only files are under `web`.

Browser preview was unavailable in the development environment because local browser access was disabled. API tests and JavaScript syntax checks are provided; a visual check on desktop and phone is still required before deployment.

### Command Center interface (v0.2)

The dashboard now prioritizes emulator live view, with instance cards, six resource/activity metrics, grouped controls, a consistent SVG icon system, a redesigned connection screen, and a responsive navigation layout. Profile categories include option counts and boolean switches. The configuration screen uses the same visual theme. No backend settings or desktop app files are changed by this redesign.

### Reference-led violet gaming redesign

The current interface uses the user-supplied visual reference: a cinematic violet header, a decorative sidebar character, a compact monitor strip, purple resource cards, instance controls on the left and emulator screen on the right. The Instances section is connected to configured devices. Performance charts use real snapshots collected since the page opened; they do not invent historical growth or percentage comparisons. Generated assets and their prompts are documented in design-assets.md. All seven automated tests pass; automatic browser preview remains unavailable because local browser use is disabled.
