import React, { useState } from 'react'
import { call } from '../firebase'

export default function SimilarFinder(){
  const [q,setQ] = useState('')
  const [res,setRes] = useState<any[]>([])
  const run = async ()=>{
    if(!q.trim()) return
    const r = await call.similarQuotes({ query:q, limit:8 })
    // @ts-ignore
    setRes(r.data?.items||[])
  }
  return (
    <div className="card">
      <div className="hdr"><b>유사 견적 찾기 (RAG)</b></div>
      <div className="row">
        <label>검색어
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="예: G2 전자유도 5인승 리튬, 장착옵션 ..." />
        </label>
      </div>
      <div className="btns" style={{marginTop:8}}>
        <button className="btn" onClick={run}>검색</button>
      </div>
      {res.length>0 && (
        <table className="table" style={{marginTop:10}}>
          <thead><tr><th>견적번호</th><th>대상</th><th>모델</th><th className="right">합계</th><th className="right">유사도</th></tr></thead>
          <tbody>
            {res.map((r,i)=> (
              <tr key={i}>
                <td><small className="mono">{r.quoteNo}</small></td>
                <td>{r.client}</td>
                <td>{r.model}</td>
                <td className="right">{(r.grandTotal||0).toLocaleString()}</td>
                <td className="right">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
