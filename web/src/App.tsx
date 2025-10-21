import React from 'react'
import QuoteForm from './components/QuoteForm'
import QuoteList from './components/QuoteList'
import SimilarFinder from './components/SimilarFinder'
import type { Quote } from './types'

export default function App(){
  const onPick = (q: Quote) => {
    alert(`선택: ${q.quoteNo} / ${q.client} / ${q.model}`)
  }
  return (
    <div className="app">
      <div className="hdr">
        <h2>APRO 견적 시스템</h2>
        <div className="kv">
          <span className="badge">모바일 최적화</span>
          <span className="badge">AI 파싱</span>
          <span className="badge">PDF/PNG</span>
        </div>
      </div>

      <QuoteForm />
      <QuoteList onPick={onPick} />
      <SimilarFinder />
    </div>
  )
}
