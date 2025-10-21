import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Sparkles, RefreshCcw, Undo2, Save, ChevronDown, Search } from "lucide-react";

/**
 * LiveQuoteStudio
 * ------------------------------------------------------------
 * 목표: 좌측에서 모델 선택 → 중앙에 기본 견적 프리뷰 → 우측에서 AI와 채팅하며
 * JSON Patch(유사) 변경을 실시간으로 견적서에 반영하고, 변경점 하이라이트/애니메이션.
 * 실제 연동 시에는 callAiNormalize() 부분만 Firebase Functions HTTP로 교체하면 됩니다.
 * - onQuoteWriteEmbed / similarQuotes 등은 저장 이후 비동기로 사용 권장.
 *
 * 디자인: Tailwind 기반. 프레임워크 의존성 최소화. (shadcn/ui 없이도 작동)
 * ------------------------------------------------------------
 */

// ------------------------ Types ------------------------

type Series = "G2" | "G3" | "G20" | "ST20";

type ModelAttrs = {
  courseName: string; // 골프장명
  date: string; // 예: 25.00.00
  series: Series;
  deck?: "롱데크" | "숏데크" | "수동" | "전자유도";
  seats?: number; // 정수만 저장 (VIP/세미 등은 variant)
  seatLabel?: string; // 원본 표기 (예: VIP 4인승)
  battery?: "리튬" | "액상" | "배터리 미포함";
  variant?: string; // VIP, 세미 6인승(T1/T2) 등
  raw: string; // 원본 모델명
};

type QuoteItem = {
  id: string;
  label: string;
  qty: number;
  unitPrice: number; // KRW
  total: number; // computed: qty * unitPrice
  meta?: string;
};

type Quote = {
  id: string;
  title: string; // 화면 상단 타이틀
  model: ModelAttrs;
  items: QuoteItem[];
  subtotal: number;
  vatRate: number; // 0.1 for 10%
  vat: number;
  total: number;
  notes?: string;
  revision: number;
  updatedAt: number; // epoch ms
};

// RFC6902 과 매우 유사한 형태로 사용 (필요 시 라이브러리 교체)
export type PatchOp = {
  op: "replace" | "add" | "remove";
  path: string; // 예: /model/seats, /items/0/qty
  value?: any;
};

// ------------------------ Data ------------------------

const RAW_MODELS = [
  "골프장명(25.00.00)_G2_롱데크(장축)_2인승_리튬",
  "골프장명(25.00.00)_G2_롱데크_2인승_리튬",
  "골프장명(25.00.00)_G2_롱데크_2인승_액상",
  "골프장명(25.00.00)_G2_숏데크_5인승_리튬",
  "골프장명(25.00.00)_G2_수동_5인승 역방향_리튬",
  "골프장명(25.00.00)_G2_수동_5인승_리튬",
  "골프장명(25.00.00)_G2_수동_8인승_리튬",
  "골프장명(25.00.00)_G2_수동_11인승_리튬",
  "골프장명(25.00.00)_G2_전자유도_5인승_리튬",
  "골프장명(25.00.00)_G2_전자유도_5인승_배터리 미포함",
  "골프장명(25.00.00)_G2_전자유도_5인승_액상",
  "골프장명(25.00.00)_G2_전자유도_8인승_리튬",
  "골프장명(25.00.00)_G2_전자유도_VIP 4인승_액상",
  "골프장명(25.00.00)_G2_전자유도_VIP 6인승_리튬",
  "골프장명(25.00.00)_G2_전자유도_세미 6인승(T1)_리튬",
  "골프장명(25.00.00)_G2_전자유도_세미 6인승(T2)_리튬",
  "골프장명(25.00.00)_G3_롱데크_2인승_리튬",
  "골프장명(25.00.00)_G3_전자유도_5인승_리튬",
  "골프장명(25.00.00)_G20_2인승_리튬",
  "골프장명(25.00.00)_G20_2인승_액상",
  "골프장명(25.00.00)_ST20_2인승_리튬",
  "골프장명(25.00.00)_ST20_2인승_액상",
];

// ------------------------ Utils ------------------------

const KRW = (v: number) =>
  new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(v);

const now = () => Date.now();

function parseModel(raw: string): ModelAttrs {
  // 예: "골프장명(25.00.00)_G2_전자유도_VIP 6인승_리튬"
  const courseMatch = raw.match(/^(.*?)\(([^)]+)\)/);
  const courseName = courseMatch?.[1]?.trim() ?? "";
  const date = courseMatch?.[2] ?? "";
  // 시리즈 추출
  const seriesMatch = raw.match(/_(G2|G3|G20|ST20)_/);
  const series = (seriesMatch?.[1] as Series) ?? "G2";

  // 데크/구동 타입 추출
  let deck: ModelAttrs["deck"]; // 롱데크, 숏데크, 수동, 전자유도
  if (/전자유도/.test(raw)) deck = "전자유도";
  else if (/수동/.test(raw)) deck = "수동";
  else if (/롱데크/.test(raw)) deck = "롱데크";
  else if (/숏데크/.test(raw)) deck = "숏데크";

  // 좌석
  let seatLabel: string | undefined;
  let seats: number | undefined;
  const vipMatch = raw.match(/VIP\s*(\d+)인승/);
  const semiMatch = raw.match(/세미\s*(\d+)인승\((T\d)\)/);
  const stdSeatMatch = raw.match(/_(\d+)인승(?!\))/); // 역방향, VIP 등 제외

  if (vipMatch) {
    seats = parseInt(vipMatch[1], 10);
    seatLabel = `VIP ${seats}인승`;
  } else if (semiMatch) {
    seats = parseInt(semiMatch[1], 10);
    seatLabel = `세미 ${seats}인승(${semiMatch[2]})`;
  } else if (stdSeatMatch) {
    seats = parseInt(stdSeatMatch[1], 10);
    seatLabel = `${seats}인승`;
  }

  // 배터리
  let battery: ModelAttrs["battery"]; // 리튬/액상/배터리 미포함
  if (/리튬/.test(raw)) battery = "리튬";
  else if (/액상/.test(raw)) battery = "액상";
  else if (/배터리 미포함/.test(raw)) battery = "배터리 미포함";

  // 기타 variant (VIP, 세미, 역방향)
  let variant = undefined as string | undefined;
  if (/VIP/.test(raw)) variant = seatLabel; // VIP n인승
  if (/세미/.test(raw)) variant = seatLabel; // 세미 6인승(T1/T2)
  if (/역방향/.test(raw)) variant = variant ? `${variant}, 역방향` : "역방향";

  return { courseName, date, series, deck, seats, seatLabel, battery, variant, raw };
}

function priceBook(model: ModelAttrs) {
  // ⚠️ 임시 단가표 (POC): 실제 단가는 서버/Firestore에서 관리하세요.
  // series base
  const seriesBase: Record<Series, number> = { G2: 11_000_000, G3: 13_000_000, G20: 9_000_000, ST20: 8_500_000 };
  let base = seriesBase[model.series] ?? 10_000_000;

  // deck / guidance
  if (model.deck === "롱데크") base += 500_000;
  if (model.deck === "전자유도") base += 3_000_000;

  // seats
  if (model.seats && model.seats > 2) base += (model.seats - 2) * 400_000; // 좌석 추가 가산

  // battery
  let batteryLine = 0;
  if (model.battery === "리튬") batteryLine = 2_000_000;
  if (model.battery === "액상") batteryLine = 1_000_000;
  if (model.battery === "배터리 미포함") batteryLine = 0;

  return { base, batteryLine };
}

function buildBaseQuote(model: ModelAttrs): Quote {
  const { base, batteryLine } = priceBook(model);
  const items: QuoteItem[] = [
    { id: "vehicle", label: `${model.series} 기본차량${model.deck ? ` (${model.deck})` : ""}`, qty: 1, unitPrice: base, total: base },
    { id: "battery", label: `배터리 ${model.battery ?? "선택"}`, qty: 1, unitPrice: batteryLine, total: batteryLine },
  ];
  if (model.variant) {
    const v = 600_000; // VIP/세미 옵션 가산 예시
    items.push({ id: "variant", label: `옵션: ${model.variant}`, qty: 1, unitPrice: v, total: v });
  }

  const subtotal = items.reduce((s, it) => s + it.total, 0);
  const vatRate = 0.1;
  const vat = Math.round(subtotal * vatRate);
  const total = subtotal + vat;

  return {
    id: cryptoRandomId(),
    title: `${model.courseName} ${model.series} 견적서`,
    model,
    items,
    subtotal,
    vatRate,
    vat,
    total,
    notes: "※ 상기 금액은 예시 단가입니다. 실제 견적은 프로젝트 조건에 따라 변동될 수 있습니다.",
    revision: 1,
    updatedAt: now(),
  };
}

function recalc(q: Quote): Quote {
  const items = q.items.map((it) => ({ ...it, total: Math.max(0, Math.round(it.qty * it.unitPrice)) }));
  const subtotal = items.reduce((s, it) => s + it.total, 0);
  const vat = Math.round(subtotal * q.vatRate);
  const total = subtotal + vat;
  return { ...q, items, subtotal, vat, total, updatedAt: now() };
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return (crypto as any).randomUUID();
  return Math.random().toString(36).slice(2);
}

// 간단한 Patch 적용기 (RFC6902 중 일부만)
function applyPatch(q: Quote, ops: PatchOp[]): Quote {
  let next: any = JSON.parse(JSON.stringify(q));
  for (const op of ops) {
    const path = op.path.replace(/^\//, "");
    const parts = path.split("/");
    let cur = next;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!(key in cur)) cur[key] = {};
      cur = cur[key];
    }
    const last = parts[parts.length - 1];
    if (op.op === "replace" || op.op === "add") {
      cur[last] = op.value;
    } else if (op.op === "remove") {
      if (Array.isArray(cur)) cur.splice(Number(last), 1);
      else delete cur[last];
    }
  }
  return recalc(next as Quote);
}

// 채팅 메시지를 간단 파서로 Patch로 변환 (POC). 실제로는 Functions(\"aiNormalize\") 호출 권장.
async function callAiNormalizePOC(userText: string, q: Quote): Promise<PatchOp[]> {
  const ops: PatchOp[] = [];

  // 좌석 변경: "6인승", "좌석 8", "8명"
  const seatMatch = userText.match(/(\d+)\s*(?:인승|명|좌석)/);
  if (seatMatch) {
    const seats = parseInt(seatMatch[1], 10);
    ops.push({ op: "replace", path: "/model/seats", value: seats });
    ops.push({ op: "replace", path: "/model/seatLabel", value: `${seats}인승` });
    // 좌석 반영 가산: base 재계산 유도 위해 vehicle unitPrice 약간 조정 로직은 priceBook이 커버 (모델 변경 시 재빌드가 정석)
  }

  // 배터리: 리튬/액상/미포함
  if (/리튬/.test(userText)) ops.push({ op: "replace", path: "/model/battery", value: "리튬" });
  if (/액상/.test(userText)) ops.push({ op: "replace", path: "/model/battery", value: "액상" });
  if (/미포함/.test(userText)) ops.push({ op: "replace", path: "/model/battery", value: "배터리 미포함" });

  // 전자유도 / 수동 / 롱데크 / 숏데크
  if (/전자유도/.test(userText)) ops.push({ op: "replace", path: "/model/deck", value: "전자유도" });
  if (/수동/.test(userText)) ops.push({ op: "replace", path: "/model/deck", value: "수동" });
  if (/롱데크/.test(userText)) ops.push({ op: "replace", path: "/model/deck", value: "롱데크" });
  if (/숏데크/.test(userText)) ops.push({ op: "replace", path: "/model/deck", value: "숏데크" });

  // 수량/단가 변경 (예: "배터리 2개", "가이드 시스템 -30만원")
  const qtyMatch = userText.match(/(배터리|battery).*?(\d+)\s*개/);
  if (qtyMatch) {
    const qty = parseInt(qtyMatch[2], 10);
    const idx = q.items.findIndex((i) => i.id === "battery");
    if (idx >= 0) ops.push({ op: "replace", path: `/items/${idx}/qty`, value: qty });
  }

  const unitMinusMatch = userText.match(/(\-|–|—)\s*(\d+)\s*만?원?/); // "-30만원"
  if (unitMinusMatch) {
    const delta = parseInt(unitMinusMatch[2], 10) * 10_000 * -1;
    ops.push({ op: "replace", path: "/items/0/unitPrice", value: Math.max(0, q.items[0].unitPrice + delta) });
  }

  // 단순 노트 추가
  if (/메모|노트|비고/.test(userText)) {
    const note = userText.replace(/[\s\S]*?(메모|노트|비고)[:：]?\s*/i, "").trim();
    if (note) ops.push({ op: "replace", path: "/notes", value: `${q.notes ? q.notes + "\n" : ""}${note}` });
  }

  // 모델 구조가 바뀌면 base 재빌드를 권장. 여기서는 patch 후 recalc로 충분히 보이도록 설계.
  return ops;
}

// ------------------------ UI ------------------------

export default function LiveQuoteStudio() {
  const models = useMemo(() => RAW_MODELS.map(parseModel), []);
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () =>
      models.filter((m) =>
        [m.raw, m.series, m.deck ?? "", m.seatLabel ?? "", m.battery ?? ""].some((x) => x.toLowerCase().includes(filter.toLowerCase())),
      ),
    [models, filter],
  );

  const [quote, setQuote] = useState<Quote | null>(null);
  const [baseQuote, setBaseQuote] = useState<Quote | null>(null); // Reset 용 원본
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string; patch?: PatchOp[] }[]>([]);
  const [input, setInput] = useState("");
  const [autoApply, setAutoApply] = useState(true);
  const [busy, setBusy] = useState(false);

  // 모델 클릭 → 기본 견적 생성
  const handlePick = (m: ModelAttrs) => {
    const q = buildBaseQuote(m);
    setQuote(q);
    setBaseQuote(q);
    setMessages([]);
  };

  const handleSend = async () => {
    if (!input.trim() || !quote) return;
    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userText }]);

    setBusy(true);
    try {
      // 실제 연동: Firebase Functions HTTPS Callable/REST → JSON Patch
      const ops = await callAiNormalizePOC(userText, quote);
      const nextQ = ops.length ? applyPatch(quote, ops) : quote;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: ops.length ? "변경안을 반영했습니다." : "변경사항이 없어요.", patch: ops },
      ]);
      if (autoApply && ops.length) setQuote(nextQ);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyPatch = (patch?: PatchOp[]) => {
    if (!quote || !patch?.length) return;
    setQuote((q) => (q ? applyPatch(q, patch) : q));
  };

  const handleReset = () => {
    if (baseQuote) {
      setQuote(baseQuote);
      setMessages([]);
    }
  };

  const handleUndo = () => {
    // 간단 Undo: 마지막 assistant patch를 되돌림 (실서비스는 patch 스택 관리 추천)
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.patch?.length);
    if (!last || !quote || !baseQuote) return;
    // 안전하게: base → 최근 assistant 이전까지 재적용
    const idx = messages.lastIndexOf(last);
    const replay = messages.slice(0, idx).filter((m) => m.role === "assistant" && m.patch?.length).map((m) => m.patch!);
    let q = baseQuote;
    for (const p of replay) q = applyPatch(q, p);
    setQuote(q);
    setMessages((prev) => prev.slice(0, idx));
  };

  return (
    <div className="w-full h-screen bg-neutral-50 text-neutral-900 grid grid-cols-[340px_1fr_380px]">
      {/* Left: Model Picker */}
      <aside className="border-r bg-white p-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5" />
          <h2 className="font-semibold text-lg">모델 선택</h2>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="시리즈/데크/좌석/배터리 검색"
            className="w-full pl-9 pr-3 py-2 rounded-xl border bg-neutral-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
        <ul className="space-y-2">
          {filtered.map((m) => (
            <li key={m.raw}>
              <button
                onClick={() => handlePick(m)}
                className="w-full text-left rounded-xl border hover:border-emerald-400 hover:shadow-sm bg-white p-3 transition"
              >
                <div className="text-sm font-semibold">{m.raw}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {m.series} · {m.deck ?? "-"} · {m.seatLabel ?? "-"} · {m.battery ?? "-"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Center: Quote Preview */}
      <main className="p-6 overflow-y-auto">
        {!quote ? (
          <div className="h-full flex items-center justify-center text-neutral-400">
            좌측에서 모델을 선택하면 기본 견적서가 생성됩니다.
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold">{quote.title}</h1>
                <p className="text-sm text-neutral-500 mt-1">
                  {quote.model.courseName} · {quote.model.date} · {quote.model.series} · {quote.model.deck ?? "-"} ·
                  {" "}
                  {quote.model.seatLabel ?? "-"} · {quote.model.battery ?? "-"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 bg-white hover:bg-neutral-50"
                >
                  <RefreshCcw className="w-4 h-4" /> 초기화
                </button>
                <button
                  onClick={handleUndo}
                  className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 bg-white hover:bg-neutral-50"
                >
                  <Undo2 className="w-4 h-4" /> 되돌리기
                </button>
                <button className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  <Save className="w-4 h-4" /> 저장
                </button>
              </div>
            </div>

            {/* Paper-like preview */}
            <div className="bg-white rounded-2xl shadow-sm border p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm text-neutral-500">견적 번호</div>
                  <div className="font-mono text-sm">{quote.id.slice(0, 8).toUpperCase()}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-neutral-500">개정</div>
                  <div className="font-semibold">Rev. {quote.revision}</div>
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 border-b">
                    <th className="py-2">항목</th>
                    <th className="py-2 w-20 text-right">수량</th>
                    <th className="py-2 w-36 text-right">단가</th>
                    <th className="py-2 w-36 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {quote.items.map((it) => (
                      <motion.tr
                        key={it.id}
                        initial={{ backgroundColor: "#f0fdf4" }}
                        animate={{ backgroundColor: "#ffffff" }}
                        transition={{ duration: 0.8 }}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-2">
                          <div className="font-medium">{it.label}</div>
                          {it.meta && <div className="text-xs text-neutral-500">{it.meta}</div>}
                        </td>
                        <td className="py-2 text-right">{it.qty}</td>
                        <td className="py-2 text-right">{KRW(it.unitPrice)}</td>
                        <td className="py-2 text-right font-medium">{KRW(it.total)}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>

              <div className="mt-6 flex flex-col items-end gap-1">
                <div className="flex items-center gap-8">
                  <div className="text-neutral-500">소계</div>
                  <div className="font-semibold">{KRW(quote.subtotal)}</div>
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-neutral-500">부가세 ({Math.round(quote.vatRate * 100)}%)</div>
                  <div className="font-semibold">{KRW(quote.vat)}</div>
                </div>
                <div className="flex items-center gap-8 text-lg">
                  <div className="text-neutral-700 font-semibold">합계</div>
                  <div className="font-bold">{KRW(quote.total)}</div>
                </div>
              </div>

              {quote.notes && (
                <div className="mt-6 bg-neutral-50 border rounded-xl p-3 text-xs text-neutral-600 whitespace-pre-wrap">
                  {quote.notes}
                </div>
              )}

              <div className="mt-4 text-[11px] text-neutral-400 text-right">
                업데이트: {new Date(quote.updatedAt).toLocaleString("ko-KR")}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Right: Chat */}
      <aside className="border-l bg-white h-full grid grid-rows-[auto_1fr_auto]">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            <div className="font-semibold">AI 대화</div>
          </div>
          <button
            onClick={() => setAutoApply((v) => !v)}
            className={`text-xs px-2 py-1 rounded-lg border ${
              autoApply ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-neutral-50 text-neutral-600"
            }`}
          >
            {autoApply ? "자동반영 켜짐" : "자동반영 꺼짐"}
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          {!quote && <div className="text-sm text-neutral-400">먼저 모델을 선택하세요.</div>}
          {quote && messages.length === 0 && (
            <div className="text-sm text-neutral-500">
              예) "6인승으로 바꿔줘", "배터리는 리튬으로", "전자유도로 변경", "비고: 납기 4주"
            </div>
          )}
          {messages.map((m, idx) => (
            <div key={idx} className={`rounded-xl p-3 border ${m.role === "user" ? "bg-neutral-50" : "bg-emerald-50"}`}>
              <div className="text-xs text-neutral-500 mb-1">{m.role === "user" ? "나" : "AI"}</div>
              <div className="text-sm whitespace-pre-wrap">{m.text}</div>
              {m.patch?.length ? (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer flex items-center gap-1">
                    <ChevronDown className="w-3 h-3" /> 적용된 변경({m.patch.length})
                  </summary>
                  <ul className="mt-1 list-disc pl-4 space-y-1 text-neutral-600">
                    {m.patch.map((p, i) => (
                      <li key={i}>
                        <code className="bg-white border px-1 rounded">{p.op}</code> <span className="text-neutral-500">{p.path}</span>
                        {typeof p.value !== "undefined" && <span> → {JSON.stringify(p.value)}</span>}
                      </li>
                    ))}
                  </ul>
                  {!autoApply && (
                    <button
                      onClick={() => handleApplyPatch(m.patch)}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border px-2 py-1 bg-white hover:bg-neutral-50"
                    >
                      반영하기
                    </button>
                  )}
                </details>
              ) : null}
            </div>
          ))}
        </div>

        <div className="p-3 border-t">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!quote || busy}
              placeholder={quote ? "예: 6인승으로 바꿔줘 / 배터리는 리튬" : "먼저 모델을 선택하세요"}
              className="flex-1 rounded-xl border px-3 py-2 bg-neutral-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!quote || busy}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" /> 보내기
            </button>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">실서비스에선 Firebase Functions(aiNormalize)을 호출하세요.</div>
        </div>
      </aside>
    </div>
  );
}
