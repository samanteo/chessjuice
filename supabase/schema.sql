-- Supabase Schema for Lichess-style Puzzle Trainer
-- Tables: user_puzzles, user_settings

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User settings table
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1000,
    rating_min INTEGER NOT NULL DEFAULT 1000,
    rating_max INTEGER NOT NULL DEFAULT 2200,
    themes_filter TEXT[] NOT NULL DEFAULT '{}',  -- empty = all themes
    new_puzzles_per_day INTEGER NOT NULL DEFAULT 5,
    streak INTEGER NOT NULL DEFAULT 0,
    max_streak INTEGER NOT NULL DEFAULT 0,
    total_solved INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User puzzles table (SM-2 scheduling for wrong puzzles only)
CREATE TABLE IF NOT EXISTS user_puzzles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    puzzle_id TEXT NOT NULL,  -- Lichess PuzzleId
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,  -- UCI moves string (e.g., "e2e4 e7e5")
    rating INTEGER NOT NULL,
    themes TEXT[] NOT NULL DEFAULT '{}',
    popularity INTEGER NOT NULL DEFAULT 0,

    -- SM-2 fields (only used for wrong/failed puzzles)
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,  -- 0 = new/learning, >0 = scheduled days
    repetition INTEGER NOT NULL DEFAULT 0,  -- 0 = new, 1 = learning, 2+ = review
    due_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reviewed TIMESTAMPTZ,
    last_result TEXT,  -- 'again' | 'hard' | 'good' | 'easy'
    is_wrong_puzzle BOOLEAN NOT NULL DEFAULT FALSE,  -- only wrong puzzles enter SM-2 queue
    removed_at TIMESTAMPTZ,  -- manual removal only, wrong puzzles never auto-deleted

    -- Queue classification (computed from above)
    -- Due: due_date <= NOW() AND is_wrong_puzzle = TRUE
    -- New: is_wrong_puzzle = FALSE AND never attempted
    -- Learning: is_wrong_puzzle = TRUE AND repetition < 2
    -- Mastered: is_wrong_puzzle = TRUE AND repetition >= 2 AND due_date > NOW()

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, puzzle_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_puzzles_user_id ON user_puzzles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_puzzles_due_date ON user_puzzles(user_id, due_date) WHERE is_wrong_puzzle = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_puzzles_rating ON user_puzzles(user_id, rating);
CREATE INDEX IF NOT EXISTS idx_user_puzzles_themes ON user_puzzles USING GIN(themes);
CREATE INDEX IF NOT EXISTS idx_user_puzzles_is_wrong ON user_puzzles(user_id, is_wrong_puzzle);
CREATE INDEX IF NOT EXISTS idx_user_puzzles_removed ON user_puzzles(user_id, removed_at) WHERE removed_at IS NULL;

-- RLS Policies
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_puzzles ENABLE ROW LEVEL SECURITY;

-- Users can only access their own settings
CREATE POLICY "Users can view own settings" ON user_settings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON user_settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON user_settings
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can only access their own puzzles
CREATE POLICY "Users can view own puzzles" ON user_puzzles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own puzzles" ON user_puzzles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own puzzles" ON user_puzzles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own puzzles" ON user_puzzles
    FOR DELETE USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_puzzles_updated_at
    BEFORE UPDATE ON user_puzzles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();