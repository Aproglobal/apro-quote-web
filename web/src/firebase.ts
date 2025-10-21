import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_LOCATION || undefined)

// 로컬 에뮬 사용 시
if (import.meta.env.MODE === 'development' && import.meta.env.VITE_USE_EMU === '1') {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

export const call = {
  newQuoteNumber: httpsCallable<{ owner?: string; client?: string }, { id: string; quoteNo: string }>(functions, 'newQuoteNumber'),
  newRevisionNumber: httpsCallable<{ quoteId: string }, { quoteNo: string }>(functions, 'newRevisionNumber'),
  aiNormalize: httpsCallable<{ freeText: string }, { data: any }>(functions, 'aiNormalize'),
  generatePdfAndPng: httpsCallable<{ quoteId: string }, { pdfUrl: string; pngUrl: string }>(functions, 'generatePdfAndPng'),
  similarQuotes: httpsCallable<
    { query: string; limit?: number },
    { items: Array<{ id: string; quoteNo: string; client?: string; model?: string; grandTotal?: number; date?: any; score: number }> }
  >(functions, 'similarQuotes')
}
