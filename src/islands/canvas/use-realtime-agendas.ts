import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { agendasToNodes, mergeRealtimeChange, type AgendaNode, type AgendaRow } from './agenda-sync';

export function useRealtimeAgendas(sessionSlug: string) {
  const [nodes, setNodes] = useState<AgendaNode[]>([]);
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
      const { data: rows } = await sb.schema('climate_vote').from('agenda').select('*').eq('session_id', sessionId);
      if (cancelled) return;
      setNodes(agendasToNodes((rows ?? []) as AgendaRow[]));
      channel = sb.channel(`agenda:${sessionId}`)
        .on('postgres_changes',
          { event: '*', schema: 'climate_vote', table: 'agenda', filter: `session_id=eq.${sessionId}` },
          (payload) => setNodes(prev => mergeRealtimeChange(prev, payload as any)))
        .subscribe();
      if (cancelled) { sb.removeChannel(channel); channel = null; }
    })();
    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [sessionSlug]);
  return { nodes, setNodes };
}
