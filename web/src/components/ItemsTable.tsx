import React from 'react'
import type { Item } from '../types'

type Props = {
  items: Item[]
  onChange: (next: Item[]) => void
}

export default function ItemsTable({ items, onChange }: Props) {
  const set = (i: number, key: keyof Item, val: any) => {
    const next = items.map((r, idx) => idx === i ? { ...r, [key]: key === 'description' ? String(val) : Number(val) } : r)
    next[i].amount = (Number(next[i].qty) || 0) * (Number(next[i].unitPrice) || 0)
    onChange(next)
  }
  const add = () => onChange([...items, { qty: 1, description: '', unitPrice: 0, amount: 0 }])
  const del = (i: number) => onChange(items.filter((_, idx) => idx !== i))

  return (
    <div className="card">
      <div className="hdr"><b>본 품목</b><button className="btn secondary" onClick={add}>행 추가</button></div>
      <table className="table">
        <thead>
          <tr><th style={{width:88}}>수량</th><th>품목</th><th style={{width:120}}>단가</th><th style={{width:120}}>금액</th><th style={{width:70}}></th></tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i}>
              <td><input type="number" value={r.qty||0} onChange={e=>set(i,'qty', e.target.value)} /></td>
              <td><input value={r.description||''} onChange={e=>set(i,'description', e.target.value)} placeholder="예: G2 전자유도 5인승" /></td>
              <td className="right"><input type="number" value={r.unitPrice||0} onChange={e=>set(i,'unitPrice', e.target.value)} /></td>
              <td className="right"><input disabled value={r.amount||0} /></td>
              <td><button className="btn secondary" onClick={()=>del(i)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
