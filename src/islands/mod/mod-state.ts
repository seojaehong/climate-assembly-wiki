import type { Round, Team } from '../../lib/mod-console';

export type ModScreen = 'join' | 'home' | 'polling' | 'results';

export interface ModState {
  screen: ModScreen;
  team: Team | null;
  round: Round | null;
  joinError: string | null;
}

export type ModAction =
  | { type: 'JOIN_SUCCESS'; team: Team }
  | { type: 'JOIN_FAILURE'; message: string }
  | { type: 'RESTORE_TEAM'; team: Team; round: Round | null }
  | { type: 'CREATE_POLL_SUCCESS'; round: Round }
  | { type: 'CLOSE_POLL'; round: Round }
  | { type: 'NEW_POLL' }
  | { type: 'LOGOUT' };

export const initialModState: ModState = {
  screen: 'join',
  team: null,
  round: null,
  joinError: null,
};

export function modReducer(state: ModState, action: ModAction): ModState {
  switch (action.type) {
    case 'JOIN_SUCCESS':
      return { ...state, screen: 'home', team: action.team, joinError: null };
    case 'JOIN_FAILURE':
      return { ...state, joinError: action.message };
    case 'RESTORE_TEAM':
      // 새로고침 후 sessionStorage 코드로 조용히 재입장 — 진행 중인 라운드가 있으면
      // polling 화면으로 복원해 QR/실시간 집계를 재구독하고, 없으면 home으로 보낸다.
      return {
        ...state,
        screen: action.round ? 'polling' : 'home',
        team: action.team,
        round: action.round,
        joinError: null,
      };
    case 'CREATE_POLL_SUCCESS':
      return { ...state, screen: 'polling', round: action.round };
    case 'CLOSE_POLL':
      return { ...state, screen: 'results', round: action.round };
    case 'NEW_POLL':
      return { ...state, screen: 'home', round: null };
    case 'LOGOUT':
      return { ...initialModState };
    default:
      return state;
  }
}
