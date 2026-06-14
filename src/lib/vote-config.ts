// vote-config.ts — Supabase voting backend config for 2026-06-14 workshop
// NOTE: climate_vote schema must be added to Supabase "Exposed schemas" in
//       Dashboard > API Settings > Exposed schemas → add "climate_vote"

export const PUBLIC_VOTE_SUPABASE_URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
export const PUBLIC_VOTE_SUPABASE_KEY = 'sb_publishable_OVwo9zs5i6xl5iFykM6zJQ_GWFcf5zn';
export const ADMIN_PASSPHRASE = 'climate2026';

export const ROUND_IDS = [
  'R1', 'R2', 'R3', 'R4', 'R5', 'R6',
  'R7', 'R8', 'R9', 'R10', 'R11', 'R12',
  'R1-runoff', 'R5-runoff', 'R6-runoff',
  'EX1', 'EX2', 'EX3',
] as const;

export type RoundId = typeof ROUND_IDS[number];

export function voteHeaders(method: 'GET' | 'POST' | 'PATCH' = 'GET') {
  const h: Record<string, string> = {
    'apikey': PUBLIC_VOTE_SUPABASE_KEY,
    'Authorization': `Bearer ${PUBLIC_VOTE_SUPABASE_KEY}`,
  };
  if (method === 'GET') {
    h['Accept-Profile'] = 'climate_vote';
  } else {
    h['Content-Profile'] = 'climate_vote';
    h['Content-Type'] = 'application/json';
  }
  return h;
}

export function voteUrl(path: string, params?: Record<string, string>) {
  const u = new URL(`${PUBLIC_VOTE_SUPABASE_URL}/rest/v1/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }
  return u.toString();
}
