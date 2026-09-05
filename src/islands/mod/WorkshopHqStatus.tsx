import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchWorkshopDevices,
  fetchWorkshopHqStatus,
  openNextWorkshopTopic,
  revokeWorkshopDevice,
  setWorkshopTopicStatus,
  type WorkshopDevice,
  type WorkshopHqStatus,
} from '../../lib/workshop-hq';
import { CURRENT_SESSION_SLUG } from '../../lib/hq-submissions';
import {
  deviceIsStale,
  formatHqClock,
  groupWorkshopDevices,
  hqOperationErrorMessage,
  readinessItems,
  topicStatusLabel,
} from './workshop-hq-logic';
import { classifyHqAuthorizationError } from './hq-gate-logic';

const REFRESH_MS = 10_000;

export default function WorkshopHqStatus({
  token,
  onAuthorizationExpired,
}: {
  token: string;
  onAuthorizationExpired: () => void;
}) {
  const [status, setStatus] = useState<WorkshopHqStatus | null>(null);
  const [devices, setDevices] = useState<WorkshopDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const requestIdsRef = useRef<Map<string, string>>(new Map());
  const refreshRef = useRef<{ token: string; sequence: number; inFlight: Promise<void> | null }>({
    token,
    sequence: 0,
    inFlight: null,
  });

  const refresh = useCallback(async () => {
    const current = refreshRef.current;
    if (current.token === token && current.inFlight) return current.inFlight;
    const sequence = current.sequence + 1;
    const operation = (async () => {
      try {
        const [nextStatus, nextDevices] = await Promise.all([
          fetchWorkshopHqStatus(token, CURRENT_SESSION_SLUG),
          fetchWorkshopDevices(token, CURRENT_SESSION_SLUG),
        ]);
        if (refreshRef.current.sequence !== sequence || refreshRef.current.token !== token) return;
        setStatus(nextStatus);
        setDevices(nextDevices);
        setLastSyncedAt(Date.now());
        setError(null);
      } catch (caught) {
        console.error('[workshop HQ] status refresh failed', caught);
        if (refreshRef.current.sequence !== sequence || refreshRef.current.token !== token) return;
        if (classifyHqAuthorizationError(caught) === 'expired') {
          onAuthorizationExpired();
          return;
        }
        setError(caught instanceof Error && caught.message.includes('PGRST202')
          ? '현장 운영 보안 migration이 아직 적용되지 않았습니다.'
          : '운영 상태를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
      } finally {
        if (refreshRef.current.sequence === sequence && refreshRef.current.token === token) {
          refreshRef.current.inFlight = null;
          setLoading(false);
        }
      }
    })();
    refreshRef.current = { token, sequence, inFlight: operation };
    return operation;
  }, [onAuthorizationExpired, token]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const wake = () => void refresh();
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, [refresh]);

  const groupedDevices = useMemo(() => groupWorkshopDevices(devices), [devices]);

  const run = async (intentKey: string, action: (requestId: string) => Promise<void>, success: string) => {
    const requestId = requestIdsRef.current.get(intentKey) ?? crypto.randomUUID();
    requestIdsRef.current.set(intentKey, requestId);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(requestId);
      requestIdsRef.current.delete(intentKey);
      setNotice(success);
      await refresh();
    } catch (caught) {
      console.error('[workshop HQ] operation failed', caught);
      if (classifyHqAuthorizationError(caught) === 'expired') {
        onAuthorizationExpired();
        return;
      }
      const operationMessage = hqOperationErrorMessage(caught);
      await refresh();
      setError(operationMessage);
    } finally {
      setBusy(false);
    }
  };

  const openNext = () => {
    const ordinal = status?.next_topic_ordinal;
    const prompt = status?.next_topic_prompt;
    if (ordinal == null || !prompt) return;
    if (!window.confirm(`꼭지 ${ordinal} 「${prompt}」를 모든 ${status.teams_total}개 조에 엽니까?`)) return;
    void run(
      `open:${ordinal}`,
      async (requestId) => { await openNextWorkshopTopic(token, CURRENT_SESSION_SLUG, ordinal, requestId); },
      `꼭지 ${ordinal}을 열었습니다. 조 화면에는 10초 안에 표시됩니다.`,
    );
  };

  return (
    <section className="border-b-4 border-[#1F4E79] bg-[#EEF6FA] px-4 py-5 sm:px-6" aria-labelledby="workshop-hq-title">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="workshop-hq-title" className="text-[24px] font-extrabold text-[#1F2933]">9월 12~13일 현장 운영</h2>
            <p className="mt-1 text-[15px] font-semibold text-[#5A6B73]">
              {lastSyncedAt ? `마지막 동기화 ${new Date(lastSyncedAt).toLocaleTimeString('ko-KR')}` : '서버 연결 확인 중'}
            </p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={busy}
            className="min-h-11 rounded-xl border-2 border-[#1F4E79] bg-white px-4 text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            지금 새로고침
          </button>
        </div>

        {error ? <p role="alert" className="mt-4 rounded-xl border-2 border-[#D64545] bg-white px-4 py-3 text-[16px] font-bold text-[#A62828]">{error}</p> : null}
        {notice ? <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-[#4F9D3A] bg-white px-4 py-3 text-[16px] font-bold text-[#2D6A24]">{notice}</p> : null}
        {loading && !status ? <p role="status" className="mt-4 text-[16px] font-bold text-[#1F4E79]">운영 상태를 확인하고 있습니다…</p> : null}

        {status ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {readinessItems(status).map((item) => (
                <div key={item.label} className={`rounded-xl border-2 bg-white p-3 ${item.ok ? 'border-[#4F9D3A]' : 'border-[#D64545]'}`}>
                  <div className="text-[13px] font-bold text-[#5A6B73]">{item.label}</div>
                  <div className="mt-1 text-[19px] font-extrabold text-[#1F2933]">{item.value}</div>
                  <div className={`mt-1 text-[13px] font-bold ${item.ok ? 'text-[#2D6A24]' : 'text-[#A62828]'}`}>{item.ok ? '확인됨' : '확인 필요'}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {[
                ['접속 중인 조', `${status.teams_online}/${status.teams_total}`],
                ['열린 꼭지', `${status.topic_open}개`],
                ['마친 꼭지', `${status.topic_closed}개`],
                ['작성 중 제출', `${status.submissions_draft}건`],
                ['최종 제출', `${status.submissions_final}건`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#1F4E79] p-3 text-white">
                  <div className="text-[13px] font-semibold text-[#DCE7EE]">{label}</div>
                  <div className="text-[24px] font-extrabold tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border-2 border-[#C4D8E4] bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[19px] font-extrabold text-[#1F4E79]">꼭지 개방</h3>
                  <p className="text-[15px] text-[#5A6B73]">
                    {status.next_topic_ordinal == null ? '열 수 있는 다음 꼭지가 없습니다.' : `다음: ${status.next_topic_ordinal}. ${status.next_topic_prompt}`}
                  </p>
                </div>
                <button type="button" disabled={busy || status.next_topic_ordinal == null} onClick={openNext}
                  className="min-h-12 rounded-xl bg-[#1F4E79] px-5 text-[17px] font-extrabold text-white disabled:opacity-40">
                  다음 꼭지 열기
                </button>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {status.topics.map((topic) => (
                  <div key={topic.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DCE7EE] p-3">
                    <span className="min-w-0 flex-1 text-[15px] font-bold text-[#1F2933]">{topic.ordinal}. {topic.prompt}</span>
                    <span className="rounded-full bg-[#EEF4F8] px-2 py-1 text-[13px] font-bold text-[#1F4E79]">{topicStatusLabel(topic.status)}</span>
                    {topic.status !== 'draft' ? (
                      <button type="button" disabled={busy} onClick={() => {
                        const next = topic.status === 'open' ? 'closed' : 'open';
                        if (!window.confirm(`${topic.ordinal}번 꼭지를 ${next === 'open' ? '다시 엽니까' : '닫습니까'}?`)) return;
                        void run(
                          `topic:${topic.id}:${topic.status}:${next}`,
                          (requestId) => setWorkshopTopicStatus(
                            token,
                            CURRENT_SESSION_SLUG,
                            topic.id,
                            topic.status,
                            next,
                            requestId,
                          ).then(() => undefined),
                          `${topic.ordinal}번 꼭지를 ${next === 'open' ? '열었습니다' : '닫았습니다'}.`,
                        );
                      }} className="min-h-11 rounded-lg border border-[#1F4E79] px-3 text-[14px] font-bold text-[#1F4E79] disabled:opacity-40">
                        {topic.status === 'open' ? '닫기' : '다시 열기'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#C4D8E4] bg-white p-4">
              <button type="button" onClick={() => setShowDevices((value) => !value)} aria-expanded={showDevices}
                className="min-h-11 w-full text-left text-[18px] font-extrabold text-[#1F4E79]">
                접속 기기 {devices.length}대 {showDevices ? '접기' : '보기'}
              </button>
              {showDevices ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {[...groupedDevices.entries()].map(([teamName, rows]) => (
                    <section key={teamName} className="rounded-xl border border-[#DCE7EE] p-3" aria-label={`${teamName} 접속 기기`}>
                      <h4 className="text-[16px] font-extrabold text-[#1F2933]">{teamName} · {rows.length}/2대</h4>
                      <div className="mt-2 space-y-2">
                        {rows.map((device) => (
                          <div key={device.token_hash} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#F5F8FB] p-2">
                            <div className="min-w-0 flex-1 text-[14px] text-[#334E5C]">
                              <div className="font-bold">{device.device_label}</div>
                              <div className={deviceIsStale(device, Date.now()) ? 'font-bold text-[#A62828]' : ''}>
                                마지막 활동 {formatHqClock(device.last_seen_at)}
                              </div>
                            </div>
                            <button type="button" disabled={busy} onClick={() => {
                              if (!window.confirm(`${teamName}의 ${device.device_label} 접근을 끊습니까?`)) return;
                              void run(
                                `revoke:${device.token_hash}`,
                                (requestId) => revokeWorkshopDevice(token, CURRENT_SESSION_SLUG, device.token_hash, 'HQ 현장 기기 해제', requestId),
                                `${teamName} 기기 접근을 해제했습니다.`,
                              );
                            }} className="min-h-11 rounded-lg border-2 border-[#D64545] bg-white px-3 text-[14px] font-bold text-[#A62828]">
                              접근 끊기
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
