# Crate Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **How this plan differs from earlier ones:** to run in parallel with Plan 4, it gives exact interfaces, behaviours and test cases for each task, but leaves most code to the implementer. That's a deliberate trade-off. The spec and the tests below are the contract. Implementers follow TDD: write the listed tests first, run them red, then implement.

**Goal:** Build a local crate editor (`npm run editor`, http://127.0.0.1:5174). It lets you search the RYM library by genre, rating, decade and text, drag records into crates, match them on Spotify, review flagged matches, edit genres, and publish (git commit + push).

**Architecture:**
- **UI:** a Vite + Preact app in `editor/`.
- **API:** Vite dev-server middleware in `editor/vite.config.ts`.
- **API logic:** pure handler functions in `editor/server/*.ts` over injected dependencies (filesystem, Spotify API, git runner, clock), so they can be tested without a server. They reuse `builder/src/*` and `shared/crate.ts`.
- **Genres** come from MusicBrainz (`library/genres-mb.json`, Task E1). Claude merges them into `library/genres.json` against `library/genre-vocabulary.json` (Task E6).

**Spec:** `docs/superpowers/specs/2026-10-03-crate-editor-design.md`
**Worktree:** `/Users/eric/git/stacker-editor`, branch `feat/crate-editor`. Never edit `/Users/eric/git/stacker`; Plan 4 runs there.
**Tech:** Node 20.19, TypeScript 5.9, Vite 8, Preact 10, Vitest 4, tsx. All are already installed.

---

## File structure

```
builder/src/musicbrainz.ts, genres-mb.ts         # E1 (done separately)
builder/src/genres.ts                             # E2 genre store: types, load/merge/validate
builder/test/genres.test.ts
library/genre-vocabulary.json                     # E6 (Claude)
library/genres.json                               # E6 (Claude) + manual edits from the editor
editor/
├── index.html
├── vite.config.ts                                # root: editor; port 5174; API middleware
├── server/
│   ├── deps.ts                                   # EditorDeps interface + real implementations (fs, Spotify, git, clock)
│   ├── library-api.ts  (+ .test.ts)              # library + genres endpoints
│   ├── crates-api.ts   (+ .test.ts)              # crate CRUD, resolve, overrides
│   ├── publish-api.ts  (+ .test.ts)              # git preview/commit/push
│   └── router.ts       (+ .test.ts)              # method/path → handler, JSON IO, Origin check
└── src/
    ├── main.tsx
    ├── api.ts                                    # typed fetch wrappers
    ├── filter.ts       (+ .test.ts)              # pure search/filter logic
    ├── App.tsx                                   # layout + state
    ├── LibraryPanel.tsx, CratePanel.tsx, ReviewPanel.tsx, GenreEditor.tsx, PublishDialog.tsx
    └── styles.css
```

`package.json` gets the script `"editor": "vite --config editor/vite.config.ts"`. `tsconfig.json` and `vitest.config.ts` add `editor` to `include` and to the test globs (`editor/**/*.test.ts`).

---

### Task E2: Genre store

**Files:** `builder/src/genres.ts`, `builder/test/genres.test.ts`

**Interface:**
```ts
export interface GenreVocabulary { parents: Array<{ name: string; genres: string[] }> }
export interface GenreTag { genres: string[]; parents: string[]; source: 'auto' | 'manual' }
export type GenreMap = Record<string, GenreTag>;           // rymId → tag
export function validateTag(tag: GenreTag, vocab: GenreVocabulary): string[];      // returns problems ([] = ok)
export function mergeGenres(existing: GenreMap, incoming: GenreMap): GenreMap;    // manual entries in existing always win
export function setManual(map: GenreMap, rymId: string, genres: string[], vocab: GenreVocabulary): GenreMap; // parents derived from vocab
export function parentsFor(genres: string[], vocab: GenreVocabulary): string[];
```

**Tests:**
- `validateTag` flags:
  - an unknown genre;
  - an unknown parent;
  - 0 genres;
  - more than 3 genres;
  - a parent that doesn't contain any of the record's genres.
- `mergeGenres`:
  - incoming `auto` replaces existing `auto`;
  - existing `manual` survives incoming `auto`;
  - new keys are added.
- `setManual` sets `source: 'manual'`, derives the parents in vocabulary order, deduplicates, and rejects unknown genres by throwing.
- `parentsFor` returns each parent once, in vocabulary order.

---

### Task E3: Editor server — dependencies, library API, crate API

**Files:** `editor/server/deps.ts`, `library-api.ts`, `crates-api.ts`, and their tests.

**`EditorDeps`:**
```ts
export interface EditorDeps {
  readText(path: string): string | null;            // null if missing
  writeText(path: string, text: string): void;
  removeFile(path: string): void;
  spotify(): SpotifyApi;                            // builder/src/spotify.ts; real impl reads .env + SPOTIFY_MARKET
  git(args: string[]): { code: number; stdout: string; stderr: string };
  now(): number;
}
```
Paths are relative to the repo root. The real implementation resolves them against `process.cwd()`, which must be the repo root.

**Library API (`library-api.ts`):**
- `getLibrary(deps)` → `{ entries: Array<LibraryEntry & { genres: string[]; parents: string[]; genreSource: 'auto'|'manual'|null }> }`.
  - Reads `library/library.json` and `library/genres.json`.
  - A missing genres file is treated as `{}`.
- `getVocabulary(deps)` → the vocabulary from `library/genre-vocabulary.json`, or `{ parents: [] }` if it's missing.
- `putGenres(deps, rymId, genres)`:
  - validates the rymId exists;
  - calls `setManual`;
  - writes `library/genres.json` with stable key order (sorted).

**Crate API (`crates-api.ts`):**
- **Ids:** `slugify(name)` produces lowercase-with-dashes, ASCII-folded (é→e), with no leading or trailing dashes. Collisions get a suffix: `-2`, `-3`, …
- `listCrates(deps)` → every `crates/*.json` except `index.json`, ordered by `index.json` first, with unlisted crates last.
- `createCrate(deps, { name, mood })`:
  - writes `{ id, name, mood, createdAt: today (YYYY-MM-DD from deps.now), records: [] }`;
  - appends the id to the index;
  - returns `{ id }`.
- `saveCrate(deps, id, { name?, mood?, rymIds })`:
  - Rebuilds `records` in the given order.
  - Existing records (by rymId) keep their `spotify` and `match` data.
  - New rymIds become hydrated records from the library with `spotify: null` and no `match`.
  - Unknown rymIds → error 400. Duplicate rymIds are de-duplicated.
- `renameCrate(deps, id, { name?, mood? })` changes the name and mood only. The id stays stable, so the file isn't renamed.
- `deleteCrate(deps, id)` removes the file and its index entry.
- `resolveCrateById(deps, id)`:
  - loads the crate, library and overrides;
  - calls `resolveCrate(draft, …, deps.spotify())`;
  - writes the crate;
  - returns `{ crate, review }`.
  - **Partial failure:** if `resolveCrate` throws `ResolveAborted`, write `err.partial` and return `{ crate: err.partial, review: [], error: err.message }` with status 502.
- `setOverride(deps, rymId, value)`:
  - `value` is a Spotify link, URI or id (normalised with `parseAlbumId` from `builder/src/resolve.ts`), or `'unavailable'`, or `null` (remove the override);
  - writes `library/overrides.json` with sorted keys.
- `resolveOne(deps, crateId, rymId)` re-matches a single record: it runs `resolveCrate` with only that record's settled state cleared and returns the updated record. Use it after an override changes.

**Tests:** use an in-memory fake `EditorDeps` (a `Map` filesystem) and the `FakeApi` pattern from `builder/test/resolve.test.ts`.
- `getLibrary`:
  - merges genres;
  - a missing genres file gives empty genre fields;
  - `genreSource` is reflected.
- `putGenres` writes `manual`, and rejects an unknown rymId or genre.
- `slugify("Samba & Bossa")` gives `samba-bossa`, `"Ça plane"` gives `ca-plane`, and a collision gives `-2`.
- `createCrate` writes the file and the index.
- `saveCrate`:
  - keeps the Spotify data of an existing record;
  - hydrates new records;
  - keeps the given order;
  - rejects an unknown rymId;
  - de-duplicates.
- `renameCrate` keeps the id.
- `deleteCrate` removes the file and the index entry.
- `resolveCrateById` writes the resolved crate and returns the review list.
- **Abort path:** `ResolveAborted` writes the partial crate and returns the error.
- `setOverride` normalises an `open.spotify.com/album/<id>?si=…` link, `null` deletes the override, and keys are sorted.

---

### Task E4: Publish API, router and Vite wiring

**Files:** `editor/server/publish-api.ts`, `router.ts` and their tests; `editor/vite.config.ts`, `editor/index.html`, a placeholder `editor/src/main.tsx`; plus the `package.json`, `tsconfig.json` and `vitest.config.ts` updates.

**Publish (`publish-api.ts`).** It only ever touches these paths: `PUBLISH_PATHS = ['crates', 'library/overrides.json', 'library/genres.json']`.

- `previewPublish(deps)` → `{ changes: Array<{ status, path }>, blockers: string[], hasRemote: boolean, suggestedMessage: string }`.
  - **changes:** `git status --porcelain -- <PUBLISH_PATHS>`.
  - **Blockers:**
    - any crate file in the changes with records that need review (match not high and not override, or `spotify: null` without an 'unavailable' override) → "Rainy Sunday: 2 records still need review";
    - other uncommitted changes outside `PUBLISH_PATHS` (from `git status --porcelain`) → "Uncommitted changes outside crates — commit or stash them first";
    - no changes → "Nothing to publish".
  - **hasRemote:** `git remote` is non-empty.
  - **suggestedMessage:** for example, `Update crates: Samba & Bossa (new), Rainy Sunday`.
- `publish(deps, message)`:
  - Re-checks the blockers; if there are any → 409.
  - Runs `git add -- <PUBLISH_PATHS>`, then `git commit -m <message>` with a `Co-Authored-By` trailer **not** added. These are Eric's commits.
  - If there's a remote, runs `git push`.
  - Returns `{ committed: sha, pushed: boolean, output }`.
  - A failed `git` call returns status 500 with its stderr.
- **Tests:** a fake `git` that records its calls and returns scripted output.
  - each blocker;
  - commit without a remote (`pushed: false`, no push call);
  - commit and push with a remote;
  - a blocked publish returns 409 and makes no git calls;
  - `git add` is restricted to `PUBLISH_PATHS`.

**Router (`router.ts`).** `handle(deps, req: { method, url, headers, body }) → { status, json }`.
- It maps the API table from the spec to the handlers.
- It rejects a request with 403 when the `Origin` header is present and is not `http://127.0.0.1:5174`.
- It parses JSON bodies and returns 400 on invalid JSON.
- Unknown routes return 404.
- Tests cover route mapping for each endpoint (with handler spies or a fake deps), the origin check, and 400/404.

**Vite wiring (`editor/vite.config.ts`):**
- `root: 'editor'`, Preact plugin, `server: { host: '127.0.0.1', port: 5174, strictPort: true }`.
- A plugin with `configureServer(server)` mounts middleware on `/api/`. The middleware reads the body, calls `handle(realDeps, …)` and writes JSON.
- `realDeps` loads `.env` with `process.loadEnvFile` when it exists.
- **No production build:** the editor is dev-only.
- Verify: `npm run editor`, then `curl http://127.0.0.1:5174/api/crates` returns JSON listing `rainy-sunday`.

---

### Task E5: Editor UI

**Files:** `editor/src/*`

**`filter.ts` (pure, tested):**
```ts
export interface Filters { text: string; parents: string[]; genres: string[]; minRating: number; decades: number[]; hideInCrate: boolean }
export function filterLibrary(entries: LibraryRow[], f: Filters, crateRymIds: Set<string>): LibraryRow[];
export function genreCounts(entries: LibraryRow[], f: Filters): Map<string, number>;   // counts under current non-genre filters
```
**Filter rules:**
- **text:** case- and accent-insensitive match against artist, `artistLocalized` and title. Reuse `normText` from `builder/src/normalize.ts`.
- **genres:** OR within parents; OR within genres. If both parents and genres are selected, a record must match at least one selected parent AND at least one selected genre.
- **minRating:** on the 0–10 scale; 0 means no filter.
- **decades:** e.g. 1970 matches 1970–1979; an empty list means all.
- **hideInCrate:** hides records already in the crate.
- **Sort:** rating desc, then artist, then year.

**Tests:**
- each rule on its own;
- the combined AND/OR behaviour;
- an accent-insensitive search ("joao" finds João Gilberto);
- counts respect the text and rating filters but ignore the genre selection.

**Components** (manual verification only; keep them small):
- **LibraryPanel:**
  - Controls: text input, parent chips, then genre chips for the selected parents (with counts), a rating select (0.5–5★), decade toggles and a hide-in-crate checkbox.
  - Results list: virtualised or capped at 300 visible, with a "showing N of M" line.
  - Each row is `draggable` (`dataTransfer.setData('text/x-rym-id', rymId)`) and has a "+" button.
  - Rows show stars only when the rating is > 0, and their genre chips.
- **CratePanel:**
  - A crate `<select>`, plus New, Rename and Delete (Delete asks for confirmation).
  - Name and mood fields.
  - A drop zone covering the record list, with a highlight on dragover.
  - Each record row: artist — title (year), a match badge and a remove ×.
  - Changes save through `PUT /api/crates/:id`, debounced 400 ms, with an inline "Saved" or error indicator.
  - **Match on Spotify** shows "Matching… (this can take a minute)" while running, then opens ReviewPanel.
- **ReviewPanel:**
  - Each review item shows the RYM line, the proposed Spotify album (linked to `https://open.spotify.com/album/<id>`), and the confidence.
  - Actions:
    - **Accept** sets the override to the proposed id.
    - **Paste link** shows an input, then sets the override to the pasted link.
    - **Unavailable** sets the override to `'unavailable'`.
  - After each action the panel calls `resolveOne` and updates the row.
- **GenreEditor:** a popover opened from a record's genre chips. Choosing up to 3 genres from the vocabulary (grouped by parent) and saving calls `PUT /api/genres/:rymId` and marks the chips "edited".
- **PublishDialog:**
  - Shows the changes list, the blockers (in red; Publish is disabled while there are any) and an editable message.
  - On success it shows the sha and whether the commit was pushed. If there's no remote, it says "committed locally — no GitHub remote yet".
- **Styling:** a plain, dense desktop layout. Two columns (library 60%, crate 40%) with a system font. No design system needed.

**Manual check (with Eric):** follow the checklist in Task E7.

---

### Task E6: Genre vocabulary and tagging (Claude)

**Files:** `library/genre-vocabulary.json`, `library/genres.json`, and a helper CLI `builder/cli/genres-batch.ts`.

**Prerequisite:** `library/genres-mb.json` must be complete (E1's background run).

**Steps:**
1. **The helper CLI** prints one batch of records for tagging.
   - Each line is `rymId|artist|title|year|rating|mbGenres|mbTags(top 8 by count)`.
   - Usage: `npm run genres:batch -- --offset N --limit 400`.
   - It also prints the MusicBrainz genre/tag frequency table, via `--stats`.
2. **The vocabulary** is written by a Claude agent from `--stats` plus its knowledge of the library.
   - About 15 parents, each with 5–25 RYM-style genres.
   - Every genre that appears in at least 10 MusicBrainz records maps to a vocabulary entry, or is deliberately folded into one.
   - It must include Brazilian → Bossa Nova, Samba, MPB, Tropicália, Samba-Jazz, Samba Soul.
3. **Tagging** runs in batches of about 400 records, one Claude agent per batch. Each agent:
   - gives every record 1–3 vocabulary genres, plus parents derived with `parentsFor`;
   - uses MusicBrainz tags as evidence and its own knowledge for the rest;
   - writes the batch as JSON to `library/genres.batch-<offset>.json`;
   - validates every tag with `validateTag`.
4. **Merge:** a final step merges all batches with `mergeGenres` (manual edits win) into `library/genres.json`. It deletes the batch files and checks coverage: every library rymId has a tag, and every tag passes `validateTag`.
5. **Spot-check:** the coordinator checks 20 random records and the Rainy Sunday and samba/bossa records.

---

### Task E7: Real use with Eric
1. Run `npm run editor`.
2. Open http://127.0.0.1:5174.
3. Filter Brazilian → Bossa Nova + Samba with a minimum of 3.5★.
4. Create "Samba & Bossa" and drag in about 20 records.
5. Click **Match on Spotify** and review the flagged records.
6. Fix one record's genre.
7. Click **Publish**. This is a local commit only, until Plan 4 adds the remote.
8. Confirm the TV web app's crate list shows the new crate after `npm run build`.
