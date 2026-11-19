import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for Supabase tables
export interface UserPuzzlesRow {
  id: string;
  user_id: string;
  puzzle_id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string[];
  popularity: number;
  ease_factor: number;
  interval_days: number;
  repetition: number;
  due_date: string;
  last_reviewed: string | null;
  last_result: string | null;
  is_wrong_puzzle: boolean;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  rating: number;
  rating_min: number;
  rating_max: number;
  themes_filter: string[];
  new_puzzles_per_day: number;
  streak: number;
  max_streak: number;
  total_solved: number;
  total_failed: number;
  created_at: string;
  updated_at: string;
}

// Helper functions for Supabase operations
export async function getUserPuzzles(userId: string) {
  const { data, error } = await supabase
    .from('user_puzzles')
    .select('*')
    .eq('user_id', userId)
    .is('removed_at', null);
  
  if (error) throw error;
  return data as UserPuzzlesRow[];
}

export async function getUserSettings(userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data as UserSettingsRow | null;
}

export async function upsertUserPuzzle(puzzle: Omit<UserPuzzlesRow, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('user_puzzles')
    .upsert(puzzle, { onConflict: 'user_id,puzzle_id' })
    .select()
    .single();
  
  if (error) throw error;
  return data as UserPuzzlesRow;
}

export async function updateUserPuzzle(id: string, updates: Partial<UserPuzzlesRow>) {
  const { data, error } = await supabase
    .from('user_puzzles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  return data as UserPuzzlesRow;
}

export async function removeUserPuzzle(id: string) {
  const { error } = await supabase
    .from('user_puzzles')
    .update({ removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  
  if (error) throw error;
}

export async function upsertUserSettings(settings: Omit<UserSettingsRow, 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('user_settings')
    .upsert(settings, { onConflict: 'user_id' })
    .select()
    .single();
  
  if (error) throw error;
  return data as UserSettingsRow;
}