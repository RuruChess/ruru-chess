/**
 * Καρτέλα «Εκδόσεις / Patch Notes» (τύπου Patch Notes του LoL): παρουσιάζει καθαρά τις λειτουργίες
 * και αλλαγές κάθε έκδοσης σε Ελληνικά & Αγγλικά, με αυτόματο άνοιγμα 1 φορά μετά από αναβάθμιση.
 */
import { useEffect, useState } from 'react';
import { Database, GraduationCap, Monitor, Radio, Sparkles, Target, Users, type LucideIcon } from 'lucide-react';
import {
  RELEASE_NOTES,
  findReleaseNote,
  latestReleaseVersion,
  shouldAutoShowReleaseNotes,
  type Localized,
  type NoteCategory,
  type NoteKind,
} from '../../core/releaseNotes.ts';
import { L, language } from '../i18n.ts';
import { OPEN_KEY, useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { useAppInfo } from './About.tsx';
import type { GuideState } from './Guide.tsx';
import './releaseNotes.css';

const t = (x: Localized) => (language() === 'en' ? x.en : x.el);

const CATEGORY_ICON: Record<NoteCategory, LucideIcon> = {
  share: Radio,
  social: Users,
  db: Database,
  prep: Target,
  training: GraduationCap,
  app: Monitor,
};

const KIND_LABEL: Record<NoteKind, Localized> = {
  new: { el: 'Νέο', en: 'New' },
  improved: { el: 'Βελτίωση', en: 'Improved' },
  fix: { el: 'Διόρθωση', en: 'Fix' },
};

export function ReleaseNotesWindow({ active }: { active: boolean }) {
  const info = useAppInfo();
  const seen = useApp((s) => (s.settings?.ui as Record<string, unknown> | undefined)?.releaseNotesSeen as string | undefined);
  const [selected, setSelected] = useState(() => findReleaseNote(info?.version).version);

  // μόλις ανοίξει η καρτέλα, σημειώνουμε την τρέχουσα έκδοση ως διαβασμένη (φεύγει η κουκκίδα)
  useEffect(() => {
    if (!active || !info?.version) return;
    const current = info.version.split('-')[0] || latestReleaseVersion();
    if (seen !== current) setUiLater({ releaseNotesSeen: current });
  }, [active, info?.version, seen]);

  const note = findReleaseNote(selected);

  return (
    <div className="kb-wrap">
      <div className="kb-page rn-page">
        <div className="rn-hero">
          <img className="rn-logo" src="/icon.png?v=3.0.0" alt="" />
          <div className="rn-hero-text">
            <div className="rn-hero-top">
              <span className="rn-ver">
                <Sparkles size={11} aria-hidden />
                Patch {note.version}
              </span>
              <span className="rn-date">{t(note.date)}</span>
            </div>
            <h1 className="rn-headline">{t(note.headline)}</h1>
            <p className="rn-sub">{t(note.subtitle)}</p>
          </div>
        </div>

        {RELEASE_NOTES.length > 1 && (
          <div className="rn-versions" role="tablist" aria-label={L('Εκδόσεις', 'Versions')}>
            {RELEASE_NOTES.map((r) => (
              <button
                key={r.version}
                type="button"
                role="tab"
                aria-selected={r.version === note.version}
                className={`rn-vbtn${r.version === note.version ? ' on' : ''}`}
                onClick={() => setSelected(r.version)}
              >
                v{r.version}
              </button>
            ))}
          </div>
        )}

        {note.highlights.length > 0 && (
          <div className="rn-highlights">
            {note.highlights.map((h, idx) => {
              const Icon = CATEGORY_ICON[h.icon];
              return (
                <div key={idx} className="rn-hi">
                  <span className="rn-hi-ic" aria-hidden>
                    <Icon size={18} />
                  </span>
                  <div className="rn-hi-body">
                    <b>{t(h.title)}</b>
                    <span>{t(h.desc)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rn-sections">
          {note.sections.map((sec) => {
            const Icon = CATEGORY_ICON[sec.category];
            return (
              <section key={sec.category} className="kb-card rn-sec-card">
                <h2 className="rn-sec-h">
                  <Icon size={17} className="rn-sec-ic" aria-hidden />
                  {t(sec.title)}
                </h2>
                <ul className="rn-list">
                  {sec.items.map((item, idx) => (
                    <li key={idx} className="rn-item">
                      <span className={`rn-tag is-${item.kind}`}>{t(KIND_LABEL[item.kind])}</span>
                      <div className="rn-item-body">
                        <b>{t(item.title)}</b>
                        <p>{t(item.desc)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <footer className="rn-foot-bar">
          Ruru Chess v{note.version} · {L('Δωρεάν & ανοιχτού κώδικα — χωρίς διαφημίσεις ή τηλεμετρία', 'Free & open-source — no ads or telemetry')}
        </footer>
      </div>
    </div>
  );
}

/**
 * Αν υπάρχει αδιάβαστη νέα έκδοση (για την κουκκίδα στην καρτέλα «Εκδόσεις / Patch Notes»).
 */
export function useUnseenReleaseNotes(): boolean {
  const settings = useApp((s) => s.settings);
  const info = useAppInfo();
  if (!settings || !info?.version || OPEN_KEY) return false;
  const ui = (settings.ui ?? {}) as Record<string, unknown>;
  if (ui.releaseNotesOff === true) return false;
  const seen = typeof ui.releaseNotesSeen === 'string' ? ui.releaseNotesSeen : undefined;
  const current = info.version.split('-')[0] || latestReleaseVersion();
  return Boolean(current && seen !== current);
}

/**
 * Ελέγχει μία φορά στην εκκίνηση του κύριου παραθύρου αν ο χρήστης αναβάθμισε σε νέα έκδοση
 * και ανοίγει αυτόματα την καρτέλα Patch Notes 1 φορά.
 */
export function useReleaseNotesAutoOpen(onOpen: () => void): void {
  const settings = useApp((s) => s.settings);
  const info = useAppInfo();
  useEffect(() => {
    if (!settings || !info?.version) return;
    const ui = (settings.ui ?? {}) as Record<string, unknown>;
    const seen = typeof ui.releaseNotesSeen === 'string' ? ui.releaseNotesSeen : undefined;
    const off = ui.releaseNotesOff === true;
    const guide = ui.guide as GuideState | undefined;
    const guideWelcomeDone = Boolean(guide?.off || guide?.seen?.includes('welcome'));
    const current = info.version.split('-')[0] || latestReleaseVersion();

    if (shouldAutoShowReleaseNotes({ appVersion: info.version, seenVersion: seen, isPopup: Boolean(OPEN_KEY), off, guideWelcomeDone })) {
      setUiLater({ releaseNotesSeen: current });
      onOpen();
    } else if (!seen && !OPEN_KEY && !off && !guideWelcomeDone) {
      setUiLater({ releaseNotesSeen: current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(settings), info?.version]);
}
