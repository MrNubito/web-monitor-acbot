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

GitHub Pages hosts the interface. A reachable **HTTPS PC-agent endpoint** is still required for remote control. Remote access is optional. The repository does not contain your public agent address or tunnel credentials; runtime tunnel information stays in the ignored data folder. Use the temporary-tunnel launcher below to test remote access without a domain.

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

## Temporary remote access without Tailscale

On Windows x64, run these commands in the project folder:

```sh
npm run tunnel:install
npm run remote
```

The installer downloads cloudflared from the official Cloudflare GitHub release and verifies its published SHA-256 digest. The executable stays under the ignored data/bin folder. You can also use Start Remote Web Monitor.cmd after installation.

The launcher reuses the local agent if it is already running, otherwise starts it. It creates a temporary HTTPS tunnel, updates the exact allowed host and website origins in data/network.json, and prints PC AGENT ADDRESS. Open https://mrnubito.github.io/web-monitor-acbot/, paste that address, and enter your existing web access password. Runtime status is recorded only in data/remote-status.json.

Keep the PC and remote launcher running while connected. Ctrl+C stops the tunnel; it does not stop a pre-existing local agent. The address changes each time a Quick Tunnel is created. This is a testing connection with no uptime guarantee, not a permanent production hostname. A stable address needs a named tunnel/domain or another configured hosting service. No router port-forwarding or Tailscale client is required on the visiting device.

Official documentation: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

### Runtime per bot

The first performance card displays Runtime as HH:MM:SS. Session view uses ACBot runtime_seconds, or the legacy runtime string when seconds are unavailable; Daily view uses the recorded daily total. The Instances page shows each bot's latest-session runtime from the same source. The clock reflects reported bot working time, not browser uptime, and never wraps after 24 hours. Missing data appears as an em dash instead of a made-up timer.

### Local testing without publishing

Run `npm run lan` (or `Start Local Network.cmd`) to serve the current checkout directly on your private network. Open the printed local network address on a device connected to the same network and sign in with the agent password. Use `npm start` for PC-only access. Source changes are visible after reloading; restart the agent for service changes. Neither command uploads to GitHub.

Profile Studio shows the recorded TH level when ACBot stores `TH_LEVEL`. Missing levels remain unknown. Upgrade, research and pet targets use the bundled catalogs and preserve the profile's existing slot count and value format.

Live view now streams continuous ADB H.264 video into a browser MediaSource player (jMuxer 2.1.4, MIT, bundled locally under web/vendor). It has selectable 640/960/1280 maximum-edge resolution, authenticated fetch streaming, bounded buffering and encoder cleanup on disconnect. Android screenrecord renews after its time limit; the player reconnects automatically. Screenshot remains a separate still-image action.

### Account Statistics

The agent polls log changes and cumulative counters every two seconds, independently of browser connections, and stores its own history in ignored `data/account-history.db`. A confirmed profile-load log identifies each account, scoped by instance. New history begins at the initial counter baseline; no old instance totals are imported. Intervals spanning profile switches, missing logs, counter resets or agent interruptions are excluded from account totals and shown as Unassigned where a positive difference can be recovered. Account totals are estimates because ACBot saves global counters periodically. Today and Last 7 days use the PC local timezone and sample observation times. Keep the PC agent running to collect history.

### Fixed address and memorable sign-in

Install and sign in to Tailscale on the PC, then run `npm run funnel` and complete any Funnel enablement link printed by Tailscale. This publishes the password-protected agent on the PC’s stable HTTPS ts.net hostname; visitors do not need the Tailscale client. Keep the agent running. The browser recognizes its own ts.net address, so opening that URL directly only requires the password. Connection settings lets you change the saved agent address.

Open the account menu, sign in, and use **Change password** to choose a memorable phrase of 12–256 characters. The current password is required; changing it signs out other sessions. Only the agent address is remembered in local storage. Passwords are never stored in browser storage or source control.

### Windows portable preview

Run `npm run portable:build` on Windows to generate a clean ZIP under ignored `releases/`. The builder downloads the pinned official Node.js Windows x64 runtime, verifies it against the published SHA-256 checksum, includes its license and compiles native start/stop launchers with the Windows .NET Framework C# compiler. Only service, web and portable source folders are packaged; runtime user data, environment files, repository history and tests are excluded.

Users extract the ZIP and run **ACBot Web Monitor.exe**. The local, token-protected first-run assistant guides ACBot folder discovery, ADB/device selection, password creation, optional Tailscale setup, diagnostics and optional startup at Windows sign-in. The launcher remains in the background, prevents duplicate starts and preserves each portable copy’s own data. **Stop ACBot Web Monitor.exe** stops that copy without stopping ACBot or other monitors.

`node scripts/smoke-portable.cjs releases/<package>.zip` verifies a clean extracted package using the bundled runtime and native launchers, with disposable fixture data, then checks stop/restart persistence and exclusion of private files. A clean Windows VM test and real emulator/remote onboarding on a second PC are still recommended before a public release.

### In-app portable updates

The Updates page checks official GitHub Releases for a newer Windows portable ZIP and its matching SHA-256 file. Stable releases are checked by default; previews are opt-in. Installation is supported in configured portable copies, not Git checkouts. The agent verifies the checksum, archive paths and manifest before stopping. A detached worker backs up files and data, replaces managed program files, restarts and checks startup. User data remains in place. Failed updates restore the old program; interrupted updates recover when the launcher is reopened. Restore previous version becomes available after the first in-app update. Two recent backup/cache folders are retained, together with still referenced active and previous jobs.

For publishing: update package.json, commit the source, then run Build portable release in GitHub Actions with a matching tag. Leave Publish unchecked for a test build, or enable it to create the Release after tests and native smoke tests pass. Every Release must contain ACBot-Web-Monitor-<version>-windows-x64.zip and its .zip.sha256 file. Pushing source alone does not create a downloadable application update. Never upload a configured portable folder.

node scripts/smoke-update.cjs releases/<package>.zip tests verified staging, native restart, installation and explicit rollback in a disposable copy, preserving the password hash and history sentinel.

### Agent reliability

The portable launcher supervises its own agent process, retries crashed starts with bounded exponential delay, and restarts after repeated failed HTTP health checks. Silent --background launches are supported. When Windows startup is enabled, an interactive per-user scheduled task runs every 2 minutes to recover a missing launcher. Stop pauses recovery until a manual Start. A private ownership key permits safe handoff of an orphaned agent, and a launcher lock prevents duplicate supervisors. Logs are bounded under data/supervisor.log and data/agent.log. Task registration status is saved in data/recovery-task.json.

Remote mode checks Tailscale and Funnel every minute, reconfiguring a missing tunnel only when signed in and no conflicting service is detected. NeedsLogin is reported in data/remote-health.json; the user must authenticate again. The monitor cannot keep a sleeping or powered-off PC accessible.

The smoke-recovery script verifies a child crash, parent recovery, port preservation and the intentional-stop pause using a disposable extracted package.

### Native ACBot per-account statistics

New ACBot versions store daily account counters in profile_daily and Town Hall metadata in profile_info inside logs/stats/stats.db. Account stats reads these tables in read-only mode and uses them per instance when available, including potions_used. Older instances fall back to labeled monitor estimates. Native totals and estimates are never combined for the same instance. The Source selector can show Legacy estimates separately; observed turn details remain labeled as estimates because ACBot provides daily totals rather than turn-level history. Profile Studio also prefers the recorded Town Hall metadata.

### Reading Account stats on mobile

Phones show one card per account, with runtime, attacks and loot up front. More statistics expands exact loot amounts, donations, upgrades, research, potions, Builder Base and star counts. Desktop keeps the full table. Automatic account refresh now runs every 15 seconds, updates existing keyed DOM nodes only, preserves expanded sections and scroll position, and leaves the previous data visible during transient errors. Pause updates stops automatic requests; Refresh works while paused. Filter changes cancel stale responses.
