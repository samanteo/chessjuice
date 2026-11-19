# user-state

Your synced progress lives here, as a single small JSON file.

## `state.json`

Written by `/api/state` (`src/app/api/state/route.ts`) and read by
`src/lib/stateSync.ts` in the browser. It holds the app's `puzzle_trainer_*`
localStorage keys — rating, SM-2 progress, attempts, settings, pinned themes —
so your phone and your desktop share one progress set instead of each browser
keeping a private copy.

It is **committed to this repo on purpose**: it is small (tens of KB) and it is
the one thing here that cannot be regenerated. That is what makes this repo a
real backup of your training history and not just of the code.

Shape — a map of key to `{ v: <raw localStorage string>, t: <epoch ms> }`:

```json
{
  "puzzle_trainer_glicko_v1": { "v": "{\"overall\":{\"r\":1761.2}}", "t": 1763... }
}
```

The `t` timestamp is what makes multi-device safe: `/api/state` applies a write
only if it is **newer** than what it already holds, so a device that is behind
can never overwrite newer progress from another device.

## Resetting

`curl -X DELETE http://localhost:3000/api/state`

That clears the server copy only — each browser keeps its own localStorage until
it next pulls. To fully start over, clear the site data in the browser too.

## Not to be confused with `../data/`

`data/puzzles.sqlite` (2.4 GB) is the Lichess puzzle catalogue. It is
deliberately **not** in this repo and must never go in a cloud-sync folder —
it is regenerable via `scripts/build-sqlite.mjs`, and syncing a live SQLite file
can corrupt it.
