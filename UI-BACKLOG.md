# MATE MEMORY — UI Polish Backlog

Ordered by bang-for-effort. Written so a subagent can execute each item independently.
Legend: **FILES** = files it should own · **DONE-WHEN** = acceptance check.

---

## A. Board realism

### A1. Wire the board textures (they exist but are dead code)
**FILES:** `src/app/globals.css`, `src/components/theme/themeConfig.ts`
- 6 textures ship in `public/textures/`: `wood.svg leather.svg marble.svg canvas.svg newspaper.svg map.svg`
- `themeConfig.getBoardThemeCSS()` builds `--cg-texture: url(/textures/wood.png)` — **BUG: files are `.svg`, config says `.png` → would 404.** Fix the extension.
- Apply under the existing `repeating-conic-gradient` checkerboard:
  ```css
  .cg-wrap.<theme> cg-board {
    background-image: var(--cg-texture), repeating-conic-gradient(...);
    background-size: 100% 100%, 25% 25%;
    background-blend-mode: multiply, normal;
  }
  ```
  Set `--cg-texture` per theme class (not on `:root`) so it travels with `.cg-wrap.<theme>`.
**DONE-WHEN:** Wood theme visibly has grain; switching to Marble/Leather changes the texture; no 404s in console.

### A2. Wooden board frame
**FILES:** `src/components/chessground/ChessgroundWrapper.tsx` (wrapper div), `globals.css`
- Wrap `cg-board` in a frame element with a bevelled gradient border (light top, dark bottom), `border-radius`, and an inset box-shadow.
- Frame colour should derive from the board theme (add `--cg-frame` per theme class).
- Frame thickness ~2.5–3.5% of board width, scales with board size.
**DONE-WHEN:** Board reads as a physical object with a wooden bezel; still square; board fully visible at 1280x800 and 1440x900.

### A3. Inner shadow / vignette
**FILES:** `globals.css`
- Add a soft inset shadow on `cg-board` (e.g. `box-shadow: inset 0 0 40px rgba(0,0,0,.18)`) so pieces sit *on* the board.
**DONE-WHEN:** Board has subtle depth; pieces don't look pasted on.

### A4. Engraved coordinates
**FILES:** `globals.css`
- Style the a–h/1–8 labels as inset/engraved text in the frame (subtle text-shadow, muted colour, theme-aware).
**DONE-WHEN:** Coordinates legible on every board theme, light and dark.

---

## B. Motion & audio

### B5. Sound effects
**FILES:** new `src/lib/sounds.ts`, `src/components/PuzzleBoard.tsx`
- Sounds: move, capture, check, **solved**, wrong.
- Use tiny inline WAV/MP3 in `public/sounds/` OR generate with the WebAudio API (no assets needed — oscillator blips). WebAudio is preferable: zero assets, no licensing.
- Respect a `sound` toggle in prefs (add to ThemeProvider prefs + Appearance tab).
**DONE-WHEN:** Audible feedback on move/solve/fail; toggle silences it.

### B6. "Solved" moment
**FILES:** `src/components/PuzzleBoard.tsx`, `globals.css`
- Green pulse on the board + a short confetti burst (canvas or a tiny CSS-particle component) on a correct solve.
**DONE-WHEN:** Solving produces a clearly celebratory 0.6–1s moment; wrong answer does not.

### B7. Rating counter roll-up
**FILES:** wherever rating is displayed (`page.tsx` Training header, Mistake panel)
- Animate +/- changes (count up/down ~400ms), `tabular-nums` so digits don't jitter.
**DONE-WHEN:** Rating visibly animates; no layout shift.

### B8. Drag "lift"
**FILES:** `globals.css`
- On `piece.dragging`: slight scale-up + stronger drop-shadow.
**DONE-WHEN:** Grabbing a piece feels tactile.

---

## C. Surface the analytics you already own

### C9. Rating sparkline
**FILES:** `src/app/page.tsx` (Training tab header), reuse `src/components/dashboard/RatingProgressChart.tsx`
- Currently exists but is unsurfaced. Place a compact sparkline in the Training header.
**DONE-WHEN:** Sparkline renders from attempt history; empty state handled.

### C10. Activity heatmap
**FILES:** `src/app/page.tsx` (Training tab), reuse `src/components/dashboard/CalendarHeatmap.tsx`
- GitHub-style contribution grid from attempt timestamps.
**DONE-WHEN:** Grid renders; days with activity shaded by volume.

### C11. Theme mastery bars
**FILES:** new `src/components/dashboard/ThemeMastery.tsx`, `src/app/page.tsx`
- Per-theme accuracy, sorted **worst-first** ("you fail Skewers 40%").
- Needs attempts tagged with themes (derive from the puzzle id → themes map).
**DONE-WHEN:** Bars reflect real attempt data; worst themes surface first.

---

## D. Layout & UX

### D12. Session layout
**FILES:** `src/app/page.tsx` (Mistakes tab)
- Board centre/left; compact right panel with rating, themes, streak, timer, attempted-move history.
**DONE-WHEN:** Board + panel fit one viewport at 1280x800; no scrolling to reach controls.

### D13. Keyboard shortcuts
**FILES:** `src/components/PuzzleBoard.tsx`
- `h` hint · `space`/`enter` next puzzle · `f` flip board. Show a small "?" shortcuts hint.
**DONE-WHEN:** Shortcuts work when the board is focused; don't fire while typing in inputs.

### D14. Board flip + auto-flip
**FILES:** `src/components/PuzzleBoard.tsx`, prefs
- Manual flip button; optional "flip to solver's side each puzzle" (already defaults to solver side).
**DONE-WHEN:** Flip button rotates the board; movable colour follows correctly.

### D15. Zen / focus mode
**FILES:** `src/app/page.tsx`
- Toggle that hides all chrome, leaving board + feedback only. Persist in prefs.
**DONE-WHEN:** One key/button toggles; board stays fully playable.

### D16. Skeleton loader
**FILES:** `src/app/page.tsx`
- Replace the bare spinner during the ~2–5s catalog parse with a board-shaped skeleton + progress text.
**DONE-WHEN:** No blank/spinner flash; clear "loading N puzzles" feedback.

---

## E. Detail polish

### E17. Replace emoji theme icons with SVG glyphs
**FILES:** `src/app/page.tsx` (`getThemeIcon` / `FLAT_THEME_CARDS` icons), new `public/icons/`
- Emoji (🍴📌🍢) render differently per OS and read as unfinished. Use a small set of consistent monochrome SVG icons (fork, pin, skewer, mate, endgame, opening, …).
**DONE-WHEN:** No emoji in the Training theme grid; icons inherit currentColor and look consistent.

### E18. Design tokens + tooltips
**FILES:** `globals.css`, shared components
- Radius/shadow/spacing tokens; replace native `title=` with a styled tooltip.
**DONE-WHEN:** Consistent corners/shadows across cards/buttons.

### E19. Real dark board theme
**FILES:** `themeConfig.ts`, `globals.css`
- All current board themes are light. Add dark board colours used when UI theme is dark.
**DONE-WHEN:** Dark mode board isn't blinding.

---

## F. Delight

### F20. Milestones & toasts
**FILES:** `src/app/page.tsx`, small toast component
- "7-day streak!", "12 solved today", achievement badges.
**DONE-WHEN:** Milestones fire once (not repeatedly) and are dismissible.

---

## Sequencing / ownership rules
- **One writer per file.** `globals.css`, `ChessgroundWrapper.tsx`, `PuzzleBoard.tsx` must not be edited by two agents at once.
- Suggested batches:
  1. **Board realism** (A1–A4) — `globals.css`, wrapper, themeConfig
  2. **Motion & audio** (B5–B8) — sounds lib, PuzzleBoard, `globals.css`
  3. **Analytics** (C9–C11) — dashboard components, `page.tsx`
  4. **UX** (D12–D16) — `page.tsx`, PuzzleBoard
  5. **Detail + delight** (E17–F20) — icons, tokens, toasts
- Every batch must end with `npm run build` passing and a real-browser check
  (headless Brave over CDP: `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/brave-X`, Node ≥22 global `WebSocket`).
