# Stacker crate editor — design

**Status:** draft for approval, 2026-10-03.
**Builds on:** `2026-10-02-stacker-design.md` Part 1, the crate builder.

## Goal

A local web page for building crates by hand. You search your RYM library by genre, rating, decade or text, drag records into crates, match them on Spotify, fix any bad matches, and publish. It replaces "describe a mood to Claude" as the main way to make crates; that workflow keeps working alongside it.

## Non-goals

- Running on the TV, or being deployed anywhere. The editor is laptop-only and talks to the local repo.
- Editing RYM ratings. RYM stays the source of truth: re-export, then `import-rym`.
- Multiple users.

## Genres

The RYM export has no genres. Genres come from two sources, merged:

1. **MusicBrainz**, via `npm run genres:mb`.
   - For each library entry, search MusicBrainz release groups by artist and title. Pick the match with the same matching rules as Spotify; low-confidence matches are discarded.
   - Store its `genres` and `tags` (name + vote count) in `library/genres-mb.json`, keyed by rymId. Unmatched entries are stored as `null`.
   - **Rate limit:** 1 request/s, with a `User-Agent` of `Stacker/0.1 (https://github.com/heydenberk/stacker)`, as MusicBrainz requires.
   - **Resumable:** entries already fetched are skipped, so a re-run only fetches new library entries. The first run takes about an hour.
2. **Claude merge.** Claude produces `library/genres.json`.
   - **Vocabulary:** Claude first writes `library/genre-vocabulary.json`, a controlled vocabulary of about 15 broad **parents** (e.g. Rock, Jazz, Brazilian, Electronic, Folk, Hip Hop) with RYM-style **genres** under each (Bossa Nova, Samba, MPB, Tropicália, Shoegaze, Dream Pop, Hard Bop, Spiritual Jazz…). It's derived from the MusicBrainz tag distribution and from Claude's knowledge of the library.
   - **Tagging:** each record gets 1–3 genres from the vocabulary, plus its parents. MusicBrainz tags count as evidence, and Claude's own knowledge fills the gaps.
   - **Record shape:** `{ genres: string[], parents: string[], source: 'auto' | 'manual' }`.
   - **Batches:** the tagging runs as background batches of about 400 records each.
   - **Manual edits win:** records with `source: 'manual'` (edited in the editor) are never overwritten by a re-run.

## Editor

### Running it
`npm run editor` serves **http://127.0.0.1:5174**. It's a Vite + Preact app in `editor/`, separate from the TV web app in `web/`. Its API runs as Vite dev-server middleware inside the same Node process, and reuses `builder/src/*` (resolver, Spotify client, file helpers) and `shared/crate.ts`. The Spotify client secret stays server-side, read from `.env`.

### Layout
- **Left, library search.**
  - **Filters:**
    - a text box for artist or title;
    - genre filters: parent chips, then genre chips with counts, combined with OR within a level and AND across levels;
    - minimum rating, using RYM's 0.5–5 stars;
    - decade checkboxes;
    - "hide records already in this crate".
  - **Results:** each row shows artist — title (year), stars, and genre chips. Rows are draggable, and also have a **+** button that adds to the active crate.
- **Right, crates.**
  - **Crate controls:** a crate selector, plus new / rename / delete. Each crate has a name, a mood line, and its records.
  - **Records:** each one shows a match badge: unmatched / high / medium / low / none / unavailable / override. Records can be removed.
  - **Dropping and duplicates:** dropping a record adds it. Duplicates are ignored, and you get a brief "already in crate" note.
  - **Save** happens automatically on every change. It writes `crates/<id>.json`, keeps existing Spotify data for records that are unchanged, and adds the crate to `crates/index.json`.
- **Match on Spotify:** runs `resolveCrate` server-side, so the existing matching rules apply, and shows progress. It then lists the records that need review:
  - each with its RYM line and the proposed Spotify album, linked to open.spotify.com;
  - **Accept** pins the match by writing its album id to overrides;
  - **Paste link** sets a different album;
  - **Unavailable** marks the record as not on Spotify.

  Every one of these writes `library/overrides.json`, then re-matches that one record.
- **Genre editing:** click a record's genres to change its chips. That writes `library/genres.json` with `source: 'manual'`.
- **Publish:**
  - The button shows a preview: `git status` and diff stat, limited to `crates/`, `library/overrides.json` and `library/genres.json`.
  - It suggests a commit message, which you can edit.
  - On confirm, it runs `git add` on those paths, `git commit` and `git push`.
  - It refuses to publish crates that still have unreviewed matches, or that have uncommitted changes outside those paths.
  - Pushing needs the GitHub remote, which Plan 4 creates. Until then Publish commits and reports "no remote yet".

### API (local only, JSON)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/library` | library entries merged with genres |
| GET | `/api/genres/vocabulary` | parents → genres |
| PUT | `/api/genres/:rymId` | manual genre edit |
| GET | `/api/crates` | all crates, including drafts |
| PUT | `/api/crates/:id` | save `{ name, mood, rymIds }`; keeps existing Spotify data for unchanged records |
| POST | `/api/crates` | create `{ name, mood }` → `{ id }`; the id is a slug of the name |
| PATCH | `/api/crates/:id` | rename (`name`, `mood`) |
| DELETE | `/api/crates/:id` | delete the file and its index entry |
| POST | `/api/crates/:id/resolve` | run the matcher; returns the crate and its review list |
| PUT | `/api/overrides/:rymId` | `{ value: link \| id \| 'unavailable' \| null }`; null removes the override |
| GET | `/api/publish` | preview: the changed paths, and whether there are blockers |
| POST | `/api/publish` | `{ message }` → commit (and push, if a remote exists) |

The server binds 127.0.0.1 only. Requests whose `Origin` is not `http://127.0.0.1:5174` are rejected, so other sites can't drive the editor.

## Testing
- **MusicBrainz client:** unit tests with a fake fetch, covering search parsing, the 1 request/s rate limiting via an injected clock, and resumability.
- **Genre store:** merge rules (manual edits win) and validation against the vocabulary.
- **API handlers:** written as pure functions over an injected filesystem and Spotify API, and tested without a server. Covers saving that keeps Spotify data, slug creation, delete, override writes, and publish blockers.
- **UI:** the filter logic (genre AND/OR, rating, decade, text) is a pure module with tests. Drag-and-drop gets a manual check in desktop Chrome.

## Open risks
- MusicBrainz matching misses some records, especially compilations and non-Latin titles. Claude fills those gaps.
- Claude's genre tags for obscure records may be wrong. You can edit them, and manual edits stick.
