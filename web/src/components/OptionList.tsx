import React from 'react'
import type { Opt } from '../types'

type Props = {
  title: string
  rows: Opt[]
  onChange: (next: Opt[]) => void
}

export default function OptionList({ title, rows, onChange }: Props){
  const set = (i: number, key: keyof Opt, val: any) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, [key]: key==='description' ? String(val) : Number(val) } : r)
    onChange(next)
  }
  const add = () => onChange([...(rows||[]), { description:'', price:0 }])
  const del = (i: number) => onChange(rows.filter((_, idx) => idx !== i))

  return (
    <div className="card">
      <div className="hdr"><b>{title}</b><button className="btn secondary" onClick={add}>행 추가</button></div>
      <table className="table">
        <thead><tr><th>옵션</th><th style={{width:140}} className="right">금액</th><th style={{width:70}}></th></tr></thead>
        <tbody>
          {(rows||[]).map((r, i)=> (
            <tr key={i}>
              <td><input value={r.description||''} onChange={e=>set(i,'description', e.target.value)} placeholder="옵션명" /></td>
              <td className="right"><input type="number" value={r.price||0} onChange={e=>set(i,'price', e.target.value)} /></td>
              <td><button className="btn secondary" onClick={()=>del(i)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
