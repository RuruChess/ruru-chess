/**
 * Φίλοι: όροι και ηλικία, αναφορά, διαγραφή λογαριασμού. Τα παράθυρα είναι στο App, γιατί ανοίγουν και από τα
 * chat, που φαίνονται σε όλες τις καρτέλες.
 */
import { useState } from 'react';
import { MIN_AGE, REPORT_MAX_TEXT, REPORT_REASONS, type ReportReason } from '../../core/social.ts';
import { CONTACT_EMAIL } from '../../core/features.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { Dialog } from '../components/ui.tsx';
import { LegalText, legalTitle } from '../components/LegalText.tsx';
import { acceptTerms, accountOf, deleteSocial, downloadMyData, fullName, signOutSocial, socialSend, useSocial, type SocialAccount } from './social.ts';
import './social.css';

function LegalLinks() {
  return (
    <span className="fr-legal-links small">
      {(['terms', 'privacy'] as const).map((doc) => (
        <button key={doc} type="button" className="link-btn small" onClick={() => useSocial.setState({ legal: doc })}>
          {legalTitle(doc)}
        </button>
      ))}
    </span>
  );
}

/** Τα δύο κουτάκια της εγγραφής (ποτέ προεπιλεγμένα). */
export function ConsentChecks({ age, terms, onAge, onTerms }: { age: boolean; terms: boolean; onAge: (v: boolean) => void; onTerms: (v: boolean) => void }) {
  return (
    <div className="fr-consent small">
      <label>
        <input type="checkbox" name="age16" checked={age} onChange={(e) => onAge(e.target.checked)} />
        <span>{L(`Είμαι ${MIN_AGE} ετών ή μεγαλύτερος/η.`, `I am ${MIN_AGE} or older.`)}</span>
      </label>
      <label>
        <input type="checkbox" name="terms" checked={terms} onChange={(e) => onTerms(e.target.checked)} />
        <span>{L('Δέχομαι τους όρους χρήσης και διάβασα την πολιτική απορρήτου.', 'I accept the terms of use and have read the privacy policy.')}</span>
      </label>
      <LegalLinks />
    </div>
  );
}

/** Λογαριασμός που δεν έχει δεχτεί τους τωρινούς όρους (και όσοι έμειναν από τη δοκιμή). */
export function TermsGate({ acc }: { acc: SocialAccount }) {
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  return (
    <div className="fr-signup tx fr-gate">
      <p className="small">
        {L(
          `Για να συνεχίσει ο ${fullName({ ...acc, id: acc.userId })} στους Φίλους χρειάζεται επιβεβαίωση ηλικίας και αποδοχή των όρων.`,
          `For ${fullName({ ...acc, id: acc.userId })} to continue in Friends, please confirm your age and accept the terms.`,
        )}
      </p>
      <ConsentChecks age={age} terms={terms} onAge={setAge} onTerms={setTerms} />
      <button type="button" className="btn btn-primary" disabled={!age || !terms} onClick={acceptTerms}>
        {L('Συνέχεια', 'Continue')}
      </button>
      <button type="button" className="link-btn small" onClick={() => void downloadMyData(acc)}>
        {L('Λήψη των δεδομένων μου', 'Download my data')}
      </button>
      <button type="button" className="link-btn small" onClick={() => useSocial.setState({ deleting: true })}>
        {L('Διαγραφή λογαριασμού…', 'Delete account…')}
      </button>
      <button
        type="button"
        className="link-btn small"
        onClick={() => {
          if (window.confirm(L('Να βγεις σε αυτόν τον υπολογιστή; Για να ξαναμπείς θα χρειαστείς τον κωδικό ανάκτησης.', 'Sign out on this computer? To sign in again you will need the recovery code.'))) signOutSocial();
        }}
      >
        {L('Αποσύνδεση από αυτόν τον υπολογιστή', 'Sign out on this computer')}
      </button>
    </div>
  );
}

const reasonText = (r: ReportReason): string =>
  ({
    abuse: L('Παρενόχληση, απειλή ή μίσος', 'Harassment, threat or hate'),
    child: L('Κίνδυνος ή εκμετάλλευση παιδιού', 'Child safety or exploitation'),
    illegal: L('Άλλο παράνομο περιεχόμενο', 'Other illegal content'),
    copyright: L('Πνευματικά δικαιώματα', 'Copyright'),
    impersonation: L('Πλαστοπροσωπία', 'Impersonation'),
    spam: L('Spam ή βλαβερό αρχείο', 'Spam or harmful file'),
    other: L('Κάτι άλλο', 'Something else'),
  })[r];

function ReportDialog() {
  const r = useSocial((s) => s.report)!;
  const done = useSocial((s) => s.reported);
  const ok = useSocial((s) => s.status === 'open');
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [text, setText] = useState('');
  const close = () => useSocial.setState({ report: null, reported: null });
  return (
    <Dialog
      title={L('Αναφορά', 'Report')}
      onClose={close}
      width={460}
      footer={
        done ? (
          <button className="primary" onClick={close}>
            {L('Εντάξει', 'OK')}
          </button>
        ) : (
          <>
            <button onClick={close}>{L('Άκυρο', 'Cancel')}</button>
            <button className="primary" disabled={!ok || !reason} onClick={() => reason && socialSend({ t: 'report', reason, text, ...r.target })}>
              {L('Αποστολή αναφοράς', 'Send report')}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="small" role="status">
          {L(
            `Η αναφορά καταχωρήθηκε με αριθμό ${done}. Αν θέλεις απάντηση, γράψε στο ${CONTACT_EMAIL} με αυτόν τον αριθμό. Μπορείς και να μπλοκάρεις κάποιον από το μενού του στους Φίλους ή στα μέλη της ομάδας.`,
            `Report ${done} was recorded. For an answer, write to ${CONTACT_EMAIL} with this number. You can also block someone from their menu in Friends or in the team members.`,
          )}
        </p>
      ) : (
        <div className="tx fr-report">
          <p className="small">
            <b>{r.label}</b>
          </p>
          <label className="play-opt">
            <span className="field-label">{L('Λόγος', 'Reason')}</span>
            <select className="input" name="reason" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              <option value="" disabled>
                {L('Διάλεξε…', 'Choose…')}
              </option>
              {REPORT_REASONS.map((k) => (
                <option key={k} value={k}>
                  {reasonText(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="play-opt">
            <span className="field-label">{L('Τι έγινε (προαιρετικό)', 'What happened (optional)')}</span>
            <textarea className="input" name="details" rows={4} maxLength={REPORT_MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="faint small">
            {L(
              'Τη βλέπει ο υπεύθυνος του Ruru Chess, με το όνομά σου και αντίγραφο του μηνύματος που αναφέρεις. Αν κινδυνεύει κάποιος, κάλεσε πρώτα το 112.',
              'The Ruru Chess operator sees it, with your name and a copy of the message you report. If someone is in danger, call 112 first.',
            )}
          </p>
        </div>
      )}
    </Dialog>
  );
}

function DeleteDialog({ acc }: { acc: SocialAccount }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => useSocial.setState({ deleting: false });
  const go = async () => {
    setBusy(true);
    setError(await deleteSocial(acc));
    setBusy(false);
  };
  return (
    <Dialog
      title={L('Διαγραφή λογαριασμού', 'Delete account')}
      onClose={close}
      width={460}
      footer={
        <>
          <button onClick={close}>{L('Άκυρο', 'Cancel')}</button>
          <button className="danger-text" disabled={!sure || busy} onClick={() => void go()}>
            {busy ? L('Περίμενε…', 'Please wait…') : L('Οριστική διαγραφή', 'Delete permanently')}
          </button>
        </>
      }
    >
      <p className="small">
        {L(
          `Σβήνονται από τον server ο ${fullName({ ...acc, id: acc.userId })}, οι φιλίες, οι προσωπικές συνομιλίες (και για τον άλλον), τα μηνύματα και η συμμετοχή σου στις ομάδες, τα αρχεία που έστειλες και οι σχετικές αναφορές.`,
          `The server deletes ${fullName({ ...acc, id: acc.userId })}, your friendships, private conversations (for the other person too), your messages and memberships in teams, the files you sent and related reports.`,
        )}
      </p>
      <p className="faint small">
        {L(
          'Δεν σβήνονται αντίγραφα που κατέβασαν ήδη άλλοι. Οι βάσεις σε αυτόν τον υπολογιστή δεν πειράζονται. Αν θέλεις αντίγραφο των δεδομένων σου, κατέβασέ το πρώτα.',
          'Copies others already downloaded are not deleted. The databases on this computer are not touched. If you want a copy of your data, download it first.',
        )}
      </p>
      <label className="fr-sure small">
        <input type="checkbox" name="sure" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        <span>{L('Καταλαβαίνω ότι δεν αναιρείται.', 'I understand that this cannot be undone.')}</span>
      </label>
      {error && (
        <div className="play-note" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}

export function SafetyDialogs() {
  const acc = accountOf(useApp((s) => s.settings?.ui) as Record<string, unknown> | undefined);
  const legal = useSocial((s) => s.legal);
  const report = useSocial((s) => s.report);
  const deleting = useSocial((s) => s.deleting);
  return (
    <>
      {report && acc && <ReportDialog />}
      {deleting && acc && <DeleteDialog acc={acc} />}
      {legal && (
        <Dialog title={legalTitle(legal)} width={640} onClose={() => useSocial.setState({ legal: null })}>
          <LegalText doc={legal} />
        </Dialog>
      )}
    </>
  );
}
