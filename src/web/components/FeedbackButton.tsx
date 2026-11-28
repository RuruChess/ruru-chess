/**
 * Κουμπί Feedback (πάνω δεξιά): πρόβλημα, ιδέα ή άλλο, με προαιρετικό email για απάντηση. Στέλνεται στον relay
 * (`POST /api/feedback`, src/core/feedback.ts) μόνο με την «Αποστολή». Το πρόχειρο μένει αν κλείσει το παράθυρο.
 */
import { useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { FEEDBACK_MAX, FEEDBACK_MIN, cleanFeedback, validEmail, type FeedbackKind } from '../../core/feedback.ts';
import { L, language } from '../i18n.ts';
import { playServer, serverDown } from '../online/server.ts';
import { useApp } from '../store.ts';
import { useAppInfo } from './About.tsx';
import { LegalText, legalTitle } from './LegalText.tsx';
import { WinDialog } from './ui.tsx';

const KINDS: Array<[FeedbackKind, () => string]> = [
  ['bug', () => L('Πρόβλημα', 'Problem')],
  ['idea', () => L('Ιδέα', 'Idea')],
  ['other', () => L('Άλλο', 'Other')],
];

export function FeedbackButton() {
  const settings = useApp((s) => s.settings);
  const info = useAppInfo();
  const [open, setOpen] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const version = (info?.version ?? '').split('-')[0];
  const badEmail = email.trim() !== '' && !validEmail(email.trim());
  const ready = text.trim().length >= FEEDBACK_MIN && !badEmail && !sending;
  const close = () => {
    setOpen(false);
    setError('');
  };

  const send = async () => {
    const body = cleanFeedback({ kind, text, email, version, lang: language() });
    if (!body) return;
    const server = playServer(settings?.ui as Record<string, unknown> | undefined);
    setSending(true);
    setError('');
    try {
      const r = await fetch(`${server}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      if (!r) setError(serverDown(server));
      else if (r.status === 429) setError(L('Πολλά μηνύματα σε λίγη ώρα. Δοκίμασε ξανά αργότερα.', 'Too many messages in a short time. Please try again later.'));
      else if (!r.ok) setError(L('Δεν στάλθηκε. Δοκίμασε ξανά αργότερα.', 'Not sent. Please try again later.'));
      else {
        setText('');
        close();
        useApp.getState().toast(L('Ευχαριστώ! Το μήνυμά σου στάλθηκε.', 'Thank you! Your message was sent.'), 'ok');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button className="icon-btn" title={L('Feedback: πρόβλημα ή ιδέα', 'Feedback: a problem or an idea')} aria-label="Feedback" onClick={() => setOpen(true)}>
        <MessageSquareText size={17} />
      </button>
      {open && !privacy && (
        <WinDialog
          title="Feedback"
          onClose={close}
          width={480}
          footer={
            <>
              <button className="win-btn" onClick={close}>
                {L('Άκυρο', 'Cancel')}
              </button>
              <button className="win-btn default" disabled={!ready} onClick={() => void send()}>
                {sending ? L('Αποστολή…', 'Sending…') : L('Αποστολή', 'Send')}
              </button>
            </>
          }
        >
          <div className="feedback-form">
            <div className="seg" role="radiogroup" aria-label={L('Είδος', 'Type')}>
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {label()}
                </button>
              ))}
            </div>
            <label className="field">
              {kind === 'bug' ? L('Τι έγινε; Τι περίμενες να γίνει;', 'What happened? What did you expect?') : L('Το μήνυμά σου', 'Your message')}
              <textarea rows={7} maxLength={FEEDBACK_MAX} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            </label>
            <label className="field">
              {L('Email (προαιρετικό, μόνο αν θέλεις απάντηση)', 'Email (optional, only if you want a reply)')}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={badEmail} />
            </label>
            {badEmail && <p className="small error-text">{L('Το email δεν φαίνεται σωστό.', 'The email does not look right.')}</p>}
            {error && <p className="small error-text">{error}</p>}
            <p className="muted small">
              {L(
                `Στέλνονται το είδος, το κείμενο, η έκδοση${version ? ` (${version})` : ''} και η γλώσσα. Το email μόνο αν το γράψεις. Κρατιέται το πολύ 12 μήνες.`,
                `Sent: the type, your text, the app version${version ? ` (${version})` : ''} and language. Your email only if you write it. Kept for at most 12 months.`,
              )}{' '}
              <button type="button" className="link-btn small" onClick={() => setPrivacy(true)}>
                {legalTitle('privacy')}
              </button>
            </p>
          </div>
        </WinDialog>
      )}
      {privacy && (
        <WinDialog
          title={legalTitle('privacy')}
          onClose={() => setPrivacy(false)}
          width={640}
          footer={
            <button className="win-btn default" onClick={() => setPrivacy(false)}>
              {L('Εντάξει', 'OK')}
            </button>
          }
        >
          <LegalText doc="privacy" />
        </WinDialog>
      )}
    </>
  );
}
