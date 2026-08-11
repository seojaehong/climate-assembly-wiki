import { useEffect, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { getSupabase } from '../../lib/supabase';
import {
  agendasToNodes, mergeRealtimeChange, linksToEdges, mergeLinkChange,
  parseAgendaRealtimePayload, parseLinkRealtimePayload, parseAgendaRows, parseAgendaLinks,
  type AgendaNode,
} from './agenda-sync';
import {
  canvasConnectionFailure,
  canvasMalformedRealtimePayload,
  canvasConnectionUnavailable,
  connectionFromRealtimeStatus,
  type CanvasConnectionState,
} from './canvas-connection';

export function useRealtimeAgendas(sessionSlug: string) {
  const [nodes, setNodes] = useState<AgendaNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connection, setConnection] = useState<CanvasConnectionState>({
    status: 'loading',
    message: '캔버스 데이터를 불러오는 중입니다.',
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setConnection({ status: 'loading', message: '캔버스 데이터를 불러오는 중입니다.' });
    setSessionId(null);
    setNodes([]);
    setEdges([]);
    const sb = getSupabase();
    if (!sb) {
      setConnection(canvasConnectionUnavailable());
      return;
    }
    // cleanup must be returned from useEffect itself (not the async IIFE).
    // `cancelled` guards the race where unmount happens before subscribe resolves.
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data: sess, error: sessionError } = await sb.schema('climate_vote').from('session')
        .select('id').eq('slug', sessionSlug).single();
      if (sessionError) {
        if (!cancelled) setConnection(canvasConnectionFailure('session', sessionError));
        return;
      }
      if (!sess) {
        if (!cancelled) setConnection(canvasConnectionFailure('session payload', new Error('Session not found.')));
        return;
      }
      if (cancelled) return;
      const sessionId = sess.id;
      setSessionId(sessionId);
      const { data: rows, error: agendaError } = await sb.schema('climate_vote').from('agenda')
        .select('*').eq('session_id', sessionId);
      if (agendaError) {
        if (!cancelled) setConnection(canvasConnectionFailure('agenda list', agendaError));
        return;
      }
      const { data: links, error: linkError } = await sb.schema('climate_vote').from('agenda_link')
        .select('id,source_id,target_id').eq('session_id', sessionId);
      if (linkError) {
        if (!cancelled) setConnection(canvasConnectionFailure('agenda links', linkError));
        return;
      }
      const agendaRows = parseAgendaRows(rows);
      const agendaLinks = parseAgendaLinks(links);
      if (!agendaRows || !agendaLinks) {
        if (!cancelled) {
          setConnection(canvasConnectionFailure('snapshot payload', new Error('Invalid canvas snapshot payload.')));
        }
        return;
      }
      if (cancelled) return;
      setNodes(agendasToNodes(agendaRows));
      setEdges(linksToEdges(agendaLinks));
      channel = sb.channel(`agenda:${sessionId}`)
        .on('postgres_changes',
          { event: '*', schema: 'climate_vote', table: 'agenda', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const change = parseAgendaRealtimePayload(payload);
            if (!change) {
              setConnection(canvasMalformedRealtimePayload('agenda'));
              return;
            }
            setNodes((prev) => mergeRealtimeChange(prev, change));
          })
        .on('postgres_changes',
          { event: '*', schema: 'climate_vote', table: 'agenda_link', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const change = parseLinkRealtimePayload(payload);
            if (!change) {
              setConnection(canvasMalformedRealtimePayload('agenda_link'));
              return;
            }
            setEdges((prev) => mergeLinkChange(prev, change));
          })
        .subscribe((status) => {
          if (cancelled) return;
          const next = connectionFromRealtimeStatus(status);
          if (next) setConnection(next);
        });
      if (cancelled) { sb.removeChannel(channel); channel = null; }
    })().catch((error: unknown) => {
      if (!cancelled) setConnection(canvasConnectionFailure('unexpected exception', error));
    });
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [sessionSlug, reloadKey]);

  const retry = () => setReloadKey((value) => value + 1);
  return { nodes, setNodes, edges, setEdges, sessionId, connection, retry };
}
