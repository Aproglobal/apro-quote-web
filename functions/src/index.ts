import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import OpenAI from "openai";
import puppeteer from "puppeteer";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// ---------- 공통 ----------
const oa = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const money = (n?: number) => (n ?? 0).toLocaleString();

// ---------- 1) 견적 번호 발급 ----------
export const newQuoteNumber = onCall<{ owner?: string; client?: string }>(async (req) => {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const yearRef = db.collection("counters").doc(yy);

  const { seq, quoteNo } = await db.runTransaction(async (tx) => {
    const s = await tx.get(yearRef);
    const cur = s.exists ? (s.data()!.seq as number) : 0;
    const next = cur + 1;
    tx.set(yearRef, { seq: next }, { merge: true });
    return { seq: next, quoteNo: `${yy}-${next}-1` };
  });

  const ref = await db.collection("quotes").add({
    year: yy,
    seq,
    subSeq: 1,
    quoteNo,
    date: admin.firestore.Timestamp.fromDate(now),
    owner: req.data?.owner ?? "",
    client: req.data?.client ?? "",
    status: "draft",
  });

  return { id: ref.id, quoteNo };
});

export const newRevisionNumber = onCall<{ quoteId: string }>(async (req) => {
  const qRef = db.collection("quotes").doc(req.data.quoteId);
  const { newNo } = await db.runTransaction(async (tx) => {
    const s = await tx.get(qRef);
    if (!s.exists) throw new Error("quote not found");
    const d = s.data()!;
    const sub = (d.subSeq || 1) + 1;
    const newNo = `${d.year}-${d.seq}-${sub}`;
    tx.update(qRef, {
      subSeq: sub,
      quoteNo: newNo,
      date: admin.firestore.Timestamp.now(),
      status: "revised",
    });
    return { newNo };
  });
  return { quoteNo: newNo };
});

// ---------- 2) AI: 자연어 -> 구조화 ----------
export const aiNormalize = onCall<{ freeText: string }>(async (req) => {
  if (!oa) return { data: {} };
  const prompt = `다음 견적 요청 문장을 JSON으로 구조화.
필드: client, model, items[{qty, description, unitPrice?}],
installed[], paid[], extra[], payTerms, deliveryTerms, memo, owner?
숫자는 정수/원, 모르면 생략. JSON만 출력.

문장:
${req.data.freeText}`;
  const r = await oa.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });
  const text = r.choices[0]?.message?.content || "{}";
  return { data: JSON.parse(text) };
});

// ---------- 3) HTML 템플릿 -> PDF/PNG ----------
function rows(arr: any[], cols: string[]) {
  return (arr || [])
    .map((r) => `<tr>${cols.map((c) => `<td>${["unitPrice","amount","price"].includes(c) ? money(r[c]) : (r[c] ?? "")}</td>`).join("")}</tr>`)
    .join("");
}
function renderHtml(q: any) {
  const dateStr = q.date?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? new Date().toISOString().slice(0,10);
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
body{font-family:Pretendard,Arial,sans-serif;font-size:12px;color:#111}
h1{font-size:18px;margin:0 0 8px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #bbb;padding:6px;text-align:left}
.hdr{margin-bottom:6px}
.right{text-align:right}
</style></head><body>
<h1>견적서</h1>
<div class="hdr">견적번호: <b>${q.quoteNo||""}</b> | 일자: ${dateStr}</div>
<div class="hdr">견적대상: ${q.client||""} | 모델: ${q.model||""} | 담당: ${q.owner||""}</div>
<div class="hdr">결제조건: ${q.payTerms||""} | 납기: ${q.deliveryTerms||""}</div>

<h3>본 품목</h3>
<table><thead><tr><th>수량</th><th>품목</th><th>단가</th><th>금액</th></tr></thead>
<tbody>${rows(q.items, ["qty","description","unitPrice","amount"])}</tbody></table>

${q.installed?.length?`<h3>장착 옵션</h3>
<table><thead><tr><th>옵션</th><th class="right">금액</th></tr></thead>
<tbody>${rows(q.installed.map((x:any)=>({description:x.description,price:x.price})),["description","price"])}</tbody></table>`:""}

${q.paid?.length?`<h3>유상 옵션</h3>
<table><thead><tr><th>옵션</th><th class="right">금액</th></tr></thead>
<tbody>${rows(q.paid.map((x:any)=>({description:x.description,price:x.price})),["description","price"])}</tbody></table>`:""}

${q.extra?.length?`<h3>추가 옵션</h3>
<table><thead><tr><th>옵션</th><th class="right">금액</th></tr></thead>
<tbody>${rows(q.extra.map((x:any)=>({description:x.description,price:x.price})),["description","price"])}</tbody></table>`:""}

<h2 class="right">합계 금액: ${money(q.grandTotal||0)} 원</h2>
${q.memo?`<div>비고: ${q.memo}</div>`:""}
</body></html>`;
}

export const generatePdfAndPng = onCall<{ quoteId: string }>(async (req) => {
  const ref = db.collection("quotes").doc(req.data.quoteId);
  const s = await ref.get();
  if (!s.exists) throw new Error("quote not found");
  const q = s.data()!;
  const html = renderHtml(q);

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfBuf = await page.pdf({ format: "A4", printBackground: true, margin: { top:"14mm", bottom:"14mm", left:"14mm", right:"14mm" } });
  const pngBuf = await page.screenshot({ type: "png", fullPage: true });
  await browser.close();

  const safe = (s: string) => (s||"").replace(/[^\w가-힣.-]/g,"_");
  const base = `${safe(q.quoteNo)}_${safe(q.client)}_${safe(q.model)}`;
  const pdfPath = `quotes/${base}.pdf`;
  const pngPath = `quotes/${base}.png`;

  await bucket.file(pdfPath).save(pdfBuf, { contentType: "application/pdf" });
  await bucket.file(pngPath).save(pngBuf, { contentType: "image/png" });

  const [pdfUrl] = await bucket.file(pdfPath).getSignedUrl({ action:"read", expires: Date.now()+1000*60*60*24*30 });
  const [pngUrl] = await bucket.file(pngPath).getSignedUrl({ action:"read", expires: Date.now()+1000*60*60*24*30 });

  await ref.update({ pdfUrl, pngUrl, status: "ready" });
  return { pdfUrl, pngUrl };
});

// ---------- 4) RAG 1단계: 임베딩 + 유사 견적 ----------
function quoteToText(q:any){
  const items = (q.items||[]).map((r:any)=>`${r.qty||0}x ${r.description||""} @${r.unitPrice||0}`).join("; ");
  const i2 = (q.installed||[]).map((r:any)=>r.description).join(", ");
  const p2 = (q.paid||[]).map((r:any)=>r.description).join(", ");
  const e2 = (q.extra||[]).map((r:any)=>r.description).join(", ");
  return [
    `client:${q.client||""}`,
    `model:${q.model||""}`,
    `items:${items}`,
    i2?`installed:${i2}`:"",
    p2?`paid:${p2}`:"",
    e2?`extra:${e2}`:"",
    `payTerms:${q.payTerms||""}`,
    `deliveryTerms:${q.deliveryTerms||""}`,
    `memo:${q.memo||""}`,
  ].filter(Boolean).join("\n");
}

async function embed(text:string){
  if(!oa) throw new Error("OPENAI_API_KEY missing");
  const res = await oa.embeddings.create({ model:"text-embedding-3-small", input: text.slice(0,8000) });
  return res.data[0].embedding as unknown as number[];
}
function cosine(a:number[],b:number[]){
  let dot=0,na=0,nb=0; const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++){ const x=a[i],y=b[i]; dot+=x*y; na+=x*x; nb+=y*y; }
  return dot/(Math.sqrt(na)*Math.sqrt(nb) || 1);
}

export const onQuoteWriteEmbed = onDocumentWritten("quotes/{id}", async (e) => {
  const after = e.data?.after?.data();
  if (!after) return;
  try {
    const vec = await embed(quoteToText(after));
    await e.data!.after!.ref.update({ embedding: vec, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (err:any) {
    logger.error("[onQuoteWriteEmbed] embedding failed:", err?.message);
  }
});

export const similarQuotes = onCall<{ query?: string; limit?: number }>(async (req) => {
  const q = (req.data?.query||"").trim();
  if(!q) return { items: [] };
  const qVec = await embed(q);

  const snaps = await db.collection("quotes").orderBy("date","desc").limit(200).get();
  type Rank = { id:string; quoteNo:string; client?:string; model?:string; grandTotal?:number; date?:any; score:number };
  const ranks: Rank[] = [];
  snaps.forEach(s=>{
    const d = s.data()||{};
    if(!d.embedding) return;
    const score = cosine(qVec, d.embedding);
    ranks.push({ id: s.id, quoteNo: d.quoteNo||"", client:d.client, model:d.model, grandTotal:d.grandTotal, date:d.date, score });
  });
  ranks.sort((a,b)=>b.score-a.score);
  const top = ranks.slice(0, req.data?.limit ?? 5).map(r=>({ ...r, score: Number(r.score.toFixed(4)) }));
  return { items: top };
});
