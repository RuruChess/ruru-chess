/** Μια συλλογή μόνη της: οι θέσεις της με τη σειρά, ανά ενότητα (αρχείο ή θέμα), με την κατάστασή τους· κλικ σε μια θέση τη λύνεις. */
import { useEffect, useState } from 'react';
import { Check, Play, X } from 'lucide-react';
import { L, fmtNum, language } from '../i18n.ts';
import { reportError } from '../store.ts';
import { Spinner } from '../components/ui/Progress.tsx';
import { Tag } from '../components/ui/Chip.tsx';
import { tacticsApi, type CollectionInfo, type CollectionItem, type SourceInfo } from './api.ts';
import { solutionText } from './sections.ts';

const PAGE = 100;

export function CollectionBrowser({ sources, current, file, onSource, onFile, onPick }: { sources: SourceInfo[]; current: string; file: string; onSource: (key: string) => void; onFile: (file: string) => void; onPick: (index: number) => void }) {
  const el = language() === 'el';
  const [info, setInfo] = useState<CollectionInfo | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setItems([]);
    tacticsApi
      .collection(current, file, 0, PAGE)
      .then((r) => {
        if (!live) return;
        setInfo(r);
        setItems(r.items);
      })
      .catch(reportError)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [current, file]);

  const more = () => {
    setLoading(true);
    tacticsApi
      .collection(current, file, items.length, PAGE)
      .then((r) => setItems((x) => [...x, ...r.items]))
      .catch(reportError)
      .finally(() => setLoading(false));
  };

  const all = info ? info.parts.reduce((a, x) => a + x.n, 0) : 0;
  // «με τη σειρά»: από την πρώτη θέση που δεν έχει λυθεί (στις θέσεις που φάνηκαν)
  const firstOpen = items.find((x) => x.status !== 'win')?.index ?? (info && items.length < info.total ? items.length : 0);
  const statusName = (s: CollectionItem['status']) => (s === 'win' ? L('λύθηκε', 'solved') : s === 'loss' ? L('με λάθος', 'missed') : L('όχι ακόμη', 'not yet'));

  return (
    <div className="tx-colv">
      <div className="tx-colv-in">
        <div className="panel tx-colv-head">
          <div className="tx-colv-pick">
            <label className="label" htmlFor="tx-colv-src">
              {L('Συλλογή', 'Collection')}
            </label>
            <select id="tx-colv-src" className="select select-sm" value={current} onChange={(e) => onSource(e.target.value)}>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {el ? s.name.el : s.name.en} ({fmtNum(s.count)})
                </option>
              ))}
            </select>
          </div>
          {info && (
            <>
              <p className="tx-colv-about">{el ? info.about.el : info.about.en}</p>
              <div className="tx-colv-meta">
                <Tag tone={info.solution === 'lines' ? 'ok' : info.solution === 'best' ? 'accent' : 'warn'}>{solutionText(info.solution)}</Tag>
                <span className="faint tnum">
                  {L(`${fmtNum(all)} θέσεις · λυμένες ${fmtNum(info.progress.solved)} · με λάθος ${fmtNum(info.progress.tried - info.progress.solved)}`, `${fmtNum(all)} positions · solved ${fmtNum(info.progress.solved)} · missed ${fmtNum(info.progress.tried - info.progress.solved)}`)}
                </span>
              </div>
              {info.parts.length > 1 && (
                <div className="tx-colv-parts" role="group" aria-label={L('Ενότητες', 'Sections')}>
                  <button type="button" className={`chip${!file ? ' is-on' : ''}`} aria-pressed={!file} onClick={() => onFile('')}>
                    {L('Όλες', 'All')} <span className="faint tnum">{fmtNum(all)}</span>
                  </button>
                  {info.parts.map((x) => (
                    <button key={x.name} type="button" className={`chip${file === x.name ? ' is-on' : ''}`} aria-pressed={file === x.name} onClick={() => onFile(x.name)}>
                      {(el ? x.name : x.en || x.name) || L('Άλλες', 'Other')} <span className="faint tnum">{fmtNum(x.n)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="tx-colv-start">
                <button type="button" className="btn btn-primary" disabled={!info.total} onClick={() => onPick(firstOpen)}>
                  <Play className="ic" aria-hidden />
                  {L('Λύσε με τη σειρά', 'Solve in order')}
                </button>
                <span className="faint">{L(`από τη θέση ${fmtNum(firstOpen + 1)}${file ? ` της ενότητας «${file}»` : ''}`, `from position ${fmtNum(firstOpen + 1)}${file ? ` of “${file}”` : ''}`)}</span>
              </div>
            </>
          )}
        </div>
        <div className="panel tx-colv-list" role="list" aria-label={L('Θέσεις', 'Positions')}>
          {items.map((it) => (
            <button key={it.id} type="button" role="listitem" className={`tx-colv-item${it.status ? ` is-${it.status}` : ''}`} onClick={() => onPick(it.index)} title={L('Λύσε αυτή τη θέση', 'Solve this position')}>
              <span className="tnum faint tx-colv-n">{fmtNum(it.index + 1)}</span>
              <span className="tx-colv-st" title={statusName(it.status)} aria-label={statusName(it.status)}>
                {it.status === 'win' ? <Check className="ic ic-sm" aria-hidden /> : it.status === 'loss' ? <X className="ic ic-sm" aria-hidden /> : '·'}
              </span>
              <span className="ellipsis">{(language() === 'en' && it.titleEn) || it.title || L(`Θέση ${it.seq}`, `Position ${it.seq}`)}</span>
              <span className="faint tnum">{it.rating}</span>
            </button>
          ))}
          {loading && (
            <div className="tx-loading">
              <Spinner label={L('Φόρτωση', 'Loading')} />
            </div>
          )}
          {info && items.length < info.total && !loading && (
            <button type="button" className="btn btn-ghost btn-sm tx-colv-more" onClick={more}>
              {L(`Περισσότερες (${fmtNum(info.total - items.length)} ακόμη)`, `More (${fmtNum(info.total - items.length)} left)`)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Το πλάγιο πάνελ όσο λύνεις μια συλλογή με τη σειρά: πού βρίσκεσαι και επιστροφή στη λίστα. */
export function CollectionSide({ name, file, index, total, solution, onList }: { name: string; file: string; index: number; total: number; solution: SourceInfo['solution']; onList: () => void }) {
  return (
    <div className="panel tx-stats">
      <div className="section-label">{name}</div>
      <p className="tnum">
        {L(`Θέση ${fmtNum(index + 1)} από ${fmtNum(total)}`, `Position ${fmtNum(index + 1)} of ${fmtNum(total)}`)}
        {file ? <span className="faint">{` · ${file}`}</span> : null}
      </p>
      <p className="faint tx-note">{solutionText(solution)}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onList}>
        {L('Όλες οι θέσεις της συλλογής', 'All positions of the collection')}
      </button>
    </div>
  );
}
