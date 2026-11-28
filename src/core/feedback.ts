/**
 * Feedback από την εφαρμογή (κουμπί πάνω δεξιά) προς τον relay (`POST /api/feedback`). Ο ίδιος έλεγχος τρέχει στη
 * φόρμα και στον relay. Ο υπεύθυνος τα διαβάζει με `node admin.mjs feedback` και στο Κέντρο Ελέγχου.
 */
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 4000;
/** μέρες που κρατιέται ένα μήνυμα στον relay, μαζί με το email του (αν δόθηκε) */
export const FEEDBACK_DAYS = 365;
/** μηνύματα ανά IP την ώρα (η IP σβήνεται μετά από μία ώρα) */
export const FEEDBACK_PER_HOUR = 5;

export interface FeedbackIn {
  kind: FeedbackKind;
  text: string;
  /** προαιρετικό, μόνο για απάντηση· κενό αν δεν δόθηκε */
  email: string;
  version: string;
  lang: 'el' | 'en';
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export const validEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s);

/** Το μήνυμα όπως αποθηκεύεται, ή null αν δεν είναι έγκυρο (πολύ μικρό/μεγάλο κείμενο, λάθος email). */
export function cleanFeedback(v: unknown): FeedbackIn | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (text.length < FEEDBACK_MIN || text.length > FEEDBACK_MAX) return null;
  const email = typeof o.email === 'string' ? o.email.trim() : '';
  if (email && !validEmail(email)) return null;
  return {
    kind: FEEDBACK_KINDS.includes(o.kind as FeedbackKind) ? (o.kind as FeedbackKind) : 'other',
    text,
    email,
    version: typeof o.version === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(o.version) ? o.version : '',
    lang: o.lang === 'en' ? 'en' : 'el',
  };
}
