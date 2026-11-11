# Sheet Music Composer

An iPad/Apple Pencil sketchpad for musical ideas. The planned application recognizes handwritten notation locally, preserves original ink, and supports correction, playback, and export.

## Current status

The ink surface supports **pen-only drawing, one-finger pan, and two-finger pinch zoom** on a responsive, high-DPI staff. Stroke positions are stored in staff spaces, including time, pressure, and tilt. Navigation only changes the view; mouse and touch never create ink. **Fit staff** returns to the initial fitted view without changing strokes.

When the Pencil touches down, existing touch contacts and any new contacts during the stroke are suppressed until lifted. Lift resting contacts and touch again to navigate after writing. This conservative policy is not hardware palm classification: a palm moving before Pencil contact can still pan the view.

**Undo/Redo** operates one stroke at a time, including interrupted strokes. Use the toolbar, **Ctrl/Command-Z** to undo, **Ctrl/Command-Shift-Z** or **Ctrl-Y** to redo. New ink clears redo; pan, zoom, and Fit staff do not enter history or clear it. Undo during contact finalizes and removes that partial stroke, which Redo can restore. Redo is unavailable during contact. Shortcuts leave text-editing controls alone.

**New** clears the current ink and resets the view. It asks for confirmation when ink is present, replaces the same autosaved sketch rather than archiving a separate page, and is undoable until reload. Download a backup first if you want to keep a separate copy. Clicking New on an already blank page only refits the view without adding an empty undo step.

**One current sketch autosaves to IndexedDB** after completed/interrupted strokes, undo/redo, and backup restore. Reload loads that document with a fresh undo history and fitted view. Use **Download backup** and **Restore backup** for portable JSON copies of the original ink. Wait for **Saved on this device** before reloading or closing the page.

**Record fixture** freezes the current page as one measure, previews numbered strokes, and lets you enter expected primitive groups and notes/rests before downloading validated JSON. It does not change the sketch or run recognition. See [recording and reviewing fixtures](fixtures/README.md).

Recognition and offline cold starts are not implemented yet. The user reported the fixture-recorder iPad test passing. The first real Pencil fixture is checked in with primitive-only labels; collecting more samples and confirming note-event ground truth are next, before starting pitch/simple-duration recognition. Pencil drawing with a resting palm, touch navigation, undo/redo, backup restore/save/reload after the timestamp fix, and New-page behavior have passed initial user testing on an iPad. See [the iPad checklist](docs/ipad-testing.md).

### Milestone 2 progress

The first foundation step adds shared written-music types in `src/model/music.ts` and pure treble-clef conversions in `src/staff/pitch.ts`:

- Notes/rests carry duration, dots, source-stroke references, and confidence; measures hold a single ordered voice plus unresolved ink references. Rest recognition remains a later milestone.
- `pitchAtStaffY()` snaps a staff-space notehead center to a written pitch, including ledger positions. The top line is F5 at y=0, bottom line E4 at y=4, and middle C (C4) is at y=5. Exact midpoint ties choose the lower pitch; invalid/out-of-domain positions return no pitch instead of being clamped. `staffYFromPitch()` provides the reverse conversion.
- The supported pitch representation remains C0–B9, shared with fixture validation. Accidentals do not alter staff y. Pan/zoom/CSS pixels must be converted to staff spaces before pitch lookup.

These are core types/helpers, **not recognition or notation rendering**. The saved sketch is still the version-1 ink-only document; event validation, persistence/migration, and undoable recognition commands must be added before recognized events are written to it. Existing fixture JSON stays version 1 and uses the shared musical vocabulary without changing its data.

Next: expand reviewed templates/evaluation recordings, implement the $P reference classifier, then grouping/assembly, event persistence, and VexFlow rendering. Recognition accuracy is still N/A.

## Development

Requires Node.js 24 LTS and npm. `.nvmrc` selects the Node major version; commit changes to `package-lock.json` when updating dependencies.

```sh
npm ci
npm run hooks:install
npm run dev
```

`hooks:install` enables the version-controlled `.githooks/pre-commit` hook for this checkout. It runs `npm test` and blocks commits if unit tests fail. Run it once after cloning; it replaces any existing local `core.hooksPath` setting. The hook tests the current working tree, not an isolated copy of staged changes. CI remains the required check because local hooks can be bypassed.

Open the local URL Vite prints. For iPad testing on the same trusted LAN:

```sh
npm run dev:lan
```

Open `https://<development-machine-LAN-IP>:5173` on the iPad. Allow port 5173 through the host firewall only on a trusted network. By default, the HTTPS plugin generates a self-signed localhost certificate that iPad browsers may reject. Follow **[Trusted HTTPS for iPad development](docs/lan-https.md)** to generate a LAN-IP certificate with mkcert, configure `DEV_HTTPS_CERT`/`DEV_HTTPS_KEY` in `.env.local`, and install the public CA on your iPad. Alternatively, use a staging deployment with public HTTPS. Do not expose this development server to the public internet. Normal `npm run dev` remains HTTP on localhost.

### Updating a running development session

Vite serves source changes automatically while `npm run dev` or `npm run dev:lan` is running; no build or deployment is needed. Wait for **Saved on this device**, then reload the iPad page to ensure updated event handlers are active. Reloads and hot updates restart the surface from local storage with a fresh undo history and view. Lifecycle saves are best effort: a process kill can still lose a just-drawn, uncommitted stroke. Restart Vite after changing certificate configuration or `.env.local`.

### iPad troubleshooting

- **HTTP loads but HTTPS does not:** check the certificate includes the desktop's current LAN IP, the iPad has installed the CA profile **and** enabled full trust, and Vite was restarted with the configured certificate. A successful desktop connection does not establish iPad trust. See [the HTTPS setup guide](docs/lan-https.md). If a certificate is downloaded as a file rather than a profile, use Safari and a DER `.cer` certificate served with `Content-Type: application/x-x509-ca-cert`.
- **No ink:** use Apple Pencil, not a finger or mouse. Confirm HTTPS is trusted; insecure LAN HTTP is only a connectivity test, not a supported drawing setup.
- **Delayed or missed strokes:** add `?debugInk=1` to the page URL. The footer shows a bounded, local-only log of pointer lifecycle events, secure-context capabilities, and browser errors. Note whether `down pen` appears immediately on Pencil contact. No telemetry is uploaded.
- **Touch does not navigate after writing:** lift the contacts that were resting during Pencil drawing, then touch again. Those contacts remain suppressed until lifted.

## Saving and backups

- **Single local draft:** New starts a blank page in the same autosave slot; it does not keep a separate archive. There is no sketch library, account, backend, or sync yet. Data belongs to this browser and origin (scheme, hostname/IP, and port). Firefox and Safari may have separate website data; HTTP port 5174 and HTTPS port 5173 are different origins. Use a JSON backup to move between them.
- **Autosave:** only one write runs at a time; pending edits are coalesced to the latest immutable document. “Saved” is shown only after the IndexedDB transaction completes. An active stroke is not yet saved; background/page-exit handling attempts to finalize and save it, but cannot guarantee completion if the OS kills the tab.
- **Failure recovery:** “Not saved” retains your in-memory ink. Download a backup immediately, then use **Retry saving** for transient errors such as a full quota. If initial loading fails, drawing is explicitly memory-only and the unreadable stored record is never overwritten.
- **Multiple tabs:** saves compare storage revisions in the write transaction. A stale tab reports a conflict rather than silently replacing newer work. Download its ink before reloading; there is no automatic merge.
- **Backup:** Download backup includes every current stroke's ID, completion state, staff-space positions, timestamps, pressure, and tilt. It excludes undo history, view state, and private configuration. It finalizes any active stroke before exporting a timestamped JSON file.
- **Restore:** choose a backup JSON file, confirm replacement if the sketch is nonempty, and wait for Saved. Restore is one undoable command. Invalid JSON, unsupported versions, malformed/duplicate strokes, invalid numeric samples, and oversized imports are rejected without replacing the current document. Raw timestamps may be zero or decrease between samples (for example, a coalesced batch followed by its parent event); validation requires finite, nonnegative values but never sorts, clamps, or discards them. Current import limits are 10 MiB, 10,000 strokes, and 1,000,000 points, configured in `src/config.ts`. Full exports are never truncated; an export above any of those limits warns that the corresponding configuration must be adjusted before restoring it.
- **Durability:** **Request persistent storage** asks the browser to protect local data from automatic eviction where supported; it is not a backup. Clearing website data, private browsing, storage eviction, or changing devices/origins can still lose access to sketches. Keep downloaded backups outside the browser. Server backups cannot protect IndexedDB on an iPad.

The initial file schema is `{ "format": "sheetmusicomposer", "version": 1, "document": { "strokes": [] } }`. IndexedDB wraps that file with a monotonically increasing storage revision. This is the first schema, so there is no earlier format to migrate; future changes require explicit migrations. Unknown file/database versions fail closed instead of being reinterpreted as an empty sketch.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:fixtures  # reviewed-file validation and inventory; no recognizer yet
npm run build
npx playwright install --with-deps webkit
npm run test:e2e
```

Vitest runs pure unit tests and reviewed fixture validation without a browser and exits after each run; the pre-commit hook runs this suite, not browser tests. Playwright tests the production build using WebKit with an iPad device profile, with two workers to limit browser memory use. Browser tests start their own preview server on port 4173; stop any existing server on that port first. Actual Pencil behavior still needs manual iPad testing.

### Fedora browser testing

Playwright's Linux WebKit builds target supported Ubuntu/Debian environments; Fedora may lack the required ABI-compatible libraries. If native browser launch fails, use the official image with a tag matching the installed `@playwright/test` version (currently `1.65.0`):

```sh
podman run --rm \
  -v "$PWD:/work:Z" -w /work \
  mcr.microsoft.com/playwright:v1.65.0-noble \
  npm run test:e2e
```

Run `npm ci` on the host first. This command uses the host's installed modules and is intended for Linux x86-64 development; other host architectures may need dependencies installed inside the container. The container is only a testing tool, not part of production deployment.

CI runs for pull requests and pushes to `main`, avoiding duplicate push/PR checks on feature branches. Superseded runs for the same PR/ref are canceled. It pins Ubuntu 24.04 to match local WebKit testing, limits WebKit/system-dependency installation to 5 minutes, and caps the overall job at 15 minutes. It runs all checks and uploads the production `dist/` artifact only after tests pass.

## Repository hygiene

Commit source, tests, configuration, documentation, `.githooks/`, and `package-lock.json`. Do not commit `node_modules/`, `dist/`, coverage, Playwright reports/traces, tooling logs, or TypeScript build caches; `.gitignore` excludes these generated files. Timestamped `sheetmusicomposer-*.json` personal backups saved in the repository root are also ignored; reviewed ink fixtures under `fixtures/` remain trackable.

Local `.env` files and certificate/key files are also ignored. Keep private keys outside both the repository and the web root, as shown in the HTTPS guide. Never share the mkcert root CA private key (`rootCA-key.pem`); only its public certificate is transferred to the iPad. Ignore rules do not protect a secret that was already committed or force-added, and do not prevent the dev server from serving a file placed inside its web root.

Local planning/agent instructions and deployment overrides remain ignored. Review `git status` before committing; install the hook with `npm run hooks:install` in each new checkout.

## Source layout

- `src/main.ts`: browser entry point, toolbar/keyboard bindings, and unsaved-stroke status.
- `src/model/`: immutable ink document, shared written-music vocabulary, and foundational event/measure types, independent of browser APIs. Musical events are not yet part of the saved ink document.
- `src/edit/`: DOM-free command history, stroke commands, and keyboard shortcut matching.
- `src/ink/`: typed strokes, explicit sample collector, DOM-free touch gesture math, pointer-event adapter, and canvas rendering.
- `src/staff/`: pure staff geometry, treble pitch/position helpers, and CSS-pixel/document-coordinate transforms.
- `src/store/`: validated versioned JSON, IndexedDB repository, and serialized autosave queue.
- `src/fixtures/`: DOM-free fixture schema/annotation helpers and the browser recorder dialog.
- `fixtures/`: reviewed ink JSON with manual expectations, with recorded Pencil samples kept separate from explicitly synthetic examples.
- `tests/fixtures/`: recursive fixture loader, validation/round-trip tests, and inventory reporting (recognition accuracy is not established yet).
- `src/config.ts`: document/view defaults, visual ink width, and import safety limits (no recognition thresholds yet).
- `src/style.css`: responsive workspace shell.
- `tests/e2e/`: WebKit drawing, undo/redo, navigation, resize, real IndexedDB reload/conflict tests, backup/restore, fixture export/label validation, and simulated storage failures.

Input capture only collects samples and schedules a render with `requestAnimationFrame`. Pen cancellation, capture loss, focus loss, and resizing preserve samples already received. Synthetic pointer events cover the browser adapter in tests; native Pencil capture, coalesced samples, and palm behavior require the device checklist. Pressure and tilt are preserved as raw data but do not change stroke width yet; smoothing is also deferred so original samples remain untouched.

Completed or interrupted capture is committed through an add-stroke command, which snapshots the original samples. Undo/redo changes document membership without changing sample metadata. The renderer reads the document plus any in-progress stroke. History is intentionally session-only; IndexedDB persists the document separately from its undo stacks. Data loaded from storage or imported JSON is decoded from `unknown` before it reaches the model.

As features land, add the planned `recognize`, `render`, `playback`, and `export` modules rather than building their logic into the entry point. Recognition must stay free of browser APIs. Keep recognition thresholds in `src/config.ts` when introduced.

## Deployment

```sh
npm ci
npm run build
```

Deploy **only `dist/`** to an HTTPS static host. No production Node process, backend, or server database is required. `npm run preview` is for local build verification, not production serving. Production builds need no secrets or environment variables; the optional `DEV_HTTPS_CERT`/`DEV_HTTPS_KEY` paths are only for local LAN development.

### Managed host

The proposed default is Cloudflare Pages with a stable custom domain, build command `npm run build`, and output directory `dist`. Equivalent static hosts also work. Select Node 24 in the hosting environment. Protect production promotion with the CI checks; automatic deployment must not bypass failed checks. Hosting account, domain, and release integration have not yet been configured by this scaffold.

### One Linux instance

Serve `dist/` with Caddy, for example:

```caddyfile
music.example.com {
    root * /srv/sheetmusicomposer/current
    encode zstd gzip

    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    @entry path / /index.html
    header @entry Cache-Control "no-cache"

    header X-Content-Type-Options nosniff
    header X-Frame-Options DENY
    file_server
}
```

Replace the domain and path, configure DNS and firewall access, and run Caddy as a managed service with persistent certificate storage. This assumes public DNS and certificate validation are available. Build off-server, deploy versioned release directories, and atomically switch `current` after verification. Retain previous artifacts and recently referenced hashed assets so rollback and already-open tabs continue to work. No SPA fallback is necessary for this single-page shell.

Choose a stable production origin before real sketches are stored: IndexedDB data will be local to that browser and origin. Hosting backups will not back up user sketches. Offline cold starts and service-worker update handling arrive in the later PWA milestone.

## Dependencies

Only development tooling is installed for this step: Vite, TypeScript, Vitest, Playwright, ESLint with its TypeScript integration, browser/Node lint globals, Node type definitions, and `@vitejs/plugin-basic-ssl` for HTTPS LAN development. No runtime dependencies are needed yet. VexFlow, Tone.js, and the PWA plugin will be added when their features are implemented.

Run `npm audit` when reviewing dependency changes, and `npm audit --omit=dev` to check production dependencies separately. The initial install reported moderate advisories in transitive `minimatch` dependencies used by ESLint/TypeScript lint tooling, not shipped in the static app. Review compatible upstream fixes rather than automatically running `npm audit fix --force`.
