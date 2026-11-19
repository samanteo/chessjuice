/**
 * Lichess OAuth Service
 * Handles OAuth flow, token storage, and API calls
 */

import { supabase } from '@/lib/supabase';
import type { 
  LichessTokenResponse, 
  LichessUser, 
  LichessGame,
  UserSettingsRowExtended 
} from '@/types/own-games';

// Lichess OAuth configuration
const LICHESS_CLIENT_ID = process.env.NEXT_PUBLIC_LICHESS_CLIENT_ID || 'puzzle-trainer';
const LICHESS_REDIRECT_URI = typeof window !== 'undefined' 
  ? `${window.location.origin}/api/auth/lichess/callback`
  : '';
const LICHESS_AUTH_URL = 'https://lichess.org/oauth';
const LICHESS_API_URL = 'https://lichess.org/api';

const TOKEN_STORAGE_KEY = 'lichess_tokens';
const USER_STORAGE_KEY = 'lichess_user';

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;  // Unix timestamp
  scope: string;
}

/**
 * Generate Lichess OAuth authorization URL
 */
export function getLichessAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LICHESS_CLIENT_ID,
    redirect_uri: LICHESS_REDIRECT_URI,
    scope: 'preference:read preference:write challenge:read challenge:write play:read play:write',
  });
  
  if (state) {
    params.append('state', state);
  }
  
  return `${LICHESS_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<StoredTokens> {
  const response = await fetch(`${LICHESS_AUTH_URL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: LICHESS_CLIENT_ID,
      redirect_uri: LICHESS_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data: LichessTokenResponse = await response.json();
  
  const tokens: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };

  // Store tokens
  storeTokens(tokens);
  
  return tokens;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
  const response = await fetch(`${LICHESS_AUTH_URL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: LICHESS_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data: LichessTokenResponse = await response.json();
  
  const tokens: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };

  storeTokens(tokens);
  return tokens;
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens) return null;

  // Check if token is expired (with 60s buffer)
  if (Date.now() >= tokens.expires_at - 60000) {
    try {
      const newTokens = await refreshAccessToken(tokens.refresh_token);
      return newTokens.access_token;
    } catch (e) {
      console.error('Failed to refresh token:', e);
      clearTokens();
      return null;
    }
  }

  return tokens.access_token;
}

/**
 * Store tokens in localStorage
 */
export function storeTokens(tokens: StoredTokens): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  }
}

/**
 * Get stored tokens from localStorage
 */
export function getStoredTokens(): StoredTokens | null {
  if (typeof window === 'undefined') return null;
  
  const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored) as StoredTokens;
  } catch {
    return null;
  }
}

/**
 * Clear stored tokens
 */
export function clearTokens(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  }
}

/**
 * Store user info
 */
export function storeUser(user: LichessUser): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  }
}

/**
 * Get stored user
 */
export function getStoredUser(): LichessUser | null {
  if (typeof window === 'undefined') return null;
  
  const stored = localStorage.getItem(USER_STORAGE_KEY);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored) as LichessUser;
  } catch {
    return null;
  }
}

/**
 * Fetch authenticated user info
 */
export async function fetchLichessUser(accessToken: string): Promise<LichessUser> {
  const response = await fetch(`${LICHESS_API_URL}/account`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }

  return response.json();
}

/**
 * Fetch user's recent games
 * Returns last 100 games by default
 */
export async function fetchUserGames(
  accessToken: string, 
  username: string,
  max: number = 100
): Promise<LichessGame[]> {
  const response = await fetch(
    `${LICHESS_API_URL}/games/user/${username}?max=${max}&perfType=ultraBullet,bullet,blitz,rapid,classical&rated=true&analysed=false&tags=false&clocks=false&evals=false&opening=false`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/x-ndjson',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch games: ${response.statusText}`);
  }

  // Parse NDJSON (newline-delimited JSON)
  const text = await response.text();
  const lines = text.trim().split('\n').filter(Boolean);
  
  return lines.map(line => JSON.parse(line)) as LichessGame[];
}

/**
 * Fetch a single game with full details
 */
export async function fetchGame(accessToken: string, gameId: string): Promise<LichessGame> {
  const response = await fetch(`${LICHESS_API_URL}/game/${gameId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch game: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Save tokens to Supabase (for cross-device sync)
 */
export async function saveTokensToSupabase(userId: string, tokens: StoredTokens, username: string): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: userId,
      lichess_token: tokens.access_token,
      lichess_refresh_token: tokens.refresh_token,
      lichess_token_expires_at: new Date(tokens.expires_at).toISOString(),
      lichess_username: username,
    }, { onConflict: 'user_id' });

  if (error) throw error;
}

/**
 * Load tokens from Supabase
 */
export async function loadTokensFromSupabase(userId: string): Promise<StoredTokens | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('lichess_token, lichess_refresh_token, lichess_token_expires_at')
    .eq('user_id', userId)
    .single();

  if (error || !data?.lichess_token) return null;

  return {
    access_token: data.lichess_token,
    refresh_token: data.lichess_refresh_token,
    expires_at: new Date(data.lichess_token_expires_at).getTime(),
    scope: '',
  };
}

/**
 * Check if user is authenticated with Lichess
 */
export function isLichessAuthenticated(): boolean {
  return getStoredTokens() !== null;
}

/**
 * Get Lichess username if authenticated
 */
export function getLichessUsername(): string | null {
  const user = getStoredUser();
  return user?.username || null;
}

/**
 * Logout from Lichess
 */
export function logoutLichess(): void {
  clearTokens();
}