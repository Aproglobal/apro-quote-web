export type Item = { qty: number; description: string; unitPrice?: number; amount?: number };
export type Opt = { description: string; price?: number };

export type Quote = {
  id?: string;
  year?: string;
  seq?: number;
  subSeq?: number;
  quoteNo?: string;
  date?: any; // firestore Timestamp
  owner?: string;
  client?: string;
  model?: string;
  payTerms?: string;
  deliveryTerms?: string;
  items?: Item[];
  installed?: Opt[];
  paid?: Opt[];
  extra?: Opt[];
  memo?: string;
  grandTotal?: number;
  pdfUrl?: string;
  pngUrl?: string;
  status?: string;
};
