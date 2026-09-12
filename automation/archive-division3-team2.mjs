import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { chromium } from 'playwright';

const privateDirectory=process.env.WORKSHOP_PRIVATE_DIRECTORY;
if(!privateDirectory) throw new Error('Private directory required');
const backupDirectory=`${privateDirectory}/0913-division3-team2-archive`;
mkdirSync(backupDirectory,{recursive:true});
const password=readFileSync(`${privateDirectory}/0912-hq-initial-credential-correction.sql`,'utf8').match(/crypt\('([^']+)'\s*,/)?.[1];
if(!password) throw new Error('HQ credential unavailable');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({serviceWorkers:'block'});
const page=await context.newPage();
const report={startedAt:new Date().toISOString(),mode:process.argv.includes('--apply')?'apply':'inspect',results:[]};
let request;
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  await context.routeWebSocket(/.*/,socket=>socket.close());
  await context.route('**/rest/v1/**',async route=>{
    const rpc=new URL(route.request().url()).pathname.split('/').at(-1);
    if(!['attendance_hq_unlock_named','agenda_board_v2','workshop_hq_status','workshop_hq_devices','workshop_hq_logout_v2'].includes(rpc)) return route.abort();
    await route.continue();
  });
  page.on('request',r=>{if(r.url().endsWith('/rpc/agenda_board_v2')) request=r;});
  await page.goto('https://climate-assembly.org/hq/',{waitUntil:'domcontentloaded'});
  await page.getByLabel('운영자 표시 이름').fill('서재홍');
  await page.getByLabel('개인 비밀번호',{exact:true}).fill(password);
  const boardResponse=page.waitForResponse(r=>r.url().endsWith('/rpc/agenda_board_v2')&&r.ok(),{timeout:30000});
  await page.getByRole('button',{name:'본부 로그인',exact:true}).click();
  const before=await (await boardResponse).json();
  if(!request||before.scope!=='hq'||before.sessionSlug!=='0912-deliberation') throw new Error('Unexpected HQ scope');
  const team=before.teams.find(t=>t.name==='3분과 2조'&&t.subgroup==='3분과');
  if(!team) throw new Error('Target team not found');
  const recommendations=before.agendas.flatMap(a=>a.recommendations.filter(r=>!r.archived&&r.authorTeamId===team.id).map(r=>({agendaId:a.id,parentArchived:a.archived,...r})));
  const agendas=before.agendas.filter(a=>!a.archived&&a.subgroup==='3분과'&&a.ordinal>8&&a.assignments.some(x=>x.teamId===team.id));
  const manifest={teamId:team.id,agendas:agendas.map(a=>({id:a.id,title:a.title,ordinal:a.ordinal,createdAt:a.createdAt,assignments:a.assignments,foreignRecommendations:a.recommendations.filter(r=>!r.archived&&r.authorTeamId!==team.id).length})),recommendations:recommendations.map(r=>({id:r.id,agendaId:r.agendaId,title:r.title,parentArchived:r.parentArchived})),targetFingerprint:fingerprint({agendas,recommendations})};
  const beforePath=`${backupDirectory}/before-${Date.now()}.json`;
  writeFileSync(beforePath,JSON.stringify(before,null,2));
  report.backupPath=beforePath;
  if(report.mode==='inspect') {
    writeFileSync(`${backupDirectory}/manifest.json`,JSON.stringify(manifest,null,2));
    console.log(JSON.stringify(manifest));
  } else {
    if(!existsSync(`${backupDirectory}/manifest.json`)) throw new Error('Inspection manifest missing');
    const approved=JSON.parse(readFileSync(`${backupDirectory}/manifest.json`,'utf8'));
    if(manifest.targetFingerprint!==approved.targetFingerprint) throw new Error('Target content changed since inspection');
    if(agendas.length!==2||recommendations.length!==11) throw new Error('Expected 2 added topics and 11 recommendations');
    if(agendas.some(a=>a.assignments.some(x=>x.teamId!==team.id)||a.recommendations.some(r=>!r.archived&&r.authorTeamId!==team.id))||recommendations.some(r=>r.parentArchived)) throw new Error('Cross-team or archived-parent conflict');
    const headers=await request.allHeaders();
    const token=request.postDataJSON().p_token;
    const base=request.url().replace(/agenda_board_v2$/,'');
    const rpc=async(name,data)=>{
      const response=await context.request.post(`${base}${name}`,{headers:{apikey:headers.apikey,authorization:headers.authorization,'content-profile':'climate_vote','accept-profile':'climate_vote'},data:{p_token:token,p_session_slug:'0912-deliberation',...data},timeout:20000});
      if(!response.ok()) throw new Error(`${name} failed HTTP ${response.status()}: ${(await response.json()).message||'RPC failure'}`);
      return response.json();
    };
    const reason='사용자 명시 요청: 3분과 2조 오입력 전체 정리 후 재입력 예정. 원문과 이력 보존.';
    for(const recommendation of recommendations) {
      const result=await rpc('recommendation_archive_v2',{p_recommendation_id:recommendation.id,p_reason:reason,p_request_id:randomUUID()});
      report.results.push({kind:'recommendation',id:recommendation.id,result});
      writeFileSync(`${backupDirectory}/execution.json`,JSON.stringify(report,null,2));
    }
    for(const agenda of agendas) {
      const result=await rpc('agenda_archive_v2',{p_agenda_id:agenda.id,p_reason:reason,p_request_id:randomUUID()});
      report.results.push({kind:'agenda',id:agenda.id,result});
      writeFileSync(`${backupDirectory}/execution.json`,JSON.stringify(report,null,2));
    }
    const after=await rpc('agenda_board_v2',{});
    writeFileSync(`${backupDirectory}/after.json`,JSON.stringify(after,null,2));
    const targetAgendaIds=new Set(agendas.map(a=>a.id));
    const targetRecIds=new Set(recommendations.map(r=>r.id));
    report.remainingAgendas=after.agendas.filter(a=>targetAgendaIds.has(a.id)&&!a.archived).length;
    report.remainingRecommendations=after.agendas.flatMap(a=>a.recommendations).filter(r=>targetRecIds.has(r.id)&&!r.archived).length;
    const nonTarget=board=>board.agendas.filter(a=>!targetAgendaIds.has(a.id)).map(a=>({...a,recommendations:a.recommendations.filter(r=>!targetRecIds.has(r.id))}));
    report.otherAgendaDataUnchanged=fingerprint(nonTarget(before))===fingerprint(nonTarget(after));
    report.teamsUnchanged=fingerprint(before.teams)===fingerprint(after.teams);
    report.complete=report.remainingAgendas===0&&report.remainingRecommendations===0&&report.otherAgendaDataUnchanged&&report.teamsUnchanged;
    writeFileSync(`${backupDirectory}/execution.json`,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    if(!report.complete) throw new Error('Post-archive verification failed');
  }
} catch(error) {
  report.error=error.message;
  writeFileSync(`${backupDirectory}/last-error.json`,JSON.stringify(report,null,2));
  console.error(error.message);
  process.exitCode=1;
} finally {
  const logout=page.getByRole('button',{name:'로그아웃',exact:true});
  if(await logout.count()) {
    try {await Promise.all([page.waitForResponse(r=>r.url().endsWith('/rpc/workshop_hq_logout_v2'),{timeout:10000}),logout.click()]);}
    catch {console.error('HQ logout confirmation unavailable');}
  }
  await context.unrouteAll({behavior:'wait'});
  await browser.close();
}
