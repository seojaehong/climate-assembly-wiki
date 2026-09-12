// Local-only source data is deliberately kept out of the public repository.
const fs = require('node:fs');
const path = require('node:path');
const pptxgen = require('pptxgenjs');
const directory = path.resolve(process.argv[2] || 'evaluation/0912-added-agenda-deck');
const skill = process.env.CITIZEN_DECK_SKILL;
if (!skill) throw new Error('CITIZEN_DECK_SKILL is required');
const data = JSON.parse(fs.readFileSync(path.join(directory, 'source-snapshot.json'), 'utf8'));
const curated = JSON.parse(fs.readFileSync(path.join(directory, 'curation.json'), 'utf8'));
const deck = new pptxgen();
deck.defineLayout({ name: 'MEETING', width: 10, height: 5.625 });
deck.layout = 'MEETING';
deck.author = '시민회의 운영팀';
deck.subject = '당일 추가 주제 등록 의견 요약 — 확정 권고안 아님';
deck.title = '9월 12일 분과별 추가 주제';
deck.lang = 'ko-KR';
const ui = require(path.join(skill, 'scripts/lib.js'))(deck);
const font = 'NanumSquare Neo OTF Regular';
const eb = 'NanumSquare Neo OTF ExtraBold';
deck.theme = { headFontFace: eb, bodyFontFace: font, lang: 'ko-KR' };
const clean = text => text.replace(/(?:^|\n)\s*[-•]?\s*[가-힣]{3}\s*[:：]\s*/g, '\n').replace(/[-•]?\s*[가-힣]{3}\s*[:：]\s*/g, '').replace(/^\s*\([가-힣]{3}\)\s*/gm, '').trim();
const titles = a => (curated[`${a.subgroup}:${a.ordinal}`]?.[2] || clean(a.title)).replace(/^[-–]\s*/, '');
const slides = [];
const coverage = [];
function text(slide, value, x, y, w, h, size = 23, color = ui.P.ink, heading = false) {
  slide.addText(value, { x,y,w,h,fontFace:heading?eb:font,fontSize:size,color,margin:0,breakLine:false,valign:'mid',paraSpaceAfterPt:0 });
}
function add() { const slide = deck.addSlide(); slides.push(slide); return slide; }
function footer(slide, summary) {
  ui.footer(slide, { summary, page: slides.length, total: data.agendas.length + 6, char:false });
  slide.addImage({ path:path.join(skill,'assets/geudeugi.png'),x:9.28,y:4.77,w:.56,h:.73 });
}
const stamp = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.capturedAt));
let slide = add();
slide.background = {color:ui.P.navy};
text(slide,'시민회의 · 회의용 등록 의견',.6,.65,8.8,.4,17,ui.P.sky);
text(slide,'오늘 추가된 주제',.6,1.65,8.8,.7,36,'FFFFFF',true);
text(slide,'분과별로 함께 확인합니다',.6,2.5,8.8,.6,26,'FFFFFF');
text(slide,`2026. 9. 12. ${stamp} 기준 · 3개 분과`,.6,4.22,8.8,.4,18,'FFFFFF');
slide.addNotes('운영 HQ 읽기 전용 스냅샷 기준. 기존 정본 9·8·8을 넘는 금일 생성 비보관 등록을 전수 수록합니다. 등록 의견을 요약했으며 확정 권고안이 아닙니다. 시민 발언의 수치·사례를 외부 검증한 자료가 아닙니다.');
slide = add();
ui.header(slide,{num:'+',kicker:'2026.09.12 · 추가 등록 현황',title:'오늘 추가된 등록은 모두 42건입니다'});
['1분과','2분과','3분과'].forEach((division,i)=>{
  const count=data.agendas.filter(a=>a.subgroup===division).length;
  ui.card(slide,.5+i*3.05,1.75,2.85,2.2,ui.P.pale,{shadow:false});
  text(slide,division,.7+i*3.05,2,2.45,.45,23,ui.P.navy,true);
  text(slide,`${count}건`,.7+i*3.05,2.8,2.45,.7,36,ui.P.teal,true);
});
text(slide,'같은 제목의 별도 등록은 유지했습니다. 보관 처리 1건은 제외했습니다.',.6,4.35,8.8,.4,15,ui.P.gray);
footer(slide,'등록 의견을 요약한 회의자료입니다. 확정 권고안은 아닙니다.');
slide.addNotes(`조회 시각: ${data.capturedAt}. 활성 추가 등록 ${data.agendas.length}건. 보관 제외 ${data.archived.length}건. 원문은 로컬 source-snapshot.json에 보존. 개인정보 및 검증하지 않은 수치는 본문에서 제외.`);
for (const division of ['1분과','2분과','3분과']) {
  const agendas=data.agendas.filter(a=>a.subgroup===division).sort((a,b)=>a.ordinal-b.ordinal);
  slide=add(); slide.background={color:ui.P.navy};
  text(slide,division,.65,1.25,8.7,.9,48,'FFFFFF',true);
  text(slide,`오늘 추가된 ${agendas.length}건`,.65,2.45,8.7,.65,30,ui.P.sky,true);
  text(slide,'주제명과 등록 의견을 확인합니다',.65,3.45,8.7,.55,23,'FFFFFF');
  slide.addNotes(agendas.map(a=>`${a.ordinal}. ${titles(a)} / ${a.assignments.map(t=>t.teamName).join(', ')}`).join('\n'));
  for (const agenda of agendas) {
    const key=`${division}:${agenda.ordinal}`;
    const content=curated[key];
    if(!content) throw new Error(`Missing curation: ${key}`);
    const teams=agenda.assignments.map(a=>a.teamName.replace(`${division} `,'')).join(' · ') || '조 미배정';
    const peers=agendas.filter(a=>titles(a).replace(/\s/g,'')===titles(agenda).replace(/\s/g,''));
    const duplicate=peers.length>1?` · 동명 등록 ${peers.indexOf(agenda)+1}/${peers.length}`:'';
    slide=add();
    ui.header(slide,{num:division[0],kicker:`${division} · ${teams}${duplicate}`,title:'추가 주제 · 등록 의견 요약'});
    const title=titles(agenda);
    text(slide,title,.55,1.53,8.9,1.12,title.length>47?23:27,ui.P.navy,true);
    const effect=content[1];
    if(effect){
      text(slide,'제안·문제인식',.6,2.79,8.8,.3,13,ui.P.teal,true);
      text(slide,content[0],.6,3.12,9,.68,20);
      text(slide,'바라는 변화 · 기대효과',.6,3.9,8.8,.3,13,ui.P.teal,true);
      text(slide,effect,.6,4.23,9,.68,20);
    } else {
      text(slide,'등록 내용',.6,2.86,8.8,.32,14,ui.P.teal,true);
      text(slide,content[0],.6,3.28,9,1.15,23);
    }
    footer(slide,`${division} · ${teams}${duplicate}`);
    slide.addNotes(`원본 등록: ${key}\n원본 제목: ${clean(agenda.title)}\n조회: ${data.capturedAt}\n화면 문장은 원문 요약이며 확정안이 아닙니다. 제목 축약 시 원제는 이 메모에 보존됩니다.\n기대효과는 원문에 명시된 경우에만 별도로 표시합니다. 미표시가 곧 현장 논의 부재를 뜻하지는 않습니다.\n\n등록 원문 (이름 제거):\n${agenda.sourceUtterances.map(clean).join('\n\n')}`);
    coverage.push({subgroup:division,ordinal:agenda.ordinal,slide:slides.length,hasEffect:Boolean(effect)});
  }
}
slide=add();
ui.header(slide,{num:'✓',kicker:'회의에서 확인할 사항',title:'다음 문장으로 정리해 주세요'});
text(slide,'어떤 문제를 바꾸고 싶습니까?',.65,1.8,8.7,.6,28,ui.P.navy,true);
text(slide,'그 변화로 어떤 모습이 되기를 바랍니까?',.65,2.75,8.7,.65,26,ui.P.navy,true);
text(slide,'동명 등록의 관계와 미작성 문안은 각 조에서 확인합니다.',.65,4.05,8.7,.6,22,ui.P.gray);
footer(slide,'문제인식과 기대효과를 각각 완성된 문장으로 정리합니다.');
slide.addNotes('중복 통합이나 운영 데이터 수정은 수행하지 않았습니다. 본 파일은 정적 스냅샷이며 이후 수정은 자동 반영되지 않습니다.');
if(coverage.length!==data.agendas.length || new Set(coverage.map(x=>`${x.subgroup}:${x.ordinal}`)).size!==data.agendas.length) throw new Error('Coverage mismatch');
fs.writeFileSync(path.join(directory,'coverage.json'),JSON.stringify({capturedAt:data.capturedAt,totalSlides:slides.length,agendas:coverage,archivedExcluded:data.archived.length},null,2));
deck.writeFile({fileName:path.join(directory,'0912_분과별_추가주제_회의용.pptx')}).then(()=>console.log(JSON.stringify({slides:slides.length,topics:coverage.length}))).catch(error=>{ console.error(error.message);process.exitCode=1;});
