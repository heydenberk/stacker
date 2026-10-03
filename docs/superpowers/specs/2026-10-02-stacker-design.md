# Stacker — album-shuffle jukebox for the TV

**Status:** design approved 2026-10-02 · **Owner:** Eric

## Goal

Listen to records cover to cover, shuffled at the *album* level. Pick a crate of
records on the TV; Stacker plays one whole album, then the next album in a shuffled
order — never Spotify's autoplay — and shows a "now playing" display worth looking
at from the couch.

## Non-goals (v1)

- A public product. Spotify development mode caps an app at 5 allowlisted users and
  extended access requires an organization with 250k MAU, so this is personal-use
  software for Eric's household.
- Phone remote, picking the next record, editing crates on the TV, settings screens,
  lyrics, visualizers.
- Standalone hardware device (possible later project).
- In-app curation (crates are built in Claude Code, see below).

## Constraints that shaped the design

| Constraint | Consequence |
|---|---|
| Player API is Premium-only; dev-mode apps require the owner to have Premium | Eric's Premium account owns the Spotify app |
| No "album ended" webhook | Conductor polls player state and detects record end |
| Autoplay can't be disabled via API | One-time manual step: Autoplay off in the TV Spotify app's settings |
| Refresh tokens expire 6 months after authorization (refreshing doesn't extend) | Sign-in screen + expiry warning banner 14 days ahead |
| Feb 2026: batch `GET /albums` removed; search `limit` max 10; playlist items only for owned playlists | Resolve albums one at a time, at crate-build time, and cache; no playlists involved |
| Audio features/analysis unavailable to new apps | Display is driven by cover art, track list and progress only |
| RYM has no API; scraping is against its terms | Use RYM's CSV export ("Export your data" on profile) |
| One TV screen can't show Stacker and the Spotify TV app at once | Spotify TV app plays audio in the background; Stacker is the foreground app |
| Spotify redirect URIs: `localhost` not allowed | Redirect goes to the app root, not `/callback`, because Pages has no SPA fallback. Dev uses `http://127.0.0.1:5173/…`; prod uses `https://heydenberk.com/stacker/` |

## Hardware

Google TV (Android). Audio comes from the **Spotify TV app** playing in the
background (Google TV keeps media apps playing when a non-media app is in front).
Stacker is a foreground app that plays no audio, so it never takes audio focus.

## Architecture

Three parts, one repo (`~/git/stacker`, **public** GitHub repo `heydenberk/stacker`; decided 2026-10-03, because GitHub Pages on the free plan needs a public repo, and Eric's RYM ratings are already public):

```
RYM export ──► crate builder (Claude Code + scripts) ──► crates/*.json ──git push──► GitHub Pages (heydenberk.com/stacker/)
                                                                                       │
Google TV:  [Stacker shell ► web app] ──Spotify Web API──► Spotify TV app (audio, background)
```

1. **Crate builder** (laptop, run from Claude Code): turns the RYM export into a
   normalized library, and writes crates that Claude curates from Eric's prompts.
2. **TV web app** (static site on GitHub Pages at `https://heydenberk.com/stacker/`, built and deployed by a GitHub Action on push):
   crate picker, now-playing display, sign-in, and the conductor. Talks to Spotify
   directly from the browser using Authorization Code + PKCE; no backend.
3. **TV shell** (sideloaded Android TV app): a full-screen WebView that loads the
   deployed URL, keeps the screen on, and passes remote keys to the page.

**Stack:** TypeScript everywhere — Vite + Preact (web app), Node scripts (crate
builder), Vitest (tests). Kotlin for the shell (~50 lines).

**Spotify app:** one developer app in development mode, owned by Eric.
- Web app scopes: `user-read-playback-state`, `user-modify-playback-state`.
- Crate builder: Client Credentials flow (search, album, album tracks). Its client
  secret lives in a local `.env`, never committed or deployed.

**Privacy:** the deployed site is public-by-URL and contains only crate data (album
names, Spotify IDs, cover URLs). The raw RYM export stays in the repo and is not part
of the build. Tokens are stored only in the TV's WebView storage.

## Part 1 — Crate builder

### Library import

`npm run import-rym -- <path-to-export.csv>` → `library/library.json`.

RYM export columns: `RYM Album, First Name, Last Name, First Name localized,
Last Name localized, Title, Release_Date, Rating, Ownership, Purchase Date, Media Type`
(note leading spaces in some header names).

Normalization:
- Artist = `First Name + " " + Last Name`, trimmed (e.g. `"" + "!!!"`, `"Bob" + "Dylan"`).
- Localized artist from the localized columns when present (e.g. 박혜진 → Park Hye Jin);
  both kept for matching.
- Decode HTML entities in all text (`&amp;`, `&#34;`, …).
- Rating stays on RYM's 0–10 scale; `0` = unrated (mostly wishlist).
- Year from `Release_Date`.

Library entry: `{ rymId, artist, artistLocalized?, title, year, rating, ownership }`.

Eric's export (2026-10-02): 3,226 rows, 3,020 rated; 1,059 at 4★+; 356 at 4.5★+.

### Building a crate (conversational)

1. Eric describes a mood in Claude Code ("rainy Sunday, mostly acoustic, ~20 records").
2. Claude selects records from `library/library.json` by `rymId`, using its own
   knowledge of the albums for mood/genre (the export has no genres).
3. `npm run resolve -- crates/<id>.json` matches each record to Spotify and fills in
   the `spotify` block. Unknown `rymId`s are rejected (no invented albums).
4. The resolver prints medium/low-confidence matches; Claude and Eric fix them via
   `library/overrides.json` and re-run.
5. Commit + push → GitHub Pages redeploys → TV picks it up on next load.

### Matching

`builder/src/match.ts` is the source of truth; this is a summary.

Searches use the `market` from `SPOTIFY_MARKET` in `.env` (default `US`) and
`limit` 10. They are tried in order, stopping at the first high-confidence match:
1. `artist:"<artist>" album:"<title>"`
2. The same with the romanized artist name.
3. A free-text `<artist> <title>` query.

Each part of a `Main [Alternate]` title is tried. Various Artists records use a
title-only `album:"<title>"` search.

Scoring:
- **Artist:**
  - 50 for an exact normalized match on the first credit.
  - 35 for an exact match on a later credit.
  - 30 when one name contains the other, e.g. RYM "Mingus" vs Spotify "Charles
    Mingus". The reverse direction counts only if the Spotify name has 2+ words.
  - 0 otherwise, which rejects the candidate.
  - Various Artists records: 40 if the candidate lists Various Artists, 25 for any
    other compilation, otherwise 20.
- **Title:** 40 for exact after stripping edition text, 25 for a whole-word
  prefix, otherwise up to 20 by word overlap.
- **Adjustments:**
  - Edition wording such as remaster, deluxe or mono: −8.
  - "Live" when the RYM title isn't live: −15.
  - Spotify `album_type` single: −20.
  - Release year: same year +10, one year off 0, two or more off −10.

Confidence is high at 90+, medium at 70+, low at 45+, otherwise none. Rules added
after review, because a wrong "high" plays the wrong album without anyone checking
it:
- **High needs an exact release-year match.** Missing years, or years that differ,
  cap the score at 89.
- **Close calls between candidates from different years are demoted to medium.**
- **Symbol-only names compare by their raw text** ("!!!" ≠ "???").

Overrides file, `library/overrides.json`: `{ "<rymId>": "<album>" | "unavailable" }`.
- `<album>` can be a bare Spotify album id, `spotify:album:<id>`, or an
  `open.spotify.com/album/<id>` link.
- To accept a resolved match, pin it to its own album id. It then leaves the review
  list.

Known trap (test fixture): naive search for "Nick Drake Pink Moon" returns Drake's
*Views*.

### Crate file format

`crates/index.json` lists crate ids in display order. Each `crates/<id>.json`:

```json
{
  "id": "rainy-sunday",
  "name": "Rainy Sunday",
  "mood": "hushed, mostly acoustic, for a grey afternoon",
  "createdAt": "2026-10-02",
  "records": [
    {
      "rymId": "…",
      "artist": "Nick Drake",
      "title": "Pink Moon",
      "year": 1972,
      "rating": 10,
      "spotify": {
        "albumId": "…",
        "coverUrl": "https://i.scdn.co/image/…",
        "tracks": [{ "id": "…", "name": "Pink Moon", "durationMs": 123000 }]
      }
    }
  ]
}
```

Records with `"spotify": null` (unavailable) are kept in the file for reference and
skipped by the app.

The resolver also writes an optional `match` object on each record:
`{ confidence, spotifyName, spotifyArtists, spotifyYear, override? }`. It is used for
match review and re-runs; the app ignores it.

## Part 2 — TV web app

### Conductor

> **As built:** the conductor differs from the description below. The source of truth is `web/src/conductor/types.ts` and `step.ts`; Plan 2026-10-03's as-built notes summarise the differences. Read the rest of this section as the original intent.

Persisted per TV in local storage:
`{ crateId, order: rymId[], pos, trackIndex, progressMs, deviceId, deviceName, authorizedAt }`.

Implemented as a pure function `step(state, event) → { state, actions[] }`.
- Events: `snapshot(playerState | null)`, `remote(key)`, `timer`, `crateLoaded`.
- Actions: `play(albumUri, offset?, positionMs?)`, `pause`, `resume`, `next`, `prev`,
  `setShuffle(false)`, `setRepeat('off')`, `ui(message)`.
- A thin effect runner executes actions against a `SpotifyClient` interface.

**Starting a record:** resolve the TV device by saved name from
`GET /me/player/devices` (if missing → "Open Spotify on the TV"); set shuffle off and
repeat off; `PUT /me/player/play` with `context_uri: spotify:album:<id>` and
`device_id`.

**Polling:** `GET /me/player` every 5 s while playing; slower while paused; stopped
when the page is hidden. During the last track, schedule a check at the expected end
time (+300 ms) so the gap between records is ~1–2 s.

**Record finished** — the last state seen was the current album's last track, and now
one of:
- the context is no longer the current album (e.g. autoplay), or
- playback has stopped, or
- nothing is playing.

Then `pos += 1` and start the next record. At the end of the order, reshuffle
(Fisher–Yates), never putting the record that just finished first.

**Yielding:** if the context changes to something else while *not* on the last
track, the user took over (e.g. from their phone). Conductor stops acting and shows
"Paused — you're playing something else. OK to go back to <crate>."

**Resume:** on launch, if the current playback context is the crate's current album,
attach silently. Otherwise offer "Resume <crate> — record N: <album>, track T?" and
start with `offset` and `position_ms`.

**Rate limits:** ~6 requests per 30 s while playing. On 429, wait for `Retry-After`.

### Screens

1. **Sign in** — "Connect Spotify" (PKCE redirect), then confirm the TV device.
   Banner on other screens when sign-in expires within 14 days
   (`authorizedAt + 6 months`).
2. **Crate picker** — horizontal row of crate cards. Each card shows name, 2×2 cover
   mosaic, record count, mood line, and "Resume at record N" when in progress. Also
   shows a problems list ("2 records couldn't play") when non-empty.
3. **Now playing** — Direction A "Liner Notes"; mockup:
   https://claude.ai/artifact/Wvtzgfc2LHFUDE5Fsi2qxe (artboard "A · Liner Notes").
   - Large cover on the left; segmented album progress bar below it (one segment per
     track, width ∝ duration) with elapsed / total.
   - Right column: crate name + "Record N of M", album title, artist, year, track list.
     Played tracks dimmed; the current track highlighted with elapsed / duration.
   - Background: the cover, heavily blurred and darkened.
   - Bottom: "Up next" album, plus a strip of every cover in the crate (played dimmed,
     current enlarged and outlined).
   - RYM rating stars: **hidden by default** (decision parked, see below).
   - Progress interpolates locally between polls.
4. **Record change** — cover and background crossfade; a "Record N of M" card for
   ~3 s. The only animation.
5. **Overlays** — paused; "you're playing something else"; resume prompt;
   "Couldn't play <album> on Spotify — skipped".

Type sized for 10-foot viewing (body ≥ 24px at 1080p).

### Remote controls

| Key | Action |
|---|---|
| OK / Play-Pause | Pause / resume |
| ▶ / ◀ | Next / previous track (◀ restarts the track unless within its first 3 s) |
| ▼ | Skip record; requires a second press within 3 s to confirm |
| Back | To crate picker. Playback continues; choosing another crate switches |
| ▲ | Unused in v1 |

## Part 3 — TV shell

Android TV app (Kotlin), sideloaded via `adb`:
- Leanback launcher entry.
- Full-screen WebView loading the deployed URL, with JavaScript and DOM storage on.
- `FLAG_KEEP_SCREEN_ON`.
- D-pad keys forwarded to the page as arrow keys / Enter; Back forwarded to the page,
  and exits the app only from the crate picker.

**Shell notes from the web-app review (for Plan 4):**
- **Enable DOM storage in the WebView.** Without it, the sign-in data and tokens live only in memory and are lost when the page reloads during sign-in.
- **Check which Chromium version the TV's WebView runs.** If it's old, set Vite's `build.target` to match.
- **Test on the TV against a deployed build or a LAN-reachable preview.** The dev server binds to 127.0.0.1 only.

**On-TV results (2026-10-03):** Eric's TV is a "Smart TV Pro" (G08, onn-style Google TV) running Android 14 / SDK 34, with Android System WebView 153.
- **Install:** sideload via adb on port 5555 worked. Wireless-debugging pairing failed with a protocol fault, but the classic network-debugging port was available.
- **Sign-in:** email/password in the WebView works.
- **Playback:** Shuffle & play on the TV's Spotify works.
- **Background running:** the conductor kept going behind other apps (Home → another app; the next record started on time). `dumpsys` shows KeepAliveService as `isForeground=true` (specialUse), with the process at `fg-service`.
- **Overlay permission:** granted (`SYSTEM_ALERT_WINDOW` appop = allow). `bringToFront` and `isOtherAudioPlaying` are still to be confirmed.

**Takeover setting (decided 2026-10-03, for Plans 3–4):** one on-screen toggle, "Take over the TV", **on** by default.
- **On:** starting or advancing a record interrupts whatever else is playing; Android pauses it automatically through audio focus. The shell also brings Stacker's now-playing screen to the front.
- **Off:** Stacker doesn't start or advance a record while another app is producing sound. It waits until that sound stops. Pressing Shuffle & play yourself always overrides this.

The web app can only see Spotify, so the shell provides both "is other audio playing?" (`AudioManager.isMusicActive()`) and "bring to front" through a small JS bridge.

## Error handling

| Situation | Behavior |
|---|---|
| Refresh fails (expired / revoked) | Sign-in screen; conductor state preserved; resume afterward |
| TV Spotify device not listed | "Open Spotify on the TV"; re-check every 5 s; continue automatically |
| Album unplayable (403/404 / unavailable) | Skip with toast; add to problems list on crate picker |
| 429 | Back off per `Retry-After`, silently |
| Network loss | Keep display, interpolate progress, "Offline" banner, retry with backoff |
| Premium lapsed (403 premium required) | Plain message; nothing else to do |
| Crate edited mid-play | Keep current and played records; add new records to the unplayed part, shuffled; drop removed ones |

## Testing

- **Conductor:** Vitest table tests over recorded/hand-built snapshot sequences:
  - normal album end
  - autoplay blip
  - user takeover → yield
  - pause / resume
  - skip record (double-press)
  - end-of-crate reshuffle (first ≠ last played)
  - unplayable album
  - resume / attach on launch
  - crate edited mid-play
- **SpotifyClient:** an interface with a fake implementation for tests.
- **Crate builder:** RYM parsing (entities, name join, localized names, unrated rows);
  match scoring fixtures, including the Nick Drake vs Drake trap, remaster/deluxe
  preference, and Various Artists.
- **Manual:** the web app runs in desktop Chrome against a real Spotify device for
  day-to-day development; a short on-TV smoke checklist.

## Build order

0. **TV spike: done 2026-10-03, all passed.** Audio continues in the background,
   remote album changes don't bring Spotify to the foreground, and Eric logs in with
   email/password, so login works in the WebView. Conductor uses a fresh `play` per
   record (no queue fallback needed). Original checklist:
   1. Start an album in Spotify on the TV, press Home, open a non-media app. Does
      audio continue?
   2. While in that app, start a different album on the TV from the phone. Does audio
      switch without Spotify jumping to the foreground?
   3. Does Spotify login work inside an Android WebView for Eric's login method?
      Email/password should; Google/Apple/Facebook buttons may be blocked in WebViews.
   - If 2 fails: start the next record by queueing its first track during the final
     track instead of a fresh `play`.
1. Crate builder (import, resolve, overrides) and the first real crate.
2. Conductor + tests.
3. Web app screens (sign-in, picker, now playing, overlays).
4. TV shell.

## Parked decisions / later ideas

- RYM rating stars on now playing (default off; mockup has a toggle).
- Shell auto-launches Spotify in the background, then returns to the front.
- Phone remote; choosing the next record; in-app curation via the Claude API.
- Genre data (e.g. MusicBrainz) for richer curation.
- Standalone hardware device.
