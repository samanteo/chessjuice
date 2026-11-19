# Lichess-Style Puzzle Trainer with SM-2

A chess puzzle trainer inspired by Lichess, featuring spaced repetition (SM-2) for wrong puzzles only, rating system, theme filters, and queue management.

## Features

- **SM-2 Spaced Repetition**: Only wrong/failed puzzles enter the SM-2 review queue
- **Rating System**: Start at 1000, +10 for correct, -10 for wrong
- **Lichess Themes**: All 60+ Lichess puzzle themes as filters
- **Wrong Puzzles Pseudo-Theme**: Auto-collects failed puzzles into SM-2 queue
- **Queue Views**: Due / New / Learning / Mastered / Archived tabs
- **Puzzle Player**: Interactive board with move validation, hints, solutions
- **Local-First**: Works offline with localStorage, Supabase optional
- **CSV Import**: Filter Lichess puzzle database (rating 1000-2200)

## SM-2 Algorithm (Wrong Puzzles Only)

| Stage | Interval | Condition |
|-------|----------|-----------|
| New failure | 10 min | First wrong attempt |
| Learning 1 | 1 day | Correct after 10 min |
| Learning 2 | 3 days | Correct after 1 day |
| Review 1 | 7 days | Correct after 3 days |
| Review 2 | 14 days | Correct after 7 days |
| Review 3 | 30 days | Correct after 14 days |
| Review 4 | 90 days | Correct after 30 days |
| Archived | - | Interval ≥ 90 days |
| **Fail at any stage** | **Reset to 1 day** | Any wrong answer |

**Ease Factor**: Starts at 2.5, Easy +0.15, Hard -0.15, Again → reset to 2.5

**Wrong puzzles are NEVER auto-deleted** - only manual removal via "Archive" button.

## Quick Start

```bash
cd puzzle-trainer
npm install
npm run dev
```

Open http://localhost:3000

## Importing Puzzles

1. Download `lichess_db_puzzle.csv` from [Lichess database](https://database.lichess.org/)
2. Click "📥 Import" in the app
3. Select the CSV file
4. Only puzzles rated 1000-2200 will be imported

Or use the CLI script:
```bash
python3 scripts/import_puzzles.py --input lichess_db_puzzle.csv --output filtered_puzzles.csv
```

For Supabase:
```bash
python3 scripts/import_puzzles.py --input lichess_db_puzzle.csv --supabase --user-id <uuid> --sql-output inserts.sql
```

## Supabase Setup (Optional)

1. Create a Supabase project
2. Run the schema from `supabase/schema.sql` in SQL editor
3. Copy `.env.example` to `.env.local` and add your credentials
4. The app will auto-detect Supabase and offer cloud sync

## Project Structure

```
puzzle-trainer/
├── src/
│   ├── app/                 # Next.js App Router pages
│   │   ├── page.tsx         # Main puzzle trainer page
│   │   ├── layout.tsx       # Root layout
│   │   └── globals.css      # Global styles
│   ├── components/
│   │   ├── PuzzlePlayer.tsx # Interactive puzzle board
│   │   ├── QueueViews.tsx   # Due/New/Learning/Mastered tabs
│   │   └── ThemeFilter.tsx  # Theme filter UI (60+ themes)
│   ├── hooks/
│   │   └── usePuzzleStore.ts # LocalStorage/Supabase state management
│   ├── lib/
│   │   ├── sm2.ts           # SM-2 algorithm implementation
│   │   └── supabase.ts      # Supabase client & helpers
│   └── types/
│       └── index.ts         # TypeScript definitions
├── supabase/
│   └── schema.sql           # Database schema
├── scripts/
│   └── import_puzzles.py    # CSV import & filtering script
└── package.json
```

## Key Components

### PuzzlePlayer
- Uses `react-chessboard` + `chess.js`
- Move validation with visual feedback
- Hint system (shows first move piece, costs 5 rating points)
- Solution viewer
- Streak tracking

### QueueViews
- 5 tabs: Due, New, Learning, Mastered, Archived
- Sorting by due date, rating, repetition, added date
- Rating range filter
- Theme filter integration
- Puzzle cards with SM-2 metadata (interval, EF, repetition)

### ThemeFilter
- All 60 Lichess themes organized by category
- Search functionality
- "Wrong Puzzles" pseudo-theme toggle
- Selected themes as removable chips
- Theme counts from puzzle database

### usePuzzleStore
- LocalStorage persistence
- SM-2 state management
- Rating/streak updates
- Queue classification
- Supabase sync readiness

## Development

```bash
# Type checking
npx tsc --noEmit

# Linting
npm run lint

# Build
npm run build
```

## License

MIT