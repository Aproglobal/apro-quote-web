import { db } from './firebase'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc } from 'firebase/firestore'
import type { Quote } from './types'

export async function listRecentQuotes(max = 30): Promise<Quote[]> {
  const q = query(collection(db, 'quotes'), orderBy('date', 'desc'), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() })) as Quote[]
}

export async function getQuote(id: string): Promise<Quote | null> {
  const s = await getDoc(doc(db, 'quotes', id))
  return s.exists() ? ({ id: s.id, ...s.data() } as Quote) : null
}

export async function patchQuote(id: string, data: Partial<Quote>): Promise<void> {
  await updateDoc(doc(db, 'quotes', id), data as any)
}
