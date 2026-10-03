# Stacker

Album-shuffle jukebox for Eric's Google TV. Design: `docs/superpowers/specs/2026-10-02-stacker-design.md`.

## Building a crate (the main recurring task)

Crates are curated by Claude in conversation with Eric, from his Rate Your Music library.

1. **Refresh the library if Eric re-exported from RYM:** copy the CSV to `library/rym-export.csv`, then run `npm run import-rym -- library/rym-export.csv`.
2. **Get the mood** from Eric: vibe, size (default ~20 records), any rating floor or decade limits.
3. **Pick records** from `npm run library -- --min <N>`. The output is `rymId|artist|title|year|rating`, with ratings out of 10.
   - Use your own knowledge of the albums for mood and genre; the export has no genre data.
   - Only use `rymId`s from that output.
   - Avoid more than 2 records by one artist unless asked.
4. **Write the draft** to `crates/<id>.json` (`id` is lowercase-with-dashes):
   ```json
   { "id": "rainy-sunday", "name": "Rainy Sunday", "mood": "hushed, mostly acoustic, for a grey afternoon",
     "createdAt": "YYYY-MM-DD", "records": [{ "rymId": "…" }] }
   ```
5. **Resolve:** `npm run resolve -- crates/<id>.json`. This needs `.env` with Spotify credentials.
6. **Review** every `[medium]`, `[low]` and `[none]` line with Eric. Fix them in `library/overrides.json`:
   - `"<rymId>": "<spotifyAlbumId>"` for a wrong match. The value may be a bare album id, a `spotify:album:<id>` URI, or an `https://open.spotify.com/album/<id>` link (the Spotify share link works as is).
   - `"<rymId>": "unavailable"` when the record isn't on Spotify.
   - A resolved match you accept can be pinned by putting its own album id in overrides — it then leaves the review list.

   Then re-run resolve. Records that are already resolved and high-confidence are kept; `--force` re-resolves everything.
7. **Commit** the crate, `crates/index.json` and any override changes.

## Commands

- `npm test`: Vitest
- `npm run typecheck`
- `npm run library -- --min 8`: list records rated 4★+ (ratings are 0–10)
- `npm run resolve -- crates/<id>.json [--force]`

## Conventions

- Pure logic lives in `builder/src/*` with tests in `builder/test/*`. Only `builder/cli/*` and `builder/src/files.ts` touch the filesystem.
- Crate types are in `shared/crate.ts`; the TV web app will import them.
- Never commit `.env`.
