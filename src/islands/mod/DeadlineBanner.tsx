import { useEffect, useState } from 'react';
import { topicList, type Topic } from '../../lib/deliberation';
import { bannerView, clockOffsetMs, type CountdownTier } from './topic-countdown';

/**
 * 꼭지 마감 카운트다운 배너 — **탭 바깥 상단**에 붙는다(`ModConsole.tsx`).
 *
 * 8.29에 조가 산출물을 제 시간에 못 올린 첫 번째 이유가 「마감 시각을 조가 몰랐다」였다.
 * 타이머는 `timer` 탭 안에 있는데 조의 기본 탭은 `submission` 이라(`mod-tabs.ts:24-28`)
 * 아무도 보지 않았다. 그래서 이 배너는 **탭 안에 두지 않는다**(설계 B-D2).
 *
 * ★ **이 파일은 판단하지 않는다.** 어느 꼭지를 띄울지·어느 구간인지·무슨 문구인지는
 *   전부 `topic-countdown.ts` 의 `bannerView` 가 정한다. 여기가 정하는 것은 **색과 크기**뿐이다.
 *   이 저장소의 `.tsx` 는 vitest include 밖이라 여기 넣은 판단은 검사 밖에 남는다.
 *
 * ★ **미저장 여부를 여기서 계산하지 않는다.** 조 화면의 저장 배지(`draftStatusLabel`)가
 *   보는 것과 **같은 사실**을 `unsavedTopicIds` 로 위에서 받는다. 초안 파일의 존재로
 *   짐작하면 「서버와 같은 초안」까지 미저장으로 잡혀 두 자리가 다른 말을 한다.
 */

/** 구간별 색. 설계 §2.4 의 표 그대로 — 평상 회색 / 주의 노랑 / 경고 주황 / 마감 빨강. */
const TONE: Record<Exclude<CountdownTier, 'none'>, { box: string; label: string; time: string }> = {
  calm: {
    box: 'border-[#DCE7EE] bg-[#F1F7FA]',
    label: 'text-[#5A6B73]',
    time: 'text-[#1F4E79]',
  },
  notice: {
    box: 'border-[#F2C94C] bg-[#FDF6E3]',
    label: 'text-[#8A6D1F]',
    time: 'text-[#8A6D1F]',
  },
  warn: {
    box: 'border-[#F5A623] bg-[#FFF3E2]',
    label: 'text-[#B5651D]',
    time: 'text-[#B5651D]',
  },
  over: {
    box: 'border-[#D64545] bg-[#FDEBEB]',
    label: 'text-[#A62828]',
    time: 'text-[#A62828]',
  },
};

/** 꼭지 번호 표기 — 조 화면(`SubmissionPanel`)의 구역 머리와 같은 기호를 쓴다. */
const ORDINAL_MARKS = ['①', '②', '③', '④', '⑤', '⑥'];

/** 마감 시각·서버 시각을 다시 읽는 주기. 본부가 현장에서 시간표를 바꾸면 이 주기 안에 따라온다. */
const POLL_MS = 30_000;

export default function DeadlineBanner({
  code,
  unsavedTopicIds,
  fixtureTopics,
}: {
  code: string | null;
  /** 미저장(또는 재전송 대기)인 꼭지 id. `SubmissionPanel` 이 올려 보낸다. */
  unsavedTopicIds?: readonly string[];
  /** 픽스처 꼭지. 주면 `topic_list` 를 부르지 않는다(미리보기 라우트 전용). */
  fixtureTopics?: Topic[];
}) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  /**
   * 서버 시각 − 기기 시각. **폴링 때 한 번만** 잡는다.
   *
   * ★ 매 tick 마다 다시 계산하면 안 된다 — `clockOffsetMs(serverNow, nowMs)` 는 `nowMs` 가
   *   커질수록 작아지므로, tick 값으로 다시 재면 오프셋이 정확히 상쇄돼 **잔여 시간이 얼어붙는다.**
   */
  const [offsetMs, setOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    if (fixtureTopics) {
      setTopics(fixtureTopics);
      const fixtureServerNow = fixtureTopics.find((t) => t.server_now)?.server_now;
      setOffsetMs(clockOffsetMs(fixtureServerNow, Date.now()));
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const list = await topicList(code);
        if (!alive) return;
        setTopics(list);
        // `server_now` 는 꼭지가 아니라 **응답의 성질**이다(행마다 같은 값). 한 번만 꺼낸다.
        setOffsetMs(clockOffsetMs(list.find((t) => t.server_now)?.server_now, Date.now()));
      } catch {
        // ★ 실패해도 배너를 지우지 않는다. 마지막 목록·마지막 오프셋으로 계속 센다 —
        //   네트워크가 끊겼다고 카운트다운이 멈추면 조는 마감을 다시 놓친다.
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [code, fixtureTopics]);

  // 1초 tick. `Timer.tsx` 의 250ms 는 분·초 표시에는 과하다(설계 §2.5).
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const view = bannerView(topics, nowMs, offsetMs, unsavedTopicIds);
  // 마감이 걸린 열린 꼭지가 없으면 **아무것도 그리지 않는다**(빈 껍데기 금지).
  if (view === null) return null;

  const tone = TONE[view.tier];
  const mark = ORDINAL_MARKS[view.topic.ordinal - 1] ?? String(view.topic.ordinal);

  return (
    <div
      data-deadline-banner={view.tier}
      className={`sticky top-0 z-30 -mx-1 mb-4 rounded-2xl border-2 px-4 py-3 shadow-sm ${tone.box}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`text-[24px] font-extrabold ${tone.label}`}>
          {`꼭지${mark} ${view.tier === 'over' ? '마감' : '마감까지'}`}
        </span>
        <span
          data-deadline-countdown=""
          className={`text-[40px] font-extrabold leading-none ${tone.time}`}
          style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}
        >
          {view.countdown}
        </span>
        {view.message ? (
          <span data-deadline-message="" role="status" className={`text-[24px] font-bold ${tone.label}`}>
            {view.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
