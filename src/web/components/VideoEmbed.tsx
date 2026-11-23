/**
 * Ενσωματωμένη οθόνη βίντεο (YouTube, Twitch, Kick — live μεταδόσεις ή βίντεο ανάλυσης) για τη δεξιά
 * στήλη της σκακιέρας και για τη θέση πάνω από την κάμερα στην Κοινή ανάλυση. Δεν φορτώνει τίποτα
 * πριν βάλει link ο χρήστης (ή πατήσει «Προβολή» ο καλεσμένος, για απόρρητο).
 */
import { useState, type FormEvent } from 'react';
import { ChevronDown, ExternalLink, Link2, Minus, Play, Tv, User, Users, X } from 'lucide-react';
import { parseVideoUrl, videoInfo } from '../../core/share.ts';
import { L } from '../i18n.ts';

export type VideoScope = 'room' | 'local';

interface VideoEmbedProps {
  /** ενεργό αναγνωριστικό βίντεο (`yt:…`, `tw:…`, `twv:…`, `kick:…`), ή null όταν περιμένει link */
  videoId: string | null;
  /** αν ο χρήστης μπορεί να βάλει/αλλάξει/σβήσει το link */
  editable: boolean;
  /** για κοινό βίντεο δωματίου από άλλον: απαιτεί κλικ «Προβολή» πριν φορτώσει το εξωτερικό iframe */
  requireConsent?: boolean;
  /** επιλογή εμβέλειας στην Κοινή Ανάλυση (μόνο για όποιον έχει άδεια): «Για όλους» ή «Μόνο για μένα» */
  scope?: VideoScope;
  onScopeChange?: (scope: VideoScope) => void;
  /** σύντομη ετικέτα εμβέλειας (π.χ. «Μόνο για μένα» για τοπικό βίντεο καλεσμένου) */
  badge?: string;
  /** κλήση όταν ο χρήστης βάλει ή σβήσει βίντεο */
  onChange?: (id: string | null) => void;
  /** κλείσιμο όλου του πλαισίου βίντεο */
  onClose?: () => void;
}

export function VideoEmbed({ videoId, editable, requireConsent = false, scope, onScopeChange, badge, onChange, onClose }: VideoEmbedProps) {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  // η «Προβολή» μετρά για ένα βίντεο: άλλο βίντεο (ή άλλη υπηρεσία) ζητά ξανά κλικ (PRIVACY.md)
  const [consentedId, setConsentedId] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const info = videoInfo(videoId, typeof location !== 'undefined' ? location.hostname : '127.0.0.1');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = parseVideoUrl(input);
    if (!id) {
      setError(L('Βάλε έγκυρο σύνδεσμο YouTube, Twitch ή Kick.', 'Paste a valid YouTube, Twitch or Kick link.'));
      return;
    }
    setError(null);
    setInput('');
    setEditing(false);
    setMinimized(false);
    setConsentedId(id);
    onChange?.(id);
  };

  // καλεσμένος χωρίς άδεια: έκρυψε αυτό το κοινό βίντεο
  if (!editable && (!info || dismissedId === videoId)) return null;

  // κοινό βίντεο από άλλον: ζητάμε κλικ «Προβολή» πριν φορτώσει εξωτερικό iframe (απόρρητο)
  if (requireConsent && consentedId !== videoId && info && videoId && (!editable || dismissedId !== videoId)) {
    return (
      <div className="yt-box yt-consent">
        <div className="yt-bar">
          <Tv size={14} className="yt-ic" aria-hidden />
          <span className="yt-title">{L(`Βίντεο ${info.label} στο δωμάτιο`, `${info.label} video in the room`)}</span>
        </div>
        <div className="yt-consent-act">
          <button type="button" className="sa-btn yt-play" onClick={() => setConsentedId(videoId)}>
            <Play size={13} aria-hidden />
            {L('Προβολή', 'Watch')}
          </button>
          <a className="sa-btn" href={info.watchUrl} target="_blank" rel="noreferrer" title={L(`Άνοιγμα στο ${info.label}`, `Open on ${info.label}`)}>
            <ExternalLink size={13} aria-hidden />
            {info.label}
          </a>
          <button
            type="button"
            className="sa-icon-btn"
            title={editable ? L('Κλείσιμο για όλους', 'Close for everyone') : L('Απόκρυψη', 'Hide')}
            aria-label={editable ? L('Κλείσιμο για όλους', 'Close for everyone') : L('Απόκρυψη', 'Hide')}
            onClick={() => {
              if (editable) {
                onChange?.(null);
                onClose?.();
              } else {
                setDismissedId(videoId);
              }
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  const showForm = editable && (!info || editing);

  return (
    <div className={`yt-box${minimized ? ' is-min' : ''}`}>
      <div className="yt-bar">
        <Tv size={14} className="yt-ic" aria-hidden />
        <span className="yt-title">
          {info ? `${L('Βίντεο', 'Video')} · ${info.label}` : L('Βίντεο', 'Video')}
          {badge ? ` · ${badge}` : ''}
          {info && minimized ? ` · ${L('ήχος σε εξέλιξη', 'playing')}` : ''}
        </span>
        <span className="sa-spacer" />
        {info && editable && (
          <button
            type="button"
            className="sa-icon-btn"
            title={L('Αλλαγή συνδέσμου βίντεο', 'Change video link')}
            aria-label={L('Αλλαγή συνδέσμου βίντεο', 'Change video link')}
            onClick={() => {
              setEditing((v) => !v);
              setError(null);
            }}
          >
            <Link2 size={14} />
          </button>
        )}
        {info && (
          <a className="sa-icon-btn" href={info.watchUrl} target="_blank" rel="noreferrer" title={L(`Άνοιγμα στο ${info.label}`, `Open on ${info.label}`)} aria-label={L(`Άνοιγμα στο ${info.label}`, `Open on ${info.label}`)}>
            <ExternalLink size={14} />
          </a>
        )}
        {info && (
          <button
            type="button"
            className="sa-icon-btn"
            title={minimized ? L('Εμφάνιση βίντεο', 'Show video') : L('Ελαχιστοποίηση (συνεχίζει ο ήχος)', 'Minimise (audio keeps playing)')}
            aria-label={minimized ? L('Εμφάνιση βίντεο', 'Show video') : L('Ελαχιστοποίηση', 'Minimise')}
            onClick={() => setMinimized((m) => !m)}
          >
            {minimized ? <ChevronDown size={15} /> : <Minus size={14} />}
          </button>
        )}
        <button
          type="button"
          className="sa-icon-btn"
          title={L('Κλείσιμο βίντεο', 'Close video')}
          aria-label={L('Κλείσιμο βίντεο', 'Close video')}
          onClick={() => {
            if (editable) {
              onChange?.(null);
              onClose?.();
            } else if (videoId) {
              setDismissedId(videoId);
            }
          }}
        >
          <X size={14} />
        </button>
      </div>

      {editable && onScopeChange && scope && !minimized && (
        <div className="yt-scope" role="group" aria-label={L('Ποιος βλέπει το βίντεο', 'Who sees the video')}>
          <button
            type="button"
            className={scope === 'room' ? 'on' : ''}
            aria-pressed={scope === 'room'}
            title={L('Το βίντεο φαίνεται σε όλους στο δωμάτιο', 'Everyone in the room sees this video')}
            onClick={() => onScopeChange('room')}
          >
            <Users size={12} aria-hidden />
            {L('Για όλους', 'For everyone')}
          </button>
          <button
            type="button"
            className={scope === 'local' ? 'on' : ''}
            aria-pressed={scope === 'local'}
            title={L('Το βίντεο φαίνεται μόνο σε σένα· οι άλλοι μπορούν να βάλουν το δικό τους', 'Only you see this video; others can open their own')}
            onClick={() => onScopeChange('local')}
          >
            <User size={12} aria-hidden />
            {L('Μόνο για μένα', 'Only for me')}
          </button>
        </div>
      )}

      {showForm && (
        <form className="yt-form" onSubmit={submit}>
          <div className="sa-row">
            <input
              className="sa-input"
              value={input}
              placeholder={L('Link από YouTube, Twitch ή Kick…', 'YouTube, Twitch or Kick link…')}
              aria-label={L('Σύνδεσμος βίντεο', 'Video link')}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError(null);
              }}
            />
            <button type="submit" className="sa-btn" disabled={!input.trim()}>
              {L('Άνοιγμα', 'Open')}
            </button>
          </div>
          {error && <div className="yt-err">{error}</div>}
          <div className="yt-hint faint small">{L('Υποστηρίζει YouTube, Twitch και Kick — φορτώνει μόνο αφού βάλεις link.', 'Supports YouTube, Twitch and Kick — loads only after you paste a link.')}</div>
        </form>
      )}

      {info && (
        <div className={`yt-frame${minimized ? ' hidden' : ''}`}>
          <iframe
            key={info.embedUrl}
            src={info.embedUrl}
            title={`${L('Βίντεο', 'Video')} ${info.label}`}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
