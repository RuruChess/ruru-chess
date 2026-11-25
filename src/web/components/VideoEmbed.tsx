/**
 * Ενσωματωμένη οθόνη βίντεο (YouTube, Twitch, Kick — live μεταδόσεις ή βίντεο ανάλυσης) για τη δεξιά
 * στήλη της σκακιέρας και για τη θέση πάνω από την κάμερα στην Κοινή ανάλυση. Δεν φορτώνει τίποτα
 * πριν βάλει link ο χρήστης (ή πατήσει «Προβολή» ο καλεσμένος, για απόρρητο).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ExternalLink, Link2, Minus, Play, RefreshCw, Tv, User, Users, X } from 'lucide-react';
import { parseVideoUrl, videoInfo, videoSyncTime, type VideoSyncState } from '../../core/share.ts';
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
  /** συγχρονισμός play/pause + λεπτού για κοινό YouTube βίντεο */
  syncEnabled?: boolean;
  onSyncToggle?: (on: boolean) => void;
  remoteSync?: VideoSyncState | null;
  myPid?: string | null;
  onSyncEmit?: (sync: { id: string; time: number; playing: boolean }) => void;
  /** κλήση όταν ο χρήστης βάλει ή σβήσει βίντεο */
  onChange?: (id: string | null) => void;
  /** κλείσιμο όλου του πλαισίου βίντεο (για editable) */
  onClose?: () => void;
  /** απόκρυψη κοινού βίντεο από καλεσμένο χωρίς άδεια (ώστε να μπορεί να ανοίξει δικό του) */
  onDismiss?: () => void;
}

const YT_ORIGINS = new Set(['https://www.youtube-nocookie.com', 'https://www.youtube.com']);

export function VideoEmbed({
  videoId,
  editable,
  requireConsent = false,
  scope,
  onScopeChange,
  badge,
  syncEnabled,
  onSyncToggle,
  remoteSync,
  myPid,
  onSyncEmit,
  onChange,
  onClose,
  onDismiss,
}: VideoEmbedProps) {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  // η «Προβολή» μετρά για ένα βίντεο: άλλο βίντεο (ή άλλη υπηρεσία) ζητά ξανά κλικ (PRIVACY.md)
  const [consentedId, setConsentedId] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const info = videoInfo(videoId, typeof location !== 'undefined' ? location.hostname : '127.0.0.1');
  const needsConsent = Boolean(requireConsent && consentedId !== videoId && info && videoId && (!editable || dismissedId !== videoId));
  const iframeVisible = Boolean(info && !needsConsent && (editable || dismissedId !== videoId));
  const ytSyncActive = Boolean(iframeVisible && info?.provider === 'youtube' && syncEnabled !== undefined);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ytRef = useRef({ ready: false, time: 0, state: -1, duration: 0, isLive: false, lastReportAt: 0, suppressUntil: 0, lastSentKey: '', lastSentAt: 0 });
  const latestRef = useRef({ editable, syncEnabled, remoteSync, myPid, videoId, onSyncEmit });
  latestRef.current = { editable, syncEnabled, remoteSync, myPid, videoId, onSyncEmit };

  const ytCmd = (func: string, args: unknown[] = []) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
    } catch {
      // το iframe δεν είναι έτοιμο ακόμη
    }
  };

  const applyRemoteSync = (sync: VideoSyncState) => {
    const yt = ytRef.current;
    if (!yt.ready || yt.isLive) return;
    const target = videoSyncTime(sync);
    yt.suppressUntil = Date.now() + 1800;
    if (Math.abs(yt.time - target) > 2.5) {
      ytCmd('seekTo', [target, true]);
      yt.time = target;
      yt.lastReportAt = Date.now();
    }
    if (sync.playing) {
      if (yt.state !== 1 && yt.state !== 3) ytCmd('playVideo');
    } else if (yt.state === 1) {
      ytCmd('pauseVideo');
    }
  };

  const pingYouTube = () => {
    try {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube-nocookie.com');
    } catch {
      // αγνοούμε πριν φορτώσει το iframe
    }
  };

  // επαναφορά της κατάστασης player όταν αλλάζει βίντεο
  useEffect(() => {
    ytRef.current = { ready: false, time: 0, state: -1, duration: 0, isLive: false, lastReportAt: 0, suppressUntil: 0, lastSentKey: '', lastSentAt: 0 };
  }, [info?.embedUrl]);

  // ακρόαση συμβάντων YouTube IFrame API (χωρίς εξωτερικό script — μόνο postMessage στο ήδη φορτωμένο iframe)
  useEffect(() => {
    if (!ytSyncActive) return;
    let tries = 0;
    const retry = setInterval(() => {
      if (ytRef.current.ready || ++tries > 10) {
        clearInterval(retry);
        return;
      }
      pingYouTube();
    }, 500);

    const onMessage = (ev: MessageEvent) => {
      if (!YT_ORIGINS.has(ev.origin) || ev.source !== iframeRef.current?.contentWindow) return;
      if (typeof ev.data !== 'string') return;
      let msg: { event?: string; info?: Record<string, unknown> };
      try {
        msg = JSON.parse(ev.data) as { event?: string; info?: Record<string, unknown> };
      } catch {
        return;
      }
      if (msg.event !== 'onReady' && msg.event !== 'initialDelivery' && msg.event !== 'infoDelivery') return;

      const yt = ytRef.current;
      const wasReady = yt.ready;
      yt.ready = true;
      const now = Date.now();
      const d = msg.info;
      const prevTime = yt.time;
      const prevState = yt.state;
      const prevAt = yt.lastReportAt;

      if (d && typeof d === 'object') {
        if (typeof d.duration === 'number' && Number.isFinite(d.duration)) yt.duration = d.duration;
        const vd = d.videoData as { isLive?: boolean } | undefined;
        if (vd && typeof vd.isLive === 'boolean') yt.isLive = vd.isLive;
        if (typeof d.playerState === 'number') yt.state = d.playerState;
        if (yt.duration === 0 && yt.state === 1) yt.isLive = true;
        if (typeof d.currentTime === 'number' && Number.isFinite(d.currentTime)) {
          yt.time = d.currentTime;
          yt.lastReportAt = now;
        }
      }

      const cur = latestRef.current;
      if (!wasReady) {
        if (cur.syncEnabled && cur.remoteSync && cur.remoteSync.id === cur.videoId && (!cur.remoteSync.by || cur.remoteSync.by !== cur.myPid)) {
          applyRemoteSync(cur.remoteSync);
        }
        return;
      }

      if (!cur.editable || !cur.syncEnabled || !cur.onSyncEmit || !cur.videoId || yt.isLive || now < yt.suppressUntil) return;
      const stateVal = d && typeof d.playerState === 'number' ? d.playerState : null;
      const stateChanged = (stateVal === 1 || stateVal === 2) && stateVal !== prevState;
      const timeVal = d && typeof d.currentTime === 'number' && Number.isFinite(d.currentTime) ? d.currentTime : null;
      const expected = prevState === 1 ? prevTime + Math.max(0, (now - prevAt) / 1000) : prevTime;
      const jumped = prevAt > 0 && timeVal !== null && (yt.state === 1 || yt.state === 2) && Math.abs(timeVal - expected) > 2.2;
      if (!stateChanged && !jumped) return;

      const key = `${yt.state}:${Math.round(yt.time)}`;
      if (key === yt.lastSentKey && now - yt.lastSentAt < 500) return;
      yt.lastSentKey = key;
      yt.lastSentAt = now;
      cur.onSyncEmit({ id: cur.videoId, time: yt.time, playing: yt.state === 1 });
    };

    window.addEventListener('message', onMessage);
    return () => {
      clearInterval(retry);
      window.removeEventListener('message', onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytSyncActive, info?.embedUrl]);

  // εφαρμογή εισερχόμενου συγχρονισμού (ή όταν ο χρήστης ενεργοποιεί ξανά το «Συγχρονισμός»)
  useEffect(() => {
    if (!ytSyncActive || !syncEnabled || !remoteSync || !videoId || remoteSync.id !== videoId) return;
    if (remoteSync.by && myPid && remoteSync.by === myPid) return;
    applyRemoteSync(remoteSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytSyncActive, syncEnabled, remoteSync, videoId, myPid]);

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

  const dismiss = () => {
    if (onDismiss) onDismiss();
    else if (videoId) setDismissedId(videoId);
  };

  // κοινό βίντεο από άλλον: ζητάμε κλικ «Προβολή» πριν φορτώσει εξωτερικό iframe (απόρρητο)
  if (needsConsent && info && videoId) {
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
                dismiss();
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
  const showScope = Boolean(editable && onScopeChange && scope);
  const showSync = Boolean(info?.provider === 'youtube' && syncEnabled !== undefined && onSyncToggle);

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
            } else {
              dismiss();
            }
          }}
        >
          <X size={14} />
        </button>
      </div>

      {(showScope || showSync) && !minimized && (
        <div className="yt-scope" role="group" aria-label={L('Επιλογές βίντεο', 'Video options')}>
          {showScope && (
            <>
              <button
                type="button"
                className={scope === 'room' ? 'on' : ''}
                aria-pressed={scope === 'room'}
                title={L('Το βίντεο φαίνεται σε όλους στο δωμάτιο', 'Everyone in the room sees this video')}
                onClick={() => onScopeChange!('room')}
              >
                <Users size={12} aria-hidden />
                {L('Για όλους', 'For everyone')}
              </button>
              <button
                type="button"
                className={scope === 'local' ? 'on' : ''}
                aria-pressed={scope === 'local'}
                title={L('Το βίντεο φαίνεται μόνο σε σένα· οι άλλοι μπορούν να βάλουν το δικό τους', 'Only you see this video; others can open their own')}
                onClick={() => onScopeChange!('local')}
              >
                <User size={12} aria-hidden />
                {L('Μόνο για μένα', 'Only for me')}
              </button>
            </>
          )}
          {showSync && (
            <button
              type="button"
              className={syncEnabled ? 'on' : ''}
              aria-pressed={syncEnabled}
              title={
                editable
                  ? L('Συγχρονισμός YouTube (play/pause και λεπτό) με όσους το έχουν ενεργό', 'Sync YouTube (play/pause and timestamp) with everyone who has sync on')
                  : L('Ακολουθείς αυτόματα το play/pause και το λεπτό του οικοδεσπότη', 'Automatically follow the host’s play/pause and timestamp')
              }
              onClick={() => {
                const next = !syncEnabled;
                onSyncToggle!(next);
                if (next && editable && onSyncEmit && videoId) {
                  const yt = ytRef.current;
                  if (yt.ready && !yt.isLive && (yt.state === 1 || yt.state === 2)) {
                    onSyncEmit({ id: videoId, time: yt.time, playing: yt.state === 1 });
                  }
                }
              }}
            >
              <RefreshCw size={12} aria-hidden />
              {L('Συγχρονισμός', 'Sync')}
            </button>
          )}
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
            ref={iframeRef}
            key={info.embedUrl}
            src={info.embedUrl}
            title={`${L('Βίντεο', 'Video')} ${info.label}`}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            onLoad={() => {
              if (ytSyncActive) pingYouTube();
            }}
          />
        </div>
      )}
    </div>
  );
}
