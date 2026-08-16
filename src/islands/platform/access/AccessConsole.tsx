import { useEffect, useRef, useState } from 'react';
import {
  ACCESS_PLAN_IMPORT_BYTES,
  STAFF_ROLES,
  accessPlanFilename,
  buildOrganizationAccessPlan,
  parseOrganizationAccessPlanImport,
  type InvitationDraft,
  type MembershipDraft,
  type OrganizationAccessPlan,
  type OrganizationRef,
  type StaffRole,
} from './access-plan-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const RED = '#B42318';
const PANEL = '#F5F9FB';

const ROLE_LABELS: Record<StaffRole, string> = {
  org_admin: '기관 관리자',
  operator: '운영자',
  hq: '본부',
  facilitator: '진행자',
};

export function AccessPlanSummary({ plan }: { plan: OrganizationAccessPlan | null }) {
  if (!plan) return null;
  return (
    <section aria-label="접근 계획 미리보기" style={{ border: `2px solid ${LINE}`, borderRadius: 12, padding: 16, background: '#fff' }}>
      <h3 style={{ color: NAVY, margin: '0 0 8px' }}>승인 전 접근 계획</h3>
      <p style={{ margin: '0 0 10px', color: MUTED }}>초대 {plan.invitations.length}건 · 기존 계정 역할 부여 {plan.memberships.length}건</p>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {plan.invitations.map((item) => <li key={`invite:${item.email}:${item.role}`}>초대 · {item.email} · {ROLE_LABELS[item.role]}</li>)}
        {plan.memberships.map((item) => <li key={`member:${item.userId}:${item.role}`}>기존 계정 · {item.userId} · {ROLE_LABELS[item.role]}</li>)}
      </ul>
      <p style={{ margin: '12px 0 0', color: RED, fontWeight: 700 }}>아직 Auth 계정 생성·초대 발송·DB 변경을 수행하지 않았습니다.</p>
    </section>
  );
}

function downloadPlan(plan: OrganizationAccessPlan): void {
  const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = accessPlanFilename(plan.organization);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function completeAccessPlanDownload(
  plan: OrganizationAccessPlan,
  downloader: (value: OrganizationAccessPlan) => void,
): { ok: true; message: string } | { ok: false; message: string } {
  try {
    downloader(plan);
    return { ok: true, message: '검증된 접근 계획 JSON을 다운로드했습니다.' };
  } catch (error: unknown) {
    console.error('Failed to download organization access plan', error);
    return { ok: false, message: '접근 계획을 다운로드하지 못했습니다. 다시 시도하세요.' };
  }
}

function RoleSelect({ value, onChange, label }: { value: StaffRole; onChange: (role: StaffRole) => void; label: string }) {
  return (
    <label style={{ display: 'grid', gap: 6, color: NAVY, fontWeight: 700 }}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as StaffRole)} style={{ minHeight: 42, border: `2px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', background: '#fff' }}>
        {STAFF_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
      </select>
    </label>
  );
}

export default function AccessConsole({ organization }: { organization: OrganizationRef | null }) {
  const [invitation, setInvitation] = useState<InvitationDraft>({ email: '', role: 'operator' });
  const [membership, setMembership] = useState<MembershipDraft>({ userId: '', role: 'operator' });
  const [invitations, setInvitations] = useState<InvitationDraft[]>([]);
  const [memberships, setMemberships] = useState<MembershipDraft[]>([]);
  const [plan, setPlan] = useState<OrganizationAccessPlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const importGeneration = useRef(0);

  useEffect(() => () => { importGeneration.current += 1; }, []);

  const invalidate = () => {
    importGeneration.current += 1;
    setImportBusy(false);
    setPlan(null);
    setNotice(null);
    setNoticeIsError(false);
  };

  const buildPlan = () => {
    importGeneration.current += 1;
    setImportBusy(false);
    const result = buildOrganizationAccessPlan({ organization, invitations, memberships });
    if (!result.ok) {
      setPlan(null);
      setNotice(result.error);
      setNoticeIsError(true);
      return;
    }
    setPlan(result.plan);
    setNotice('접근 계획을 검증했습니다. 실제 적용 전 별도 승인이 필요합니다.');
    setNoticeIsError(false);
  };

  const importPlan = async (file: File) => {
    const generation = importGeneration.current + 1;
    importGeneration.current = generation;
    setImportBusy(true);
    try {
      if (file.size > ACCESS_PLAN_IMPORT_BYTES) {
        console.error('Failed to import organization access plan: file exceeds the safe size limit');
        setNotice('접근 계획 JSON 형식 또는 내용이 올바르지 않습니다.');
        setNoticeIsError(true);
        return;
      }
      const content = await file.text();
      if (importGeneration.current !== generation) return;
      const imported = parseOrganizationAccessPlanImport(content, organization);
      if (!imported.ok) {
        console.error('Failed to import organization access plan: validation rejected the file');
        setNotice(imported.error);
        setNoticeIsError(true);
        return;
      }
      setInvitation({ email: '', role: 'operator' });
      setMembership({ userId: '', role: 'operator' });
      setInvitations([...imported.plan.invitations]);
      setMemberships([...imported.plan.memberships]);
      setPlan(imported.plan);
      setNotice('접근 계획 JSON을 다시 검증해 불러왔습니다. 실제 적용 전 별도 승인이 필요합니다.');
      setNoticeIsError(false);
    } catch (error: unknown) {
      if (importGeneration.current !== generation) return;
      console.error('Failed to import organization access plan', error);
      setNotice('접근 계획 파일을 읽지 못했습니다. 다시 시도하세요.');
      setNoticeIsError(true);
    } finally {
      if (importGeneration.current === generation) setImportBusy(false);
    }
  };

  return (
    <div aria-busy={importBusy}>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>기관 · 접근 관리</div>
      <h2 style={{ color: NAVY, margin: '0 0 6px' }}>기관 역할·초대 계획</h2>
      <p style={{ color: MUTED, margin: '0 0 18px' }}>현재 기관: {organization?.label ?? '기관 미확인'}. 입력은 브라우저 메모리에만 두며 서버로 전송하지 않습니다.</p>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', marginBottom: 16 }}>
        <fieldset style={{ border: `2px solid ${LINE}`, borderRadius: 12, padding: 14, background: PANEL }}>
          <legend style={{ color: NAVY, fontWeight: 800 }}>이메일 초대 계획</legend>
          <label style={{ display: 'grid', gap: 6, color: NAVY, fontWeight: 700 }}>초대 이메일
            <input type="email" value={invitation.email} onChange={(event) => { invalidate(); setInvitation({ ...invitation, email: event.target.value }); }} autoComplete="off" style={{ minHeight: 42, border: `2px solid ${LINE}`, borderRadius: 8, padding: '6px 10px' }} />
          </label>
          <div style={{ marginTop: 10 }}><RoleSelect label="초대 역할" value={invitation.role} onChange={(role) => { invalidate(); setInvitation({ ...invitation, role }); }} /></div>
          <button type="button" onClick={() => { invalidate(); setInvitations([...invitations, invitation]); setInvitation({ email: '', role: 'operator' }); }} style={{ marginTop: 12, minHeight: 42, border: `2px solid ${TEAL}`, borderRadius: 8, padding: '6px 12px', color: TEAL, background: '#fff', fontWeight: 800 }}>초대 계획 추가</button>
          {invitations.length > 0 ? <ul aria-label="추가한 이메일 초대" style={{ margin: '12px 0 0', paddingLeft: 20 }}>
            {invitations.map((item, index) => <li key={`${item.email}:${item.role}:${index}`} style={{ marginBottom: 6 }}>{item.email || '(이메일 미입력)'} · {ROLE_LABELS[item.role]} <button type="button" onClick={() => { invalidate(); setInvitations(invitations.filter((_, itemIndex) => itemIndex !== index)); }} style={{ minHeight: 36, border: `2px solid ${LINE}`, borderRadius: 7, background: '#fff', color: RED, fontWeight: 700 }}>제거</button></li>)}
          </ul> : null}
        </fieldset>

        <fieldset style={{ border: `2px solid ${LINE}`, borderRadius: 12, padding: 14, background: PANEL }}>
          <legend style={{ color: NAVY, fontWeight: 800 }}>기존 Auth 계정 역할 계획</legend>
          <label style={{ display: 'grid', gap: 6, color: NAVY, fontWeight: 700 }}>Auth 사용자 UUID
            <input value={membership.userId} onChange={(event) => { invalidate(); setMembership({ ...membership, userId: event.target.value }); }} autoComplete="off" spellCheck={false} style={{ minHeight: 42, border: `2px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', fontFamily: 'monospace' }} />
          </label>
          <div style={{ marginTop: 10 }}><RoleSelect label="membership 역할" value={membership.role} onChange={(role) => { invalidate(); setMembership({ ...membership, role }); }} /></div>
          <button type="button" onClick={() => { invalidate(); setMemberships([...memberships, membership]); setMembership({ userId: '', role: 'operator' }); }} style={{ marginTop: 12, minHeight: 42, border: `2px solid ${TEAL}`, borderRadius: 8, padding: '6px 12px', color: TEAL, background: '#fff', fontWeight: 800 }}>membership 계획 추가</button>
          {memberships.length > 0 ? <ul aria-label="추가한 기존 계정 역할" style={{ margin: '12px 0 0', paddingLeft: 20 }}>
            {memberships.map((item, index) => <li key={`${item.userId}:${item.role}:${index}`} style={{ marginBottom: 6 }}>{item.userId || '(UUID 미입력)'} · {ROLE_LABELS[item.role]} <button type="button" onClick={() => { invalidate(); setMemberships(memberships.filter((_, itemIndex) => itemIndex !== index)); }} style={{ minHeight: 36, border: `2px solid ${LINE}`, borderRadius: 7, background: '#fff', color: RED, fontWeight: 700 }}>제거</button></li>)}
          </ul> : null}
        </fieldset>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <label style={{ display: 'grid', gap: 4, color: NAVY, fontWeight: 700 }}>
          접근 계획 JSON 불러오기
          <input
            type="file"
            accept="application/json,.json"
            disabled={importBusy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importPlan(file);
            }}
            style={{ color: MUTED, minHeight: 44, maxWidth: 320 }}
          />
        </label>
        <button type="button" onClick={buildPlan} style={{ minHeight: 44, border: `2px solid ${NAVY}`, borderRadius: 8, padding: '8px 14px', background: NAVY, color: '#fff', fontWeight: 800 }}>계획 검증</button>
        <button type="button" disabled={!plan || importBusy} onClick={() => {
          if (!plan) return;
          const result = completeAccessPlanDownload(plan, downloadPlan);
          setNotice(result.message);
          setNoticeIsError(!result.ok);
        }} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 8, padding: '8px 14px', background: plan && !importBusy ? '#fff' : '#E8EEF2', color: plan && !importBusy ? TEAL : MUTED, fontWeight: 800 }}>검증된 JSON 다운로드</button>
      </div>
      {notice ? <p role={noticeIsError ? 'alert' : 'status'} aria-live={noticeIsError ? 'assertive' : 'polite'} style={{ color: noticeIsError ? RED : TEAL, fontWeight: 700 }}>{notice}</p> : null}
      <AccessPlanSummary plan={plan} />
    </div>
  );
}
