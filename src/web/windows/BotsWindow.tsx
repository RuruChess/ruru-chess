/**
 * Καρτέλα «Παίξε με bots»: η σκάλα των αντιπάλων (από τον αρχάριο ως τη μηχανή στο φουλ), οι επιλογές
 * (χρώμα, ρολόι, βοήθειες) και η παρτίδα με το bot μέσα στην καρτέλα· στο τέλος ανάλυση, ρεβάνς ή ο
 * επόμενος αντίπαλος. Τα bots και η λογική τους είναι από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0).
 */
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Bot, FlipVertical2, RotateCcw, Settings as SettingsIcon, Swords, Trophy } from 'lucide-react';
import { Tag } from '../components/ui/Chip.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { Switch } from '../components/ui/Switch.tsx';
import { api } from '../api.ts';
import { L } from '../i18n.ts';
import { newTabId, useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { ENGINE_BOTS, LEELA_BOT, addOutcome, maiaBot, type BotRecord, type BotSpec } from '../play/bots.ts';
import { useLc0 } from '../play/lc0.ts';
import { Lc0Install } from '../components/Lc0Install.tsx';
import { NO_HINTS, type PlayHints, type PlaySettings } from '../play/session.ts';
import { BotAvatar, PlayGame, count, eloTag, t2 } from '../play/PlayGame.tsx';
import '../tactics/tactics.css';
import '../play/play.css';

/** Χρονικοί έλεγχοι bullet / blitz / rapid / κλασικές (λεπτά + δευτερόλεπτα προσαύξησης). */
const TIME_CONTROLS = ['1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0'];

/** Όρια Elo όταν η μηχανή δεν τα δηλώνει (Stockfish: 1320–3190). */
const ELO_RANGE = { min: 1320, max: 3190 };

/** Οι ρυθμίσεις και τα αποτελέσματα που θυμάται η καρτέλα (στο `ui.bots`). */
interface Remembered {
  bot?: string;
  color?: 'white' | 'black' | 'random';
  tc?: string;
  hints?: PlayHints;
  customElo?: number;
  customMode?: 'elo' | 'level';
  customLevel?: number;
  stats?: Record<string, BotRecord>;
}

function remembered(): Remembered {
  return (((useApp.getState().settings?.ui as Record<string, unknown> | undefined)?.bots ?? {}) as Remembered) || {};
}

function customBot(useElo: boolean, elo: number, level: number): BotSpec {
  return {
    id: 'custom',
    name: ['Δικές σου ρυθμίσεις', 'Custom settings'],
    blurb: ['Διάλεξε μόνος σου τη δύναμη της μηχανής: Elo ή επίπεδο 0–20.', 'Choose the engine strength yourself: a rating or a level 0–20.'],
    elo: useElo ? elo : 800 + level * 110,
    style: 'balanced',
    strength: useElo ? { elo } : { skill: level },
    movetime: 800,
    nodes: 0,
    multipv: 1,
    window: 0,
    blunder: 0,
    book: 0,
    says: { hi: ['Έτοιμη.', 'Ready.'], won: ['Αυτή τη φορά κέρδισα εγώ.', 'I won this time.'], lost: ['Μπράβο σου!', 'Well done!'], draw: ['Ισοπαλία.', 'A draw.'] },
  };
}

export function BotsWindow({ active }: { active: boolean }) {
  const [game, setGame] = useState<{ s: PlaySettings; seq: number } | null>(null);
  const seq = useRef(0);
  const start = (s: PlaySettings) => setGame({ s, seq: ++seq.current });
  return (
    <div className="tx bots">
      {game ? <BotGame key={game.seq} s={game.s} active={active} onLobby={() => setGame(null)} onStart={start} /> : <Lobby onStart={start} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// επιλογή αντιπάλου

function Lobby({ onStart }: { onStart: (s: PlaySettings) => void }) {
  const settings = useApp((s) => s.settings);
  const openTab = useApp((s) => s.openTab);
  const mem = ((settings?.ui as Record<string, unknown> | undefined)?.bots ?? {}) as Remembered;
  const stats = mem.stats ?? {};
  const engines = (settings?.engines ?? []).filter((e) => !e.human);
  const [botId, setBotId] = useState(mem.bot ?? 'beginner');
  const [engineId, setEngineId] = useState(settings?.defaultEngine && engines.some((e) => e.id === settings.defaultEngine) ? settings.defaultEngine : (engines[0]?.id ?? ''));
  const [color, setColor] = useState<'white' | 'black' | 'random'>(mem.color ?? 'white');
  const [tc, setTc] = useState(mem.tc ?? '');
  const [hints, setHints] = useState<PlayHints>(mem.hints ?? NO_HINTS);
  const [customMode, setCustomMode] = useState<'elo' | 'level'>(mem.customMode ?? 'elo');
  const [customElo, setCustomElo] = useState(mem.customElo ?? 1600);
  const [customLevel, setCustomLevel] = useState(mem.customLevel ?? 8);
  /** όρια UCI_Elo της μηχανής (null: δεν υποστηρίζει Elo· undefined: δεν απάντησε ακόμη) */
  const [eloRange, setEloRange] = useState<{ min: number; max: number } | null | undefined>(undefined);

  useEffect(() => {
    if (!engineId || botId !== 'custom') return;
    let alive = true;
    api
      .get<{ options?: Array<{ name: string; min?: number; max?: number }> }>(`/api/engines/${encodeURIComponent(engineId)}/options`)
      .then((r) => {
        if (!alive) return;
        const o = r.options?.find((x) => x.name === 'UCI_Elo');
        const limit = r.options?.some((x) => x.name === 'UCI_LimitStrength');
        setEloRange(o && limit ? { min: o.min ?? ELO_RANGE.min, max: o.max ?? ELO_RANGE.max } : null);
      })
      .catch(() => alive && setEloRange(ELO_RANGE));
    return () => {
      alive = false;
    };
  }, [engineId, botId]);

  const range = eloRange ?? ELO_RANGE;
  const eloValue = Math.max(range.min, Math.min(range.max, customElo));
  const useElo = customMode === 'elo' && eloRange !== null;
  const custom = customBot(useElo, eloValue, customLevel);
  const lc0 = useLc0();
  const maiaLevels = (lc0?.maia ?? []).map((m) => m.elo).sort((a, b) => a - b);
  const hasLeela = Boolean(lc0?.leela);
  const maiaElo = /^maia-(\d+)$/.exec(botId)?.[1];
  const chosen =
    botId === 'custom'
      ? custom
      : botId === 'leela' && hasLeela
        ? LEELA_BOT
        : maiaElo && maiaLevels.includes(Number(maiaElo))
          ? maiaBot(Number(maiaElo))
          : (ENGINE_BOTS.find((b) => b.id === botId) ?? ENGINE_BOTS[0]);
  const clock = tc ? { base: Number(tc.split('+')[0]) * 60, inc: Number(tc.split('+')[1]) } : null;
  const beaten = ENGINE_BOTS.filter((b) => (stats[b.id]?.w ?? 0) > 0).length;
  const noEngine = !engines.length;

  const start = (bot = chosen) => {
    if (noEngine) return;
    const finalColor = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    setUiLater({ bots: { ...remembered(), bot: bot.id, color, tc, hints, customElo, customMode, customLevel } satisfies Remembered });
    onStart({ color: finalColor, bot, engineId: bot.id === 'custom' ? engineId : bot.kind === 'leela' ? (lc0?.leela ?? '') : '', clock, hints });
  };

  const rec = (b: BotSpec) => stats[b.id];
  const recText = (r: BotRecord) =>
    [count(r.w, ['νίκη', 'νίκες'], ['win', 'wins']), count(r.d, ['ισοπαλία', 'ισοπαλίες'], ['draw', 'draws']), count(r.l, ['ήττα', 'ήττες'], ['loss', 'losses'])].join(' · ');

  return (
    <div className="bots-lobby">
      <div className="bots-list">
        <header className="kb-head with-ic">
          <span className="kb-head-ic" aria-hidden>
            <Bot size={28} />
          </span>
          <div>
            <h1 className="kb-title" data-guide="bots">
              {L('Παίξε με bots', 'Play bots')}
            </h1>
            <p className="kb-sub">
              {L(
                'Δέκα αντίπαλοι με δικό τους χαρακτήρα, από τον αρχάριο ως τη μηχανή στο φουλ. Κάθε κάρτα κρατά τα αποτελέσματά σου.',
                'Ten opponents with their own character, from a beginner to the full-strength engine. Each card keeps your results.',
              )}
            </p>
            <div className="bots-progress tnum">
              <Trophy className="ic ic-sm" aria-hidden />
              {L(`Νίκησες ${beaten} από ${ENGINE_BOTS.length} αντιπάλους`, `You have beaten ${beaten} of ${ENGINE_BOTS.length} opponents`)}
            </div>
          </div>
        </header>
        <div className="bot-grid" role="list">
          {ENGINE_BOTS.map((b, i) => {
            const r = rec(b);
            const sel = chosen.id === b.id;
            return (
              <button key={b.id} type="button" role="listitem" className={`bot-card${sel ? ' is-sel' : ''}`} aria-pressed={sel} onClick={() => setBotId(b.id)} onDoubleClick={() => start(b)}>
                <span className="bot-level tnum" title={L('Επίπεδο', 'Level')}>
                  {i + 1}
                </span>
                <BotAvatar bot={b} />
                <span className="bot-txt">
                  <span className="bot-name">
                    {t2(b.name)}
                    <Tag>{eloTag(b)}</Tag>
                    {(r?.w ?? 0) > 0 && <Trophy className="ic ic-sm bot-won" aria-label={L('Τον έχεις νικήσει', 'Beaten')} />}
                  </span>
                  <span className="bot-blurb">{t2(b.blurb)}</span>
                  {r && <span className="bot-rec faint tnum">{recText(r)}</span>}
                </span>
              </button>
            );
          })}
          <button type="button" role="listitem" className={`bot-card${chosen.id === 'custom' ? ' is-sel' : ''}`} aria-pressed={chosen.id === 'custom'} onClick={() => setBotId('custom')}>
            <span className="bot-level tnum">·</span>
            <BotAvatar bot={custom} />
            <span className="bot-txt">
              <span className="bot-name">{t2(custom.name)}</span>
              <span className="bot-blurb">{t2(custom.blurb)}</span>
            </span>
          </button>
        </div>
        <h2 className="bots-sub">{L('Νευρωνικά δίκτυα: Leela και Maia', 'Neural networks: Leela and Maia')}</h2>
        {hasLeela || maiaLevels.length ? (
          <div className="bot-grid" role="list">
            {hasLeela && (
              <button type="button" role="listitem" className={`bot-card${chosen.id === 'leela' ? ' is-sel' : ''}`} aria-pressed={chosen.id === 'leela'} onClick={() => setBotId('leela')} onDoubleClick={() => start(LEELA_BOT)}>
                <BotAvatar bot={LEELA_BOT} />
                <span className="bot-txt">
                  <span className="bot-name">
                    {t2(LEELA_BOT.name)}
                    <Tag>{L('παίζει για νίκη', 'plays to win')}</Tag>
                  </span>
                  <span className="bot-blurb">{t2(LEELA_BOT.blurb)}</span>
                  {rec(LEELA_BOT) && <span className="bot-rec faint tnum">{recText(rec(LEELA_BOT)!)}</span>}
                </span>
              </button>
            )}
            {maiaLevels.length > 0 && (
              <div role="listitem" className={`bot-card maia-card${chosen.kind === 'maia' ? ' is-sel' : ''}`}>
                <BotAvatar bot={maiaBot(maiaLevels[0])} />
                <span className="bot-txt">
                  <span className="bot-name">{L('Maia: σαν άνθρωπος', 'Maia: like a human')}</span>
                  <span className="bot-blurb">{L('Παίζει όπως οι άνθρωποι αυτού του Elo: ίδιες ιδέες, ίδια λάθη.', 'Plays like humans of that rating: the same ideas and mistakes.')}</span>
                  <span className="maia-chips" role="group" aria-label={L('Elo της Maia', 'Maia rating')}>
                    {maiaLevels.map((elo) => (
                      <button key={elo} type="button" className={`chip tnum${chosen.id === `maia-${elo}` ? ' is-on' : ''}`} aria-pressed={chosen.id === `maia-${elo}`} onClick={() => setBotId(`maia-${elo}`)}>
                        {elo}
                      </button>
                    ))}
                  </span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <Lc0Install variant="tx" />
        )}
      </div>

      <aside className="bots-setup" aria-label={L('Ρυθμίσεις της παρτίδας', 'Game settings')}>
        <div className="bots-chosen">
          <BotAvatar bot={chosen} large />
          <div className="bot-txt">
            <div className="bots-chosen-name">
              {t2(chosen.name)}
              {chosen.id !== 'custom' && <Tag>{eloTag(chosen)}</Tag>}
            </div>
            <div className="muted small">{t2(chosen.blurb)}</div>
          </div>
        </div>
        {chosen.id !== 'custom' && <div className="bot-say">{t2(chosen.says.hi)}</div>}

        {chosen.id === 'custom' && (
          <div className="play-custom">
            {engines.length > 1 && (
              <label className="field">
                <span className="field-label">{L('Μηχανή', 'Engine')}</span>
                <select className="select" value={engineId} onChange={(e) => setEngineId(e.target.value)}>
                  {engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Segmented
              label={L('Δύναμη', 'Strength')}
              value={useElo ? 'elo' : 'level'}
              onChange={(v) => setCustomMode(v)}
              options={[
                { value: 'elo', label: 'Elo', title: eloRange === null ? L('Η μηχανή δεν υποστηρίζει Elo', 'The engine does not support Elo') : undefined },
                { value: 'level', label: L('Επίπεδο 0–20', 'Level 0–20') },
              ]}
            />
            {useElo ? (
              <label className="field">
                <span className="field-label tnum">Elo: {eloValue}</span>
                <input type="range" min={range.min} max={range.max} step={10} value={eloValue} onChange={(e) => setCustomElo(Number(e.target.value))} />
              </label>
            ) : (
              <label className="field">
                <span className="field-label tnum">
                  {L('Επίπεδο', 'Level')}: {customLevel}/20
                </span>
                <input type="range" min={0} max={20} value={customLevel} onChange={(e) => setCustomLevel(Number(e.target.value))} />
              </label>
            )}
          </div>
        )}

        <div className="play-opt">
          <span className="field-label">{L('Παίζω με', 'I play')}</span>
          <Segmented
            label={L('Παίζω με', 'I play')}
            value={color}
            onChange={setColor}
            options={[
              { value: 'white', label: L('Λευκά', 'White') },
              { value: 'black', label: L('Μαύρα', 'Black') },
              { value: 'random', label: L('Τυχαία', 'Random') },
            ]}
          />
        </div>
        <label className="play-opt">
          <span className="field-label">{L('Ρολόι', 'Clock')}</span>
          <select className="select" value={tc} onChange={(e) => setTc(e.target.value)}>
            <option value="">{L('Χωρίς ρολόι', 'No clock')}</option>
            {TIME_CONTROLS.map((t) => {
              const m = Number(t.split('+')[0]);
              return (
                <option key={t} value={t}>
                  {t.replace('+', ' + ')} {m < 3 ? '(bullet)' : m < 10 ? '(blitz)' : '(rapid)'}
                </option>
              );
            })}
          </select>
        </label>
        <div className="play-opt">
          <span className="field-label">{L('Βοήθειες (ανάβουν και σβήνουν και στη διάρκεια)', 'Hints (can be toggled during the game too)')}</span>
          <div className="play-hints">
            <Switch checked={hints.best} onChange={(v) => setHints({ ...hints, best: v })} label={L('Βέλος καλύτερης κίνησης', 'Best-move arrow')} />
            <Switch checked={hints.threat} onChange={(v) => setHints({ ...hints, threat: v })} label={L('Απειλή του αντιπάλου', 'Opponent’s threat')} />
            <Switch checked={hints.evalBar} onChange={(v) => setHints({ ...hints, evalBar: v })} label={L('Μπάρα αξιολόγησης', 'Evaluation bar')} />
          </div>
        </div>

        {noEngine ? (
          <div className="play-note">
            <span>{L('Για να παίξεις χρειάζεται μια μηχανή (π.χ. Stockfish).', 'You need an engine (e.g. Stockfish) to play.')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTab({ id: 'settings', kind: 'settings', title: 'Settings' })}>
              <SettingsIcon className="ic ic-sm" aria-hidden />
              {L('Ρυθμίσεις → Μηχανές', 'Settings → Engines')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary bots-start" onClick={() => start()}>
            <Swords className="ic" aria-hidden />
            {L(`Παίξε με: ${t2(chosen.name)}`, `Play ${t2(chosen.name)}`)}
          </button>
        )}
        {rec(chosen) && <div className="faint small tnum">{recText(rec(chosen)!)}</div>}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// η παρτίδα

function BotGame({ s, active, onLobby, onStart }: { s: PlaySettings; active: boolean; onLobby: () => void; onStart: (s: PlaySettings) => void }) {
  const openTab = useApp((st) => st.openTab);
  const bot = s.bot;
  const i = ENGINE_BOTS.findIndex((b) => b.id === bot.id);
  const nextBot = i >= 0 && i < ENGINE_BOTS.length - 1 ? ENGINE_BOTS[i + 1] : null;
  const player = L('Παίκτης', 'Player');
  const title = s.color === 'white' ? `${player} – ${t2(bot.name)}` : `${t2(bot.name)} – ${player}`;
  return (
    <PlayGame
      s={s}
      active={active}
      event={L('Παιχνίδι με bot', 'Bot game')}
      backLabel={L('Όλοι οι αντίπαλοι', 'All opponents')}
      onBack={onLobby}
      speech
      head={
        <div className="bots-chosen">
          <BotAvatar bot={bot} large />
          <div className="bot-txt">
            <div className="bots-chosen-name">
              {t2(bot.name)}
              {bot.id !== 'custom' && <Tag>{eloTag(bot)}</Tag>}
            </div>
            <div className="muted small">{t2(bot.blurb)}</div>
          </div>
        </div>
      }
      onFinish={(r) => {
        const mem = remembered();
        const stats = { ...(mem.stats ?? {}) };
        stats[bot.id] = addOutcome(stats[bot.id], r.outcome);
        setUiLater({ bots: { ...mem, stats } });
      }}
      endActions={(r, pgn) => (
        <>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openTab({ id: newTabId('game'), kind: 'game', title, pgn })}>
            <Activity className="ic ic-sm" aria-hidden />
            {L('Ανάλυση της παρτίδας', 'Analyse the game')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart({ ...s })}>
            <RotateCcw className="ic ic-sm" aria-hidden />
            {L('Ξανά', 'Play again')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart({ ...s, color: s.color === 'white' ? 'black' : 'white' })}>
            <FlipVertical2 className="ic ic-sm" aria-hidden />
            {L('Με τα άλλα χρώματα', 'Swap colours')}
          </button>
          {r.outcome === 'win' && nextBot && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart({ ...s, bot: nextBot, engineId: '' })}>
              <ArrowRight className="ic ic-sm" aria-hidden />
              {L(`Επόμενος: ${t2(nextBot.name)}`, `Next: ${t2(nextBot.name)}`)}
            </button>
          )}
        </>
      )}
    />
  );
}
