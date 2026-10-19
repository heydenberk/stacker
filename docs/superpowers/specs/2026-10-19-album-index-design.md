# All albums: an A–Z index on the TV

Approved with Eric on 2026-10-19.

## Goal

From the crate picker, Eric can open a list of every album in every crate, sorted A–Z by artist,
and start one. The album plays now and its crate carries on after it.

## Getting there

- A slim **"▼ All albums A–Z"** row sits under the crate cards on the picker.
- ▼ from a card focuses that row. OK opens the **All albums** screen.
- Back returns to the picker.

## The list

- **Rows:** one per playable record (`spotify !== null`) per crate. A record in two crates gets two rows (today only Destroyer's *Streethawk*), each with its own crate.
- **Row content:** cover, artist, *title · year*, and the crate name.
- **Sort order:**
  - By artist, ignoring a leading "The " or "A ", so A Tribe Called Quest sorts under T.
  - Compared with `localeCompare` at base sensitivity, so Antônio sorts with A and ignores case.
  - Ties go by title, then crate name.
- **Letters:**
  - An album's letter is the first letter of its sort key with accents removed.
  - Anything that isn't A–Z goes under **#**, after Z.
- **Layout:**
  - Two columns, filled left to right and then down.
  - A heading for each letter spans both columns.
  - About 14 rows fit on screen. The list scrolls to keep focus in view.
- **Covers:** use the existing `Cover` component with lazy loading, since there are about 280.
- **Starting focus:** the first album.

## Letter rail

- A–Z plus **#** run down the left edge.
- ◀ from the left column moves onto the rail. The rail focuses the letter of the album you came from.
- On the rail:
  - ▲▼ moves between letters and skips letters with no albums, which are shown dimmed.
  - Each move scrolls the list so that letter's heading is at the top.
  - ▶ or OK focuses that letter's first album.
- ▲ from the top of the list stays put, as in the other screens. Back leaves the screen.

## Picking an album

There's a new conductor event, `{ type: 'chooseRecord'; crateId; rymId }`. If the crate or record is unknown or unplayable, it's ignored. Otherwise:

| Situation | Result |
|---|---|
| The record is the one now playing or starting | No change. The screen opens Now Playing. |
| The record is current but paused, yielded, held, awaiting resume or restored | Same as `resume` |
| Ordered crate | `order` = the crate's playable ids, `pos` = the record's index, then start. If the crate wasn't in progress, its problems are cleared. |
| Shuffled crate, not in progress (another crate, or idle) | A fresh lap with the record moved to the front, `pos` 0. The crate's problems are cleared, as with `chooseCrate`. |
| Shuffled crate, in progress | The current record counts as heard. The picked record is removed from where it was and inserted right after the current one, then `pos` moves to it. Problems are kept. |

- "In progress" means `state.crateId === crateId && state.mode !== 'idle'`, the same test the picker uses.
- Every start uses origin `'user'`, from track 0 at 0 ms.
- After dispatching, the screen goes to Now Playing.
- The order changes are pure helpers in `conductor/shuffle.ts`, next to `newLap` and `reconcileOrder`.

## Pieces

| File | Change |
|---|---|
| `conductor/types.ts` | Add the `chooseRecord` event |
| `conductor/shuffle.ts` | `playNext(order, pos, rymId)` and `withFirst(lap, rymId)` |
| `conductor/step.ts` | Handle `chooseRecord` |
| `tv/albums.ts` | `albumIndex(catalog)` builds and sorts the rows. `sortKey` and `letterOf` work out the sorting and letters. All pure. |
| `tv/AlbumIndex.tsx` | The screen: rail, list and focus handling |
| `tv/nav.ts` | Add `'albums'` to `Screen`; Back from it goes to the picker |
| `tv/TvApp.tsx` | Route to the screen |
| `tv/CratePicker.tsx` | The hint row and an `onAlbums` prop |
| `tv/tv.css` | Styles for the hint row, rail and rows |

## Testing

- `step.test.ts`: every row of the table above, plus unknown and unplayable records.
- `shuffle.test.ts`: `playNext` when the album is ahead of the current record, already played, or the current record itself; `withFirst`.
- `albums.test.ts`: the sort, letters, the # bucket, one row per crate, and unplayable records left out.
- `nav.test.ts`: Back from albums.
- By hand in `npm run dev` at 127.0.0.1:5173 on the 1920×1080 stage:
  - D-pad moves around the rows.
  - The rail jumps letters.
  - Picking an album plays it.
  - Back returns to the picker.

## Out of scope

- Search or typing letters.
- Filtering by crate.
- Phone or laptop control. That's the separate Wi-Fi remote idea.
- Showing which albums have been played.
