import React, { useMemo, useState } from 'react'
import type { Quote, Item, Opt } from '../types'
import ItemsTable from './ItemsTable'
import OptionList from './OptionList'
import { call } from '../firebase'
import { patchQuote } from '../api'

function sumItems(items: Item[]){ return (items||[]).reduce((a,b)=> a + (Number(b.amount)||0), 0) }
function sumOpts(arr: Opt[]){ return (arr||[]).reduce((a,b)=> a + (Number(b.price)||0), 0) }

export default function QuoteForm(){
  const [qid,setQid] = useState<string>('')
  const [q,setQ] = useState<Quote>({ items:[{qty:1,description:'',unitPrice:0,amount:0}], installed:[], paid:[], extra:[] })
  const [free,setFree] = useState('')
  const [busy,setBusy] = useState(false)

  const total = useMemo(()=> sumItems(q.items||[]) + sumOpts(q.installed||[]) + sumOpts(q.paid||[]) + sumOpts(q.extra||[]), [q])
  const setField = (k: keyof Quote, v: any) => setQ(prev => ({ ...prev, [k]: v }))

  const fromAI = async () => {
    if(!free.trim()) return
    setBusy(true)
    try{
      const r = await call.aiNormalize({ freeText: free })
      // @ts-ignore
      const data = r.data?.data || {}
      const items: Item[] = (data.items||[]).map((it:any)=> ({
        qty:Number(it.qty)||1,
        description: String(it.description||''),
        unitPrice: Number(it.unitPrice)||0,
        amount: (Number(it.qty)||0) * (Number(it.unitPrice)||0)
      }))
      const mapOpt = (arr:any[]): Opt[] => (arr||[]).map(x=> ({ description:String(x.description||''), price:Number(x.price||0) }))
      setQ(prev=> ({
        ...prev,
        client: data.client ?? prev.client,
        model: data.model ?? prev.model,
        items: items.length? items: prev.items,
        installed: mapOpt(data.installed||prev.installed||[]),
        paid: mapOpt(data.paid||prev.paid||[]),
        extra: mapOpt(data.extra||prev.extra||[]),
        payTerms: data.payTerms ?? prev.payTerms,
        deliveryTerms: data.deliveryTerms ?? prev.deliveryTerms,
        memo: data.memo ?? prev.memo
      }))
    } finally{ setBusy(false) }
  }

  const issueNo = async () => {
    setBusy(true)
    try{
      const r = await call.newQuoteNumber({ owner: q.owner||'', client: q.client||'' })
      // @ts-ignore
      const { id, quoteNo } = r.data || {}
      setQid(id)
      setQ(prev=> ({ ...prev, quoteNo }))
    } finally{ setBusy(false) }
  }

  const reviseNo = async () => {
    if(!qid) return
    setBusy(true)
    try{
      const r = await call.newRevisionNumber({ quoteId: qid })
      // @ts-ignore
      const { quoteNo } = r.data || {}
      setQ(prev=> ({ ...prev, quoteNo }))
    } finally{ setBusy(false) }
  }

  const saveCalc = async () => {
    if(!qid){ alert('먼저 견적번호를 발급하세요.'); return }
    const grandTotal = total
    setBusy(true)
    try{
      await patchQuote(qid, { ...q, grandTotal })
      alert('저장 완료')
    } finally{ setBusy(false) }
  }

  const makePdfPng = async () => {
    if(!qid){ alert('먼저 견적번호를 발급하고 저장하세요.'); return }
    setBusy(true)
    try{
      const r = await call.generatePdfAndPng({ quoteId: qid })
      // @ts-ignore
      const { pdfUrl, pngUrl } = r.data || {}
      setQ(prev=> ({ ...prev, pdfUrl, pngUrl }))
    } finally{ setBusy(false) }
  }

  return (
    <div className="card">
      <div className="hdr"><b>견적 작성</b>{busy && <span className="badge">작업중…</span>}</div>

      <div className="row">
        <label>견적번호
          <input value={q.quoteNo||''} placeholder="예: 25-672-1" onChange={e=>setField('quoteNo', e.target.value)} disabled />
        </label>
        <label>일자
          <input value={(q.date?._seconds? new Date(q.date._seconds*1000): new Date()).toISOString().slice(0,10)} disabled />
        </label>
        <label>견적대상
          <input value={q.client||''} onChange={e=>setField('client', e.target.value)} placeholder="고객/회사명" />
        </label>
        <label>견적 모델
          <input value={q.model||''} onChange={e=>setField('model', e.target.value)} placeholder="예: G2 전자유도 5인승 리튬" />
        </label>
        <label>견적 담당자
          <input value={q.owner||''} onChange={e=>setField('owner', e.target.value)} placeholder="담당자명" />
        </label>
        <label>결제조건
          <input value={q.payTerms||''} onChange={e=>setField('payTerms', e.target.value)} placeholder="예: 발주 후 30일 이내" />
        </label>
        <label>납기
          <input value={q.deliveryTerms||''} onChange={e=>setField('deliveryTerms', e.target.value)} placeholder="예: 계약 후 2주" />
        </label>
        <label>비고
          <textarea value={q.memo||''} onChange={e=>setField('memo', e.target.value)} placeholder="특이사항" />
        </label>
      </div>

      <ItemsTable items={q.items||[]} onChange={(items)=> setQ(prev=> ({...prev, items}))} />
      <OptionList title="장착 옵션" rows={q.installed||[]} onChange={(installed)=> setQ(prev=> ({...prev, installed}))} />
      <OptionList title="유상 옵션" rows={q.paid||[]} onChange={(paid)=> setQ(prev=> ({...prev, paid}))} />
      <OptionList title="추가 옵션" rows={q.extra||[]} onChange={(extra)=> setQ(prev=> ({...prev, extra}))} />

      <div className="card">
        <div className="hdr"><b>합계 금액</b><span className="badge">자동 계산</span></div>
        <div className="kv"><h2>{total.toLocaleString()} 원</h2></div>
      </div>

      <div className="card">
        <div className="hdr"><b>자연어 요청을 붙여넣기 → AI로 구조화</b></div>
        <textarea value={free} onChange={e=>setFree(e.target.value)} placeholder="예: OOCC 골프장 G2 전자유도 5인승 8대, 장착옵션 ○○, 유상옵션 ○○, 납기 계약 후 2주, 결제조건 발주 후 30일…" />
        <div className="btns" style={{marginTop:8}}>
          <button className="btn" onClick={fromAI}>AI 파싱</button>
        </div>
      </div>

      <div className="btns">
        <button className="btn" onClick={issueNo}>① 견적번호 발급</button>
        <button className="btn secondary" onClick={reviseNo} disabled={!qid}>개정번호 ↑</button>
        <button className="btn" onClick={saveCalc} disabled={!qid}>② 저장(합계 반영)</button>
        <button className="btn" onClick={makePdfPng} disabled={!qid}>③ PDF/PNG 생성</button>
      </div>

      {(q.pngUrl||q.pdfUrl) && (
        <div className="card">
          <div className="hdr"><b>내보내기</b></div>
          <div className="kv">
            {q.pngUrl && <a className="btn secondary" href={q.pngUrl} target="_blank">PNG 열기</a>}
            {q.pdfUrl && <a className="btn secondary" href={q.pdfUrl} target="_blank">PDF 열기</a>}
            {q.quoteNo && <span className="badge">파일명 기준: {q.quoteNo}</span>}
          </div>
        </div>
      )}

      {qid && <small className="mono">quoteId: {qid}</small>}
    </div>
  )
}
