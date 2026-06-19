import { useEffect, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { getSupabase } from '../../lib/supabase';
import {
  agendasToNodes, mergeRealtimeChange, linksToEdges, mergeLinkChange,
  type AgendaNode, type AgendaRow, type AgendaLink,
} from './agenda-sync';

export function useRealtimeAgendas(sessionSlug: string) {
  const [nodes, setNodes] = useState<AgendaNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const sb = getSupabase(); if (!sb) return;
    // cleanup must be returned from useEffect itself (not the async IIFE).
    // `cancelled` guards the race where unmount happens before subscribe resolves.
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data: sess } = await sb.schema('climate_vote').from('session').select('id').eq('slug', sessionSlug).single();
      if (!sess || cancelled) return;
      const sessionId = sess.id;
      setSessionId(sessionId);
      const { data: rows } = await sb.schema('climate_vote').from('agenda').select('*').eq('session_id', sessionId);
      const { data: links } = await sb.schema('climate_vote').from('agenda_link').select('id,source_id,target_id').eq('session_id', sessionId);
      if (cancelled) return;
      setNodes(agendasToNodes((rows ?? []) as AgendaRow[]));
      setEdges(linksToEdges((links ?? []) as AgendaLink[]));
      channel = sb.channel(`agenda:${sessionId}`)
        .on('postgres_changes',
          { event: '*', schema: 'climate_vote', table: 'agenda', filter: `session_id=eq.${sessionId}` },
          (payload) => setNodes((prev) => mergeRealtimeChange(prev, payload as any)))
        .on('postgres_changes',
          { event: '*', schema: 'climate_vote', table: 'agenda_link', filter: `session_id=eq.${sessionId}` },
          (payload) => setEdges((prev) => mergeLinkChange(prev, payload as any)))
        .subscribe();
      if (cancelled) { sb.removeChannel(channel); channel = null; }
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [sessionSlug]);
  return { nodes, setNodes, edges, setEdges, sessionId };
}
