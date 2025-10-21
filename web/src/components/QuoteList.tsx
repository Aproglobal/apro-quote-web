import React, { useEffect, useState } from 'react'
import { listRecentQuotes } from '../api'
import type { Quote } from '../types'

export default function QuoteList({ onPick }:{ onPick:(q:Quote)=>void }){
  const [items, setItems] = useState<Quote[]>([])
  useEffect(()=>{ listRecentQuotes().then(setItems) },[])
  return (
    <div className="card">
      <div className="hdr"><b>최근 견적</b><span className="badge">{items.length}</span></div>
      <table className="table">
        <thead><tr><th>견적번호</th><th>견적대상</th><th>모델</th><th className="right">합계</th><th>상태</th></tr></thead>
        <tbody>
          {items.map(it=> (
            <tr key={it.id} onClick={()=>onPick(it)} style={{cursor:'pointer'}}>
              <td><small className="mono">{it.quoteNo}</small></td>
              <td>{it.client}</td>
              <td>{it.model}</td>
              <td className="right">{(it.grandTotal||0).toLocaleString()} 원</td>
              <td>{it.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
