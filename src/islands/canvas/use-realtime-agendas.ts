import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { agendasToNodes, mergeRealtimeChange, type AgendaNode, type AgendaRow } from './agenda-sync';

export function useRealtimeAgendas(sessionSlug: string) {
  const [nodes, setNodes] = useState<AgendaNode[]>([]);
  useEffect(() => {
    const sb = getSupabase(); if (!sb) return;
    let sessionId: string | null = null;
    (async () => {
      const { data: sess } = await sb.schema('climate_vote').from('session').select('id').eq('slug', sessionSlug).single();
      if (!sess) return; sessionId = sess.id;
      const { data: rows } = await sb.schema('climate_vote').from('agenda').select('*').eq('session_id', sessionId);
      setNodes(agendasToNodes((rows ?? []) as AgendaRow[]));
      const ch = sb.channel(`agenda:${sessionId}`)
        .on('postgres_changes',
          { event: '*', schema: 'climate_vote', table: 'agenda', filter: `session_id=eq.${sessionId}` },
          (payload) => setNodes(prev => mergeRealtimeChange(prev, payload as any)))
        .subscribe();
      return () => { sb.removeChannel(ch); };
    })();
  }, [sessionSlug]);
  return { nodes, setNodes };
}
