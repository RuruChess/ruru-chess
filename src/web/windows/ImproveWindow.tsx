/**
 * Καρτέλα «Βελτίωση»: τρεις σελίδες (Τακτικά, Φινάλε, Στρατηγικά). Τα Φινάλε έχουν δύο μέρη: τα μαθήματα (από
 * τα βασικά ματ ως τις μελέτες, σαν σχολιασμένες παρτίδες) και το παιχνίδι εναντίον του υπολογιστή («Παίξε τη
 * θέση»: κέρδισε ή κράτα ισοπαλία απέναντι στη μηχανή ή σε φίλο)· τα Στρατηγικά είναι τα μαθήματα πάνω σε
 * σχολιασμένες παρτίδες.
 */
import { useRef, useState } from 'react';
import { ArrowLeft, Compass, Crown, GraduationCap, Puzzle, Swords } from 'lucide-react';
import { L } from '../i18n.ts';
import { useApp, type Tab } from '../store.ts';
import { SECTIONS, sectionName, sectionNote, type Section } from '../tactics/sections.ts';
import { GameLessons } from '../tactics/GameLessons.tsx';
import { EndgameCourse } from '../tactics/EndgameCourse.tsx';
import { setUiLater } from '../tactics/store.ts';
import { EndgamePlay } from '../play/EndgamePlay.tsx';
import { TacticsWindow } from './TacticsWindow.tsx';
import '../tactics/improve.css';

type TacticsTab = Extract<Tab, { kind: 'tactics' }>;

const ICONS: Record<Section, typeof Puzzle> = { tactics: Puzzle, endgame: Crown, strategy: Compass };

export function ImproveWindow({ tab, active }: { tab: TacticsTab; active: boolean }) {
  const saved = useApp((s) => (s.settings?.ui as Record<string, unknown> | undefined)?.improvePage);
  const page: Section = SECTIONS.includes(saved as Section) ? (saved as Section) : 'tactics';
  // κάθε σελίδα φορτώνεται την πρώτη φορά που ανοίγει και μετά μένει (κρατά το puzzle που λύνεις)
  const visited = useRef(new Set<Section>());
  visited.current.add(page);
  // μία σειρά πλοήγησης: οι σελίδες αριστερά και, στα Τακτικά, οι τρόποι και τα εργαλεία τους (portal εδώ)
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="improve">
      <nav className="imp-nav" aria-label={L('Βελτίωση', 'Improve')}>
        <div className="kb-sgc imp-sections" data-guide="improve" role="tablist" aria-label={L('Βελτίωση', 'Improve')}>
          {SECTIONS.map((s) => {
            const Icon = ICONS[s];
            return (
              <button key={s} type="button" role="tab" data-guide={`nav-${s}`} aria-selected={s === page} aria-label={sectionName(s)} title={sectionNote(s)} onClick={() => s !== page && setUiLater({ improvePage: s })}>
                <Icon aria-hidden />
                <span className="imp-lbl">{sectionName(s)}</span>
              </button>
            );
          })}
        </div>
        <div className="imp-slot" ref={setSlot} />
      </nav>
      <div className="improve-body">
        {SECTIONS.filter((s) => visited.current.has(s)).map((s) => (
          <div key={s} className={`improve-page${s === page ? ' on' : ''}`} data-guide={`page-${s}`} role="tabpanel" aria-label={sectionName(s)}>
            {s === 'strategy' ? (
              <div className="subpages">
                <div className="subpages-body">
                  <GameLessons active={active && s === page} />
                </div>
              </div>
            ) : s === 'endgame' ? (
              <EndgamePage tab={tab} active={active && s === page} />
            ) : (
              <TacticsWindow tab={tab} active={active && s === page} section={s} slot={s === page ? slot : null} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type EndgameView = 'course' | 'play';

/**
 * Φινάλε, σε δύο μέρη: (α) τα μαθήματα, από τα βασικά ματ ως τις μελέτες, που τα βλέπεις σαν σχολιασμένες παρτίδες
 * (προεπιλογή)· (β) το παιχνίδι εναντίον του υπολογιστή («Παίξε τη θέση»), με πρόσβαση και στις ασκήσεις των
 * συλλογών. Κάθε μέρος μένει φορτωμένο αφού ανοίξει.
 */
function EndgamePage({ tab, active }: { tab: TacticsTab; active: boolean }) {
  const saved = useApp((s) => (s.settings?.ui as Record<string, unknown> | undefined)?.endgameView);
  const view: EndgameView = saved === 'play' ? 'play' : 'course';
  // οι ασκήσεις των συλλογών (η παλιά σελίδα των Φινάλε), μέσα στο μέρος του παιχνιδιού
  const [exercises, setExercises] = useState(false);
  const visited = useRef(new Set<string>());
  visited.current.add(view === 'play' && exercises ? 'exercises' : view);
  return (
    <div className="subpages with-switch">
      <div className="subpages-switch" data-guide="endgame" role="tablist" aria-label={L('Φινάλε', 'Endgames')}>
        <button type="button" role="tab" aria-selected={view === 'course'} className={view === 'course' ? 'on' : ''} onClick={() => setUiLater({ endgameView: 'course' })}>
          <GraduationCap size={15} aria-hidden />
          {L('Μαθήματα φινάλε', 'Endgame lessons')}
        </button>
        <button type="button" role="tab" aria-selected={view === 'play'} className={view === 'play' ? 'on' : ''} onClick={() => (view === 'play' ? setExercises(false) : setUiLater({ endgameView: 'play' }))}>
          <Swords size={15} aria-hidden />
          {L('Παιχνίδι εναντίον του υπολογιστή', 'Play against the computer')}
        </button>
        {view === 'play' && exercises && (
          <button type="button" className="subpages-back" onClick={() => setExercises(false)}>
            <ArrowLeft size={15} aria-hidden />
            {L('Πίσω στις θέσεις', 'Back to the positions')}
          </button>
        )}
      </div>
      {visited.current.has('course') && (
        <div className="subpages-body" hidden={view !== 'course'}>
          <EndgameCourse active={active && view === 'course'} />
        </div>
      )}
      {visited.current.has('play') && (
        <div className="subpages-body" hidden={view !== 'play' || exercises}>
          <EndgamePlay active={active && view === 'play' && !exercises} onExercises={() => setExercises(true)} />
        </div>
      )}
      {visited.current.has('exercises') && (
        <div className="subpages-body" hidden={view !== 'play' || !exercises}>
          <TacticsWindow tab={tab} active={active && view === 'play' && exercises} section="endgame" />
        </div>
      )}
    </div>
  );
}
