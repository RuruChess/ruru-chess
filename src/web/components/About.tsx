/**
 * Έκδοση, έλεγχος για νέα έκδοση, ιστοσελίδα και «Στήριξε». Οι σύνδεσμοι έρχονται από τον
 * server (package.json)· όσοι δεν έχουν οριστεί δεν εμφανίζονται.
 */
import { useEffect, useState } from 'react';
import { Download, Globe, Heart, RefreshCw, Sparkles, X } from 'lucide-react';
import { api, type AppInfo, type UpdateInfo } from '../api.ts';
import { L } from '../i18n.ts';
import { NOTES_TAB, reportError, useApp } from '../store.ts';

let infoRequest: Promise<AppInfo> | null = null;

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let alive = true;
    (infoRequest ??= api.get<AppInfo>('/api/version')).then((i) => alive && setInfo(i)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** Στον κανονικό browser του χρήστη (όχι στο παράθυρο της εφαρμογής). */
export const openLink = (url: string) => api.post('/api/open-link', { url }).catch(reportError);

export function SupportButton() {
  const url = useAppInfo()?.links.support;
  if (!url) return null;
  return (
    <button className="support" onClick={() => void openLink(url)} title={L('Το Ruru είναι δωρεάν. Αν σου φαίνεται χρήσιμο, μπορείς να το στηρίξεις.', 'Ruru is free. If you find it useful, you can support it.')}>
      <Heart size={16} /> {L('Στήριξε', 'Support')}
    </button>
  );
}

// ένας αυτόματος έλεγχος σε κάθε εκκίνηση της εφαρμογής, όσα παράθυρα κι αν ανοίξουν
let startupCheck: Promise<UpdateInfo> | null = null;

/** Ειδοποίηση στο παράθυρο βάσεων όταν έχει κυκλοφορήσει νεότερη έκδοση. */
export function UpdateBanner() {
  const enabled = useApp((s) => s.settings?.updateCheck !== false);
  const info = useAppInfo();
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled || !info?.links.releases) return;
    (startupCheck ??= api.get<UpdateInfo>('/api/update')).then(setUpd).catch(() => {});
  }, [enabled, info]);
  if (!upd?.newer || hidden) return null;
  return (
    <div className="update-banner">
      <Download size={16} />
      <span>{L(`Κυκλοφόρησε το Ruru ${upd.latest} (έχεις το ${upd.current}).`, `Ruru ${upd.latest} is out (you have ${upd.current}).`)}</span>
      {upd.url && (
        <button className="primary" onClick={() => void openLink(upd.url!)}>
          {L('Λήψη', 'Download')}
        </button>
      )}
      <button className="icon-btn" onClick={() => setHidden(true)} title={L('Κλείσιμο', 'Close')}>
        <X size={14} />
      </button>
    </div>
  );
}

/** Η ενότητα «Σχετικά» των ρυθμίσεων. */
export function AboutSection({ databasesDir }: { databasesDir: string }) {
  const info = useAppInfo();
  const openTab = useApp((s) => s.openTab);
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const links = info?.links;
  const check = async () => {
    setChecking(true);
    try {
      setUpd(await api.get<UpdateInfo>('/api/update?force=1'));
    } catch (e) {
      reportError(e);
    } finally {
      setChecking(false);
    }
  };
  return (
    <section>
      <h2>{L('Σχετικά', 'About')}</h2>
      <p>
        <b>Ruru Chess</b> {info?.version.replace(/-(\w+)$/, (_m, t: string) => ` ${t.toUpperCase()}`)} — {L('βάση δεδομένων και ανάλυση σκακιού', 'chess database and analysis')}.
      </p>
      <p className="small">
        <b>{L('Το Ruru Chess δεν έχει καμία σχέση με την ChessBase GmbH.', 'Ruru Chess has no connection with ChessBase GmbH.')}</b>
        <br />
        {L('Ούτε με το Lichess, το Chess.com ή τη FIDE. Τα σήματα ανήκουν στους κατόχους τους.', 'Nor with Lichess, Chess.com or FIDE. Trademarks belong to their owners.')}
      </p>
      <div className="row gap wrap">
        <button onClick={() => openTab(NOTES_TAB)}>
          <Sparkles size={14} /> {L('Τι νέο υπάρχει (Patch Notes)', 'What’s new (Patch Notes)')}
        </button>
        {links?.releases && (
          <button disabled={checking} onClick={() => void check()}>
            <RefreshCw size={14} /> {L('Έλεγχος για νέα έκδοση', 'Check for updates')}
          </button>
        )}
        {links?.site && (
          <button onClick={() => void openLink(links.site!)}>
            <Globe size={14} /> {L('Ιστοσελίδα', 'Website')}
          </button>
        )}
        <SupportButton />
      </div>
      {upd && (
        <p className="small">
          {upd.newer ? (
            <>
              {L(`Κυκλοφόρησε το Ruru ${upd.latest}.`, `Ruru ${upd.latest} is out.`)}{' '}
              {upd.url && (
                <button className="primary" onClick={() => void openLink(upd.url!)}>
                  <Download size={14} /> {L('Λήψη', 'Download')}
                </button>
              )}
            </>
          ) : upd.latest ? (
            L(`Έχεις την τελευταία έκδοση (${upd.current}).`, `You have the latest version (${upd.current}).`)
          ) : (
            L('Δεν έχει δημοσιευτεί ακόμη καμία έκδοση.', 'No release has been published yet.')
          )}
        </p>
      )}
      <p className="muted small">
        {L('Φάκελος βάσεων', 'Databases folder')}: {databasesDir}
      </p>
      <p className="muted small">
        {L(
          'Απόρρητο: λογαριασμός μόνο αν θέλεις τους Φίλους (16+), χωρίς διαφημίσεις ή στατιστικά χρήσης. Οι βάσεις μένουν στον υπολογιστή σου. Στο διαδίκτυο πηγαίνει μόνο ό,τι χρειάζεται μια online λειτουργία που χρησιμοποιείς (π.χ. παρτίδα με link, Φίλοι, φωνή, Lichess, Chess.com, FIDE, λήψεις)· όλα αναλυτικά στο αρχείο PRIVACY.md της εγκατάστασης.',
          'Privacy: an account only if you want Friends (16+), no adverts or usage statistics. Your databases stay on your computer. Only what an online feature you use needs goes to the internet (e.g. a game by link, Friends, voice, Lichess, Chess.com, FIDE, downloads); details are in PRIVACY.md in the installation folder.',
        )}
      </p>
      <p className="muted small">
        {L(
          'Ανοιχτός κώδικας: GPL-3.0-or-later, με μέρη AGPL-3.0. Κομμάτια: Cburnett & Merida (GPLv2+). Τακτική και bots: RealChessBase του Λάζαρου Μπατσή (GPL-3.0). Leela και Maia: Lc0 (GPL-3.0) και βάρη Maia του CSSLab (GPL-3.0), με προαιρετική λήψη. Μαθήματα φινάλε: από άρθρα της Wikipedia (CC BY-SA 4.0) και, τα βασικά ματ, από το «Chess Fundamentals» του J. R. Capablanca (1921, κοινό κτήμα). Μαθήματα στρατηγικής: σχόλια των J. R. Capablanca (1920, 1921) και S. Tarrasch (1908), κοινό κτήμα. Ανάγνωση PDF για το «Βιβλίο σε βάση»: pdf.js της Mozilla (Apache-2.0). Τεκμηρίωση μορφής ChessBase: cbh2pgn & cbvault (MIT). Ήχοι: el_boss (CC0) και Enigmahack (AGPL-3.0).',
          'Open source: GPL-3.0-or-later, with parts under AGPL-3.0. Pieces: Cburnett & Merida (GPLv2+). Tactics and bots: RealChessBase by Lazaros Batsis (GPL-3.0). Leela and Maia: Lc0 (GPL-3.0) and CSSLab’s Maia weights (GPL-3.0), optional download. Endgame lessons: from Wikipedia articles (CC BY-SA 4.0) and, for the basic mates, J. R. Capablanca’s “Chess Fundamentals” (1921, public domain). Strategy lessons: notes by J. R. Capablanca (1920, 1921) and S. Tarrasch (1908), public domain. PDF reading for “Book to database”: Mozilla’s pdf.js (Apache-2.0). ChessBase format documentation: cbh2pgn & cbvault (MIT). Sounds: el_boss (CC0) and Enigmahack (AGPL-3.0).',
        )}
      </p>
      <p className="muted small">
        {L(
          'Μέρη της Τακτικής και οι τύποι πιθανότητας νίκης και ακρίβειας προέρχονται από τον κώδικα του lila των δημιουργών του Lichess (AGPL-3.0-or-later) και του lichess-puzzler του ornicar και των συντελεστών του (AGPL-3.0), με αλλαγές. Glicko-2: scalachess του Thibault Duplessis (MIT), με βάση το glicko2 του Jeremy Gooch (BSD-2-Clause). Θέματα puzzles: μέρος των ελληνικών από τους μεταφραστές του Lichess (AGPL-3.0-or-later). Ανάγνωση .si4: από το Scid των Shane Hudson, Pascal Georges και Fulvio Benini (GPL και MIT). Πλήρη κείμενα: αρχεία LICENSE, CREDITS.md και φάκελος licenses της εγκατάστασης. Χωρίς καμία εγγύηση.',
          'Parts of Tactics and the winning-chance and accuracy formulas come from the code of lila by the Lichess authors (AGPL-3.0-or-later) and lichess-puzzler by ornicar and contributors (AGPL-3.0), modified. Glicko-2: scalachess by Thibault Duplessis (MIT), based on glicko2 by Jeremy Gooch (BSD-2-Clause). Puzzle themes: some Greek texts by the Lichess translators (AGPL-3.0-or-later). Reading .si4: from Scid by Shane Hudson, Pascal Georges and Fulvio Benini (GPL and MIT). Full texts: LICENSE, CREDITS.md and the licenses folder of the installation. No warranty of any kind.',
        )}
      </p>
    </section>
  );
}
