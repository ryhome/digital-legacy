# Handoff — Dying Message

Read this first when picking the project up in a new session.

## Where things are

| | |
|---|---|
| Working copy | `~/Documents/Claude/dyngmsg.home1ab.com` (**not** a git checkout) |
| GitHub | `ryhome/dying-message`, branch `main`, GitHub Pages behind Cloudflare |
| Live | https://dyngmsg.home1ab.com |
| Sibling app (same setup, installs fine) | https://apnea.home1ab.com — `ryhome/Apnea-Trainer-Pro` |
| Push token | `~/.dm-gh-token`, mode 600, contents = a fine-grained GitHub PAT. Not in this file, not in the repo. |

The repo deliberately **excludes `tools/`** (dev scripts, Playwright, node_modules). Everything
else in the working copy is tracked. `docs/screenshots/`, `vendor/noble.js` and `SHA256SUMS`
are committed on purpose — see `.gitignore` for why.

## Workflow

```sh
sh tools/check.sh          # build (stamps release hash into js/version.js, sw.js, SHA256SUMS),
                           # then every static check, unit self-test, plate layout, and the
                           # Playwright e2e. ~2 min. Must be green before a push.
```

Push recipe (shallow-clone, copy, commit, push — because the working copy is not a checkout):

```sh
cd /tmp && rm -rf dmpush && git clone -q --depth 1 https://github.com/ryhome/dying-message.git dmpush
cd dmpush && git config user.name "Dying Message" && git config user.email "chanon_l@muangthai.co.th"
SRC=~/Documents/Claude/dyngmsg.home1ab.com
for f in index.html app.css manifest.webmanifest sw.js SHA256SUMS CNAME .nojekyll README.md .gitignore HANDOFF.md; do cp "$SRC/$f" .; done
for d in js vendor icons docs; do rm -rf "$d" && cp -R "$SRC/$d" .; done
git add -A && git commit -F msg.txt
git -c credential.helper='!f() { echo username=x-access-token; echo "password=$(cat ~/.dm-gh-token)"; }; f' push origin HEAD:main
```

After a push: Cloudflare caches for **4 h** (`cache-control: max-age=14400`), and the app's
service worker is cache-first and only updates when the user approves on the Update screen.
A phone will not see new code until both have turned over. Purge Cloudflare to skip the first.

## Architecture in one breath

Static PWA, no build step for the app itself, no network after install (CSP `connect-src 'none'`).
`js/main.js` registers every view; `js/app.js` owns state, routing, locking and boot;
`js/db.js` is IndexedDB; `js/vault.js` + `js/keyworker.js` are the crypto (X25519 + ML-KEM
hybrid, Argon2id from a BIP39 phrase, all inside a Worker that is terminated on lock).
`js/strings.js` holds every string in `en` and `th`; `tools/check-strings.mjs` enforces parity.
Refuses to run in a browser tab (install gate) or over plain http.

## State as of 2026-09-18 (release `b4523a41`)

Done this session, in order:

1. **Backgrounding during setup no longer discards everything.** `resetGenesis()` still wipes
   the 24 words, any passphrase and partial verification (non-negotiable — nothing secret may
   sit in memory behind a task switcher), but the five acknowledgements and the passphrase
   *choice* survive, and the warnings screen explains the restart.
2. **Import on "Before you begin".** `restoreView` already handled "no vault here"; it was
   just unreachable. Now a button, plus `from` param for Back, plus `db.persist()` on adopt.
3. **Up to three vaults per device.** IndexedDB bumped v1 → v2: each `meta` record is a vault
   (own random `id`; the legacy record keeps `id: 'vault'`), each entry stamped `vaultId`
   with an index; upgrade stamps existing entries. `db.MAX_VAULTS = 3`. New picker view
   `vaults` (`js/views-gate.js`) is the landing screen **whenever ≥ 1 vault exists**, with
   Create / Import disabled at the cap. Current vault id lives in `localStorage 'dm.vault'`.
   `openVault(id)` in `app.js` selects + runs the damage checks + routes. Remove now deletes
   one vault (`db.removeVault`), not the database. Restoring a file for an unknown
   fingerprint adds it as a new vault; `restore.other.*` strings deleted as dead.
   `putEntry`/`putEntries`/`replaceAll` stamp `vaultId` themselves so no caller can forget.

4. **Updates reach a vault-less install.** The update prompt only rendered on the vault list,
   so an installed app still on "Before you begin" could never learn of a new release.
   `wireServiceWorker` now auto-adopts when storage holds no vault (same rule as a browser
   tab: nothing to protect); the picker shows the prompt; the update screen returns to
   `home` or `vaults` as appropriate. Devices on builds *before* this need one manual
   clear of site data (only if they hold no vault!) to get onto it.
5. **Backup on desktop downloads.** `canShare` was true on macOS Chrome/Safari, whose share
   sheet has no save target. Desktop now always downloads; phones share with Download as a
   fallback button. `visibilitychange` honours `shareInFlight` (an Android chooser reports
   the page hidden) and clears it on return.
6. **Snooze while reading.** The read screen's "+2 min" button existed but only appeared in
   the last 20 s. It is now always visible (hidden only in manual-relock mode), labelled
   Snooze, repeatable without limit. Backgrounding still locks immediately.

Design choice to revisit if it annoys: with exactly **one** vault the picker still shows on
every launch (that is what was asked for). Skipping it in that case is a two-line change in
`bootView` (`views-gate.js`): `if (n === 1) { openVault(state.vaults[0].id); return; }`.

## Open issue — Android install

The user's Android phone shows the install button greyed and, at one point, no icon. Five
fixes were shipped on inference (early `beforeinstallprompt` capture in `js/early.js`, icon
validation, SW registration before the gate, self-healing stale SW, icon on the gate).
Desktop Chrome reports zero installability errors and the live site now serves current code.
**Do not ship a sixth guess.** Needed from the user, either:

- a photo of **Settings → Diagnostics** on the phone (rows `Prompt event fired`,
  `Service worker`, `Worker state`, the `Icon` rows), after clearing site data once; or
- `chrome://inspect` over USB → Application → Manifest → Installability.

Also worth asking: does apnea.home1ab.com still install on that same phone?

## Also pending

- Ponytail statusline badge is not configured (`~/.claude/settings.json` `statusLine`).
- The user's phone still runs an old service worker; every push bumps the release hash.
