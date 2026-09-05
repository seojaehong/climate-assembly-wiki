import { getSupabase } from './supabase';

export const WORKSHOP_DEVICE_KEY = 'climate_vote_mod_device_id';
export const WORKSHOP_SESSION_KEY = 'climate_vote_mod_session_v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export type WorkshopTeam = {
  id: string;
  name: string;
  subgroup: string | null;
  capacity: number;
  table_no: string | null;
};

/** Opaque authorization returned after a one-time join-code exchange. */
export type WorkshopSession = {
  v: 1;
  accessToken: string;
  expiresAt: string;
  deviceId: string;
  deviceLabel: string;
  sessionId: string;
  sessionSlug: string;
  team: WorkshopTeam;
};

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isWorkshopSession(value: unknown): value is WorkshopSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Partial<WorkshopSession>;
  const team = row.team;
  return row.v === 1
    && typeof row.accessToken === 'string' && TOKEN_PATTERN.test(row.accessToken)
    && isNonEmptyString(row.expiresAt) && Number.isFinite(Date.parse(row.expiresAt))
    && typeof row.deviceId === 'string' && UUID_PATTERN.test(row.deviceId)
    && isNonEmptyString(row.deviceLabel)
    && typeof row.sessionId === 'string' && UUID_PATTERN.test(row.sessionId)
    && isNonEmptyString(row.sessionSlug)
    && typeof team === 'object' && team !== null
    && typeof team.id === 'string' && UUID_PATTERN.test(team.id)
    && isNonEmptyString(team.name)
    && (team.subgroup === null || typeof team.subgroup === 'string')
    && typeof team.capacity === 'number' && Number.isFinite(team.capacity)
    && (team.table_no === null || typeof team.table_no === 'string');
}

export function getOrCreateWorkshopDeviceId(
  storage: Storage,
  createUuid: () => string = () => crypto.randomUUID(),
): string {
  try {
    const existing = storage.getItem(WORKSHOP_DEVICE_KEY);
    if (existing && UUID_PATTERN.test(existing)) return existing;
    const created = createUuid();
    if (!UUID_PATTERN.test(created)) throw new Error('Device identifier generator returned an invalid UUID');
    storage.setItem(WORKSHOP_DEVICE_KEY, created);
    return created;
  } catch (error) {
    console.error('[workshop access] device storage failed', error);
    const created = createUuid();
    if (!UUID_PATTERN.test(created)) throw new Error('Device identifier generator returned an invalid UUID');
    return created;
  }
}

export function deviceLabel(userAgent: string): string {
  const platform = /iPad/i.test(userAgent)
    ? 'iPad'
    : /iPhone/i.test(userAgent)
      ? 'iPhone'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? 'Mac'
            : '기기';
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Chrome\//i.test(userAgent)
      ? 'Chrome'
      : /Firefox\//i.test(userAgent)
        ? 'Firefox'
        : /Safari/i.test(userAgent)
          ? 'Safari'
          : '브라우저';
  return `${platform} · ${browser}`;
}

export function storeWorkshopSession(storage: Storage, session: WorkshopSession): boolean {
  if (!isWorkshopSession(session)) return false;
  try {
    storage.setItem(WORKSHOP_SESSION_KEY, JSON.stringify(session));
    return true;
  } catch (error) {
    console.error('[workshop access] session storage failed', error);
    return false;
  }
}

export function clearWorkshopSession(storage: Storage): boolean {
  try {
    storage.removeItem(WORKSHOP_SESSION_KEY);
    return true;
  } catch (error) {
    console.error('[workshop access] failed to clear session', error);
    return false;
  }
}

export function readWorkshopSession(storage: Storage, nowMs: number = Date.now()): WorkshopSession | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WORKSHOP_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isWorkshopSession(parsed) || Date.parse(parsed.expiresAt) <= nowMs) {
      clearWorkshopSession(storage);
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('[workshop access] invalid stored session', error);
    clearWorkshopSession(storage);
    return null;
  }
}

function normalizeRpcSession(data: unknown): WorkshopSession {
  const row = Array.isArray(data) ? data[0] : data;
  if (!isWorkshopSession(row)) throw new Error('Workshop authorization response is invalid');
  return row;
}

export async function exchangeWorkshopCode(
  joinCode: string,
  deviceId: string,
  label: string,
): Promise<WorkshopSession> {
  const { data, error } = await client().schema('climate_vote').rpc('mod_exchange_join_code', {
    p_join_code: joinCode,
    p_device_id: deviceId,
    p_device_label: label,
  });
  if (error) throw error;
  return normalizeRpcSession(data);
}

export async function resumeWorkshopSession(token: string): Promise<WorkshopSession> {
  const { data, error } = await client().schema('climate_vote').rpc('mod_session_get', { p_token: token });
  if (error) throw error;
  return normalizeRpcSession(data);
}

/** Revokes the exact team bearer on the server before a device leaves its workshop. */
export async function revokeWorkshopSession(token: string): Promise<void> {
  const { data, error } = await client().schema('climate_vote').rpc('workshop_team_logout_v2', {
    p_token: token,
  });
  if (error) throw new Error(error.message ?? '서버에서 조 연결을 종료하지 못했습니다');
  if (data !== true) throw new Error('서버에서 조 연결을 종료하지 못했습니다');
}
