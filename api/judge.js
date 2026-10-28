// Aiready AI 짐 점검 - 사진 판정 서버 (Vercel 서버리스 함수)
// 환경변수: GEMINI_API_KEY (필수), GEMINI_MODEL (선택, 기본 gemini-3.5-flash-lite), GEMINI_THINKING (선택, low|high|off, 기본 low)
export const config = { maxDuration: 120 };

const RULES={
  pb:{t:"보조배터리 · 리튬배터리",x:"위탁 수하물 불가, 기내 휴대만 가능. 160Wh 이하 1인 최대 2개, 100Wh 초과~160Wh 이하는 항공사 승인 필요, 160Wh 초과는 반입 불가. 기내에서 사용·충전 금지.",s:"인천국제공항 제한물품 안내 · 국토교통부 (2026.4.20 시행)"},
  liq:{t:"액체 · 젤 · 스프레이 (국제선 기내)",x:"개별 용기당 100ml 이하, 1인당 1L 비닐 지퍼백 1개에 한해 기내 반입. 100ml 초과 용기는 위탁 수하물로(위탁은 용량 제한 없음, 인화성 제외).",s:"인천국제공항 제한물품 안내"},
  lighter:{t:"라이터 · 성냥",x:"일반 라이터 또는 안전성냥 1인 1개 기내 휴대 가능. 위탁 수하물 불가.",s:"항공 위험물 운송 기준 · 항공사 수하물 규정"},
  blade:{t:"칼 · 도검류 등 날붙이",x:"칼·도검류 등 날이 있는 물품은 기내 휴대 불가, 위탁 수하물은 가능.",s:"인천국제공항 제한물품 안내"},
  gas:{t:"인화성 가스 (부탄가스 등)",x:"인화성 가스·액체는 기내 휴대와 위탁 수하물 모두 불가.",s:"인천국제공항 제한물품 안내"},
  ecig:{t:"전자담배",x:"객실(기내) 반입만 가능하며 위탁 수하물로는 반입 불가.",s:"인천국제공항 제한물품 FAQ"},
  stick:{t:"등산용 스틱",x:"기내 반입은 가능하나, 끝이 날카로우면 객실 반입이 제한될 수 있어 위탁 수하물 권장.",s:"인천국제공항 제한물품 FAQ"},
  laptop:{t:"노트북 등 휴대용 전자기기",x:"기내 휴대 가능. 보안검색 때 가방에서 꺼내 바구니에 따로 올림.",s:"인천국제공항 제한물품 FAQ"},
  water:{t:"음료 · 물",x:"음료도 액체류 규정을 따름. 기내는 100ml 초과 음료 불가, 위탁 수하물은 가능.",s:"인천국제공항 제한물품 안내 (액체류)"},
  spr:{t:"스프레이 (위탁 수하물)",x:"인화성이 없는 스프레이류는 1개당 500ml(500g) 이하, 총 2L(2kg) 범위에서 위탁 가능.",s:"인천국제공항 제한물품 안내"}
};
function rulesText(){return Object.entries(RULES).map(([k,r])=>`[${k}] ${r.t}: ${r.x}`).join("\n");}
function buildPrompt(state){return `당신은 인천공항 출국 여객의 짐 사전점검 도우미입니다. 사진은 여객이 출국 전날 찍은 여행 가방 내부입니다. 국제선입니다. 이 가방은 ${state.mode==="k"?"위탁 수하물(카운터에서 부치는 짐)":"기내 가방(들고 타는 짐)"}입니다. 이 가방 기준으로 판정하세요. 여객은 기내 가방과 위탁 수하물을 둘 다 쓸 수 있습니다.
아래 규정만 근거로 사진 속 물품을 판정하세요.
먼저 사진을 구역별로 꼼꼼히 훑어 모든 물품을 찾으세요. 옷·수건·파우치 사이에 일부만 보이는 물건(모서리, 끝부분, 케이블, 뚜껑, 다른 색 면)도 찾아서 무엇인지 추정하세요. 예: 옷 사이로 보이는 납작하고 단단한 판 모양 → 노트북·태블릿 가능성, 원통형 금속 → 스프레이·가스 가능성. 일부만 보이는 물품은 visibility="일부 가려짐"으로 표시하세요.
옷·책·충전 케이블처럼 규정과 무관한 것이 확실한 물품만 생략하세요. 판정할 물품이 없으면 빈 배열을 반환하세요.
액체·젤·스프레이 용량은 다음 순서로 판단하세요:
1) 라벨에 용량 숫자가 보이면 그 숫자를 씁니다 (basis="라벨 확인").
2) 숫자가 안 보이지만 브랜드·제품을 알아보면, 알고 있는 그 제품의 출시 용량을 참고합니다. 출시 용량이 모두 100ml 이하이거나 모두 초과면 판정하고, 100ml 양쪽에 걸치면 3)으로 갑니다 (basis="제품 인식").
3) 사진 속 다른 물건과 크기를 비교해 확실히 작거나 확실히 클 때만 판정합니다 (basis="크기 추정").
4) 그래도 애매하면 cat="chk"로 두고 용기 바닥의 용량 표기를 확인하도록 안내합니다 (basis="판단 보류").
규정은 내용물이 아니라 용기 용량 기준입니다. 남은 양으로 판단하지 마세요.
분류(cat): ok=이 가방에 그대로 둬도 됨, mv=이 가방에는 안 되지만 다른 가방(${state.mode==="k"?"기내 가방":"위탁 수하물"})으로 옮기면 됨, ban=기내·위탁 모두 불가, chk=사진만으로 판단 어려움(용량·종류 확인 필요). 물품이 무엇인지 알아볼 수 있으면 확정 판정하세요(ok/mv/ban). 예: 칼·가위 등 날붙이, 부탄가스·라이터 연료통, 라벨이나 크기로 100ml를 확실히 넘는 액체, 위탁 가방 속 보조배터리·라이터·전자담배는 확정입니다. chk는 판정에 꼭 필요한 정보가 사진에 없을 때만 쓰고(예: 100ml 근처라 용량을 알 수 없음, 배터리 Wh 미표기, 물건이 무엇인지 알 수 없을 만큼 가려짐), 무엇을 확인해야 하는지 action에 구체적으로 쓰세요. 일부 가려졌어도 무엇인지 알아볼 수 있으면 확정 판정하세요.${state.mode==="k"?" 위탁 수하물에서는 액체 100ml 제한이 적용되지 않습니다(스프레이는 개당 500ml, 인화성 불가). 액체는 basis를 생략해도 됩니다.":""}
규정:
${rulesText()}

다음 형식의 JSON 배열만 답하세요. 각 문장은 한국어, 짧고 구체적으로.
[{"name":"물품명(보이는 용량 포함)","cat":"ok|mv|ban|chk","rule":"규정 키(pb, liq 등)","reason":"판정 이유 1문장","action":"여객이 할 일 1문장","stage":"home|checkin|security","basis":"액체류만: 라벨 확인|제품 인식|크기 추정|판단 보류","bnote":"액체류만: 용량을 그렇게 판단한 근거 1문장(인식한 제품명·출시 용량 포함)","visibility":"전체|일부 가려짐","where":"사진 속 위치(예: 왼쪽 아래 옷 사이)"}]`;}

function parseJSON(text){
  const t=String(text||"").trim();
  try{return JSON.parse(t);}catch(e){}
  const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1]);}catch(e){}}
  const a=t.indexOf("["),b=t.lastIndexOf("]");if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1));}catch(e){}}
  return null;
}

export default async function handler(req,res){
  const key=process.env.GEMINI_API_KEY;
  const model=process.env.GEMINI_MODEL||"gemini-3.5-flash-lite";
  res.setHeader("Cache-Control","no-store");
  if(req.method==="GET"){return res.status(200).json({ok:!!key,model});}
  if(req.method!=="POST"){return res.status(405).json({code:"invalid_request"});}
  if(!key){return res.status(503).json({code:"no_key"});}
  let body=req.body;
  if(typeof body==="string"){try{body=JSON.parse(body);}catch(e){body=null;}}
  const mode=body&&body.mode==="k"?"k":"c";
  const image=body&&typeof body.image==="string"?body.image:"";
  const mime=body&&/^image\/(jpeg|png|webp)$/.test(body.mime||"")?body.mime:"image/jpeg";
  if(!image){return res.status(400).json({code:"bad_image"});}
  if(image.length>4_000_000){return res.status(413).json({code:"too_large"});}
  try{
    const call=(gen)=>fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:"POST",
      headers:{"content-type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({
        contents:[{role:"user",parts:[{inline_data:{mime_type:mime,data:image}},{text:buildPrompt({mode})}]}],
        generationConfig:gen
      })
    });
    const base={responseMimeType:"application/json"};
    const think=process.env.GEMINI_THINKING||"low";
    // 빠른 응답을 위해 생각 단계를 줄여서 먼저 요청하고, 모델이 이 옵션을 모르면 옵션 없이 다시 요청
    let r=await call(think==="off"?base:{...base,thinkingConfig:{thinkingLevel:think}});
    if(r.status===400&&think!=="off"){r=await call(base);}
    const d=await r.json().catch(()=>null);
    if(!r.ok){
      console.error("gemini error",r.status,JSON.stringify(d).slice(0,500));
      const code=r.status===429?"rate_limited":r.status===404?"model_missing":(r.status===401||r.status===403)?"no_key":r.status===400?"bad_image":"upstream_error";
      return res.status(r.status===429?429:502).json({code});
    }
    const cand=d&&d.candidates&&d.candidates[0];
    const text=cand&&cand.content&&cand.content.parts?cand.content.parts.map(p=>p.text||"").join(""):"";
    const out=parseJSON(text);
    if(out==null){return res.status(502).json({code:"invalid_json"});}
    const items=Array.isArray(out)?out:(Array.isArray(out.items)?out.items:[]);
    return res.status(200).json({items:items.slice(0,15)});
  }catch(e){
    console.error(e);
    return res.status(502).json({code:"upstream_error"});
  }
}
