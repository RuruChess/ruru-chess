/**
 * «Κοινή ανάλυση με …»: τι θα αναλύσετε μαζί. Η ανάλυση που τρέχει ήδη (η πρόσκληση φεύγει αμέσως), μια
 * παρτίδα που είναι ανοιχτή σε καρτέλα, άδεια σκακιέρα, η τελευταία κοινή ανάλυση ή «Διάλεξε παρτίδα» (βάση,
 * αρχείο, PGN) στην καρτέλα «Κοινή ανάλυση». Για φίλο ή για όλη την ομάδα.
 */
import type { ReactNode } from 'react';
import { ChevronRight, Database, FilePlus2, FileText, History, Radio } from 'lucide-react';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { Dialog } from '../components/ui.tsx';
import { lastShare } from '../share/ShareHost.tsx';
import { inviteToRoom, openGames, runningAnalyses, shareOpenGame, startShareFrom, useSocial } from './social.ts';
import { Avatar, TeamAvatar } from './FriendsPanel.tsx';
import '../tactics/tactics.css';
import '../play/play.css';
import './social.css';

type Target = { peer?: string; team?: string };

export function InviteAnalysisDialog() {
  const target = useSocial((s) => s.analysisDialog);
  return target ? <InviteAnalysis key={target.peer ?? `t:${target.team}`} target={target} /> : null;
}

function InviteAnalysis({ target }: { target: Target }) {
  const f = useSocial((s) => (target.peer ? s.friends.find((x) => x.id === target.peer) : undefined));
  const t = useSocial((s) => (target.team ? s.teams.find((x) => x.id === target.team) : undefined));
  const ok = useSocial((s) => s.status === 'open');
  const tabs = useApp((s) => s.tabs);
  const remote = useSocial((s) => s.openGames);
  const close = () => useSocial.setState({ analysisDialog: null });
  if (!f && !t) return null;

  const running = runningAnalyses();
  // οι ανοιχτές παρτίδες (όχι όσες μοιράζονται ήδη: αυτές είναι στις «Τρέχει ήδη»)
  const games = openGames(tabs, remote).filter((g) => !running.some((r) => r.tab === g.id)).slice(-6).reverse();
  const last = lastShare();
  const lastRunning = Boolean(last && running.some((r) => r.room === last.id));

  const option = (key: string, icon: ReactNode, label: string, sub: string, onClick: () => void) => (
    <button key={key} type="button" className="ia-opt" disabled={!ok} onClick={onClick}>
      <span className="ia-ic" aria-hidden>
        {icon}
      </span>
      <span className="ia-text">
        <b>{label}</b>
        <span className="faint small">{sub}</span>
      </span>
      <ChevronRight className="ic ic-sm ia-go" aria-hidden />
    </button>
  );

  return (
    <Dialog title={f ? L(`Κοινή ανάλυση με ${f.name}`, `Shared analysis with ${f.name}`) : L(`Κοινή ανάλυση με την ομάδα «${t?.name}»`, `Shared analysis with the team “${t?.name}”`)} onClose={close} width={460}>
      <div className="tx gi-body ia-body">
        <div className="gi-who">
          {f ? <Avatar id={f.id} name={f.name} p={f.p} size={36} /> : t ? <TeamAvatar t={t} size={36} /> : null}
          <span className="fr-who">
            <span className="fr-name">
              {f ? f.name : t?.name}
              {f && <span className="fr-tag">#{f.tag}</span>}
            </span>
            <span className="faint small">
              {f ? L('Τι θέλεις να αναλύσετε μαζί;', 'What do you want to analyse together?') : L('Όλη η ομάδα παίρνει «Μπες». Τι θα αναλύσετε;', 'The whole team gets “Join”. What will you analyse?')}
            </span>
          </span>
        </div>

        {running.length > 0 && (
          <section className="ia-group">
            <div className="fp-head">{L('Τρέχει ήδη', 'Already running')}</div>
            {running.map((r) =>
              option(
                `run-${r.room}`,
                <Radio size={18} />,
                r.title ?? L('Κοινή ανάλυση', 'Shared analysis'),
                L('Η πρόσκληση φεύγει αμέσως', 'The invitation goes out right away'),
                () => {
                  if (inviteToRoom(target, 'analysis', r.room, r.title ? { title: r.title } : undefined)) close();
                },
              ),
            )}
          </section>
        )}

        {games.length > 0 && (
          <section className="ia-group">
            <div className="fp-head">{L('Παρτίδα που έχεις ανοιχτή', 'A game you have open')}</div>
            {games.map((g) => option(`tab-${g.id}`, <FileText size={18} />, g.title, L('Ξεκινά κοινή ανάλυση σε αυτή την παρτίδα', 'Starts a shared analysis on this game'), () => shareOpenGame(g.id, target)))}
          </section>
        )}

        <section className="ia-group">
          <div className="fp-head">{L('Νέα κοινή ανάλυση', 'New shared analysis')}</div>
          {option('pick', <Database size={18} />, L('Διάλεξε παρτίδα…', 'Pick a game…'), L('Από βάση, αρχείο ή PGN / FEN, στην καρτέλα «Κοινή ανάλυση»', 'From a database, a file or PGN / FEN, in the Shared analysis tab'), () => startShareFrom(target, null))}
          {option('empty', <FilePlus2 size={18} />, L('Άδεια σκακιέρα', 'Empty board'), L('Ξεκινά αμέσως, από την αρχική θέση', 'Starts right away, from the initial position'), () => startShareFrom(target, 'empty'))}
          {last && !lastRunning && option('resume', <History size={18} />, L('Η τελευταία κοινή ανάλυση', 'The last shared analysis'), last.title, () => startShareFrom(target, 'resume'))}
        </section>
        {!ok && <div className="play-note">{L('Δεν υπάρχει σύνδεση με τους Φίλους· δοκίμασε σε λίγο.', 'Not connected to Friends; try again shortly.')}</div>}
      </div>
    </Dialog>
  );
}
