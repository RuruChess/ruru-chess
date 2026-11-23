/**
 * Κοινή ανάλυση: ποιοι είναι μέσα και η φωνή. Σε κάθε άτομο: ποιος μιλά, μικρόφωνο, κάμερα, δική σου σίγαση και
 * ένταση· ο οικοδεσπότης δίνει ή παίρνει την άδεια αλλαγών και κάμερας, σιγεί κάποιον για όλους ή τον βγάζει. Πάνω,
 * ένα παράθυρο με μία κάμερα (κλικ σε όνομα με ανοιχτή κάμερα: καρφίτσωμα)· κάτω, τα κουμπιά της φωνής: μικρόφωνο,
 * deafen, κάμερα, έξοδος. Ίδιο στο Ruru και στη σελίδα του φίλου.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Crown, Eye, HeadphoneOff, Headphones, LoaderCircle, Mic, MicOff, Minus, MoreVertical, Pencil, PhoneOff, Pin, PinOff, TriangleAlert, Tv, UserX, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { canCam, canEdit, type Pid } from '../../core/share.ts';
import { L } from '../i18n.ts';
import { VideoEmbed, type VideoScope } from '../components/VideoEmbed.tsx';
import type { ShareConn } from './useShare.ts';
import './members.css';

export interface ShareVideoControl {
  open: boolean;
  localId: string | null;
  onLocalId: (id: string | null) => void;
  onOpenChange: (open: boolean) => void;
}

const HUES = [210, 150, 25, 280, 340, 190, 95, 45];
const hueOf = (pid: Pid) => HUES[[...pid].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

export function ShareMembers({ conn, video }: { conn: ShareConn; video?: ShareVideoControl }) {
  const { voice, rules, presence } = conn;
  const host = conn.pid === 'h';
  const canShareVideo = conn.canEdit;
  const guests = presence.online.filter((p) => p !== 'h');
  // ο οικοδεσπότης πρώτος, μετά εμείς, μετά οι άλλοι με τη σειρά που μπήκαν
  const order = [...presence.online].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
  function rank(p: Pid) {
    return p === 'h' ? 0 : p === conn.pid ? 1 : 2;
  }
  const editors = guests.filter((p) => canEdit(rules, p)).length;

  // βίντεο στην κοινή ανάλυση:
  // - αν υπάρχει κοινό βίντεο δωματίου (conn.video), φαίνεται μόνο εκείνο (χωρίς 2η τοπική επιλογή)
  // - αλλιώς κάθε συμμετέχων (και καλεσμένος) μπορεί να ανοίξει το δικό του τοπικό βίντεο
  // - όποιος έχει άδεια (host / editor) επιλέγει «Για όλους» ή «Μόνο για μένα»
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownLocalId, setOwnLocalId] = useState<string | null>(null);
  const localOpen = video ? video.open : ownOpen;
  const localId = video ? video.localId : ownLocalId;
  const setLocalOpen = video ? video.onOpenChange : setOwnOpen;
  const setLocalId = video ? video.onLocalId : setOwnLocalId;
  const [draftScope, setDraftScope] = useState<VideoScope>(() => (localId ? 'local' : host ? 'room' : 'local'));
  /** το id του κοινού βίντεο που βάλαμε εμείς οι ίδιοι (ώστε να μη μας ζητά «Προβολή») */
  const iSharedRef = useRef<string | null>(null);

  const roomVideo = conn.video;
  let videoBox: ReactNode = null;
  if (roomVideo) {
    videoBox = (
      <VideoEmbed
        videoId={roomVideo}
        editable={canShareVideo}
        requireConsent={iSharedRef.current !== roomVideo}
        scope={canShareVideo ? 'room' : undefined}
        onScopeChange={
          canShareVideo
            ? (next) => {
                if (next !== 'local') return;
                iSharedRef.current = null;
                setDraftScope('local');
                setLocalId(roomVideo);
                setLocalOpen(true);
                conn.send({ t: 'video', id: null });
              }
            : undefined
        }
        onChange={
          canShareVideo
            ? (id) => {
                iSharedRef.current = id;
                conn.send({ t: 'video', id });
                if (!id) setLocalOpen(false);
              }
            : undefined
        }
        onClose={
          canShareVideo
            ? () => {
                iSharedRef.current = null;
                conn.send({ t: 'video', id: null });
                setLocalOpen(false);
              }
            : undefined
        }
      />
    );
  } else if (localOpen || localId) {
    const activeScope: VideoScope = canShareVideo ? draftScope : 'local';
    videoBox = (
      <VideoEmbed
        videoId={localId}
        editable
        scope={canShareVideo ? activeScope : undefined}
        badge={!canShareVideo ? L('Μόνο για μένα', 'Only for me') : undefined}
        onScopeChange={
          canShareVideo
            ? (next) => {
                setDraftScope(next);
                if (next === 'room' && localId) {
                  iSharedRef.current = localId;
                  setLocalId(null);
                  conn.send({ t: 'video', id: localId });
                }
              }
            : undefined
        }
        onChange={(id) => {
          if (!id) {
            setLocalId(null);
            return;
          }
          if (canShareVideo && activeScope === 'room') {
            iSharedRef.current = id;
            setLocalId(null);
            conn.send({ t: 'video', id });
          } else {
            setLocalId(id);
          }
        }}
        onClose={() => {
          setLocalId(null);
          setLocalOpen(false);
        }}
      />
    );
  }

  return (
    <div className="sm">
      {videoBox}
      <ShareVideo conn={conn} />
      <div className="sm-head">
        <span className="sm-title">
          {L('Μέσα', 'Here')} · {presence.online.length}
        </span>
        <span className="sa-spacer" />
        {!roomVideo && !localOpen && !localId && (
          <button
            type="button"
            className="sm-vid-btn"
            title={
              canShareVideo
                ? L('Άνοιγμα βίντεο (YouTube / Twitch / Kick) για όλους ή μόνο για σένα', 'Open a video (YouTube / Twitch / Kick) for everyone or only for you')
                : L('Άνοιγμα τοπικού βίντεο (μόνο για σένα)', 'Open a local video (only for you)')
            }
            onClick={() => {
              setDraftScope(host ? 'room' : 'local');
              setLocalOpen(true);
            }}
          >
            <Tv size={12} aria-hidden />
            {L('Βίντεο', 'Video')}
          </button>
        )}
        {host && rules && (
          <span className="sm-all">
            <button
              type="button"
              className={rules.locked ? 'on' : ''}
              aria-pressed={!!rules.locked}
              title={rules.locked ? L('Δεν μπαίνει νέος καλεσμένος. Κλικ για ξεκλείδωμα.', 'No new guests can join. Click to unlock.') : L('Κλείδωμα: να μη μπαίνει νέος καλεσμένος', 'Lock: no new guests can join')}
              onClick={() => conn.send({ t: 'lock', on: !rules.locked })}
            >
              {rules.locked ? L('Κλειδωμένο', 'Locked') : L('Κλείδωμα', 'Lock')}
            </button>
          </span>
        )}
        {host && rules && guests.length > 0 && (
          <span className="sm-all" role="group" aria-label={L('Ποιοι αλλάζουν την ανάλυση', 'Who can change the analysis')}>
            <span className="faint">{L('Αλλάζουν:', 'Can edit:')}</span>
            <button type="button" className={editors === guests.length ? 'on' : ''} onClick={() => conn.send({ t: 'perm', pid: '*', edit: true })}>
              {L('Όλοι', 'Everyone')}
            </button>
            <button type="button" className={editors === 0 ? 'on' : ''} onClick={() => conn.send({ t: 'perm', pid: '*', edit: false })}>
              {L('Μόνο εγώ', 'Only me')}
            </button>
          </span>
        )}
      </div>
      <ul className="sm-list">
        {order.map((p) => (
          <Member key={p} conn={conn} pid={p} />
        ))}
      </ul>
      {voice.supported && <VoiceBar conn={conn} />}
    </div>
  );
}

function Member({ conn, pid }: { conn: ShareConn; pid: Pid }) {
  const { voice, rules } = conn;
  const me = pid === conn.pid;
  const name = conn.presence.names[pid] ?? pid;
  const vs = conn.voices[pid];
  const silenced = !!rules?.silenced.includes(pid);
  const mutedByMe = !!voice.muted[pid];
  const link = voice.links[pid];
  const speaking = !!voice.speaking[pid] && !(me ? false : mutedByMe || voice.deaf);
  const editor = canEdit(rules, pid);
  const hostView = conn.pid === 'h' && !!rules && pid !== 'h';
  const [menu, setMenu] = useState(false);
  // κάμερα: ανοιχτή (και με άδεια) → κλικ στο όνομα την καρφιτσώνει στο παράθυρο
  const camOn = voice.camSupported && voice.joined && !!vs?.cam && canCam(rules, pid);
  const pinned = voice.pinned === pid;
  const camOk = !!rules?.cams?.includes(pid);
  const who = (
    <>
      <span className={`sm-avatar${speaking ? ' speaking' : ''}`} style={{ '--hue': hueOf(pid) } as CSSProperties} aria-hidden>
        {initial(name)}
      </span>
      <span className="sm-name">
        <span className="sm-name-text">{name}</span>
        {pid === 'h' && <Crown size={13} className="sm-crown" aria-label={L('Host', 'Host')} />}
        {me && <span className="faint"> ({L('εσύ', 'you')})</span>}
      </span>
    </>
  );

  let state: { icon: ReactNode; title: string; cls: string } | null = null;
  if (vs) {
    if (silenced) state = { icon: <MicOff size={14} />, title: L('Σίγαση από τον οικοδεσπότη για όλους', 'Muted by the host for everyone'), cls: 'is-bad' };
    else if (vs.deaf) state = { icon: <HeadphoneOff size={14} />, title: L('Δεν ακούει (deafen)', 'Deafened'), cls: 'is-off' };
    else if (!vs.mic) state = { icon: <MicOff size={14} />, title: L('Μικρόφωνο κλειστό', 'Microphone off'), cls: 'is-off' };
    else state = { icon: <Mic size={14} />, title: L('Μικρόφωνο ανοιχτό', 'Microphone on'), cls: 'is-on' };
  }
  const linkInfo =
    !me && vs && voice.joined && link !== 'connected'
      ? link === 'failed'
        ? { icon: <TriangleAlert size={13} />, title: L('Η φωνή δεν συνδέθηκε με αυτό το άτομο (το δίκτυο δεν το επιτρέπει).', 'Voice could not connect to this person (the network does not allow it).'), cls: 'is-bad' }
        : { icon: <LoaderCircle size={13} className="sm-spin" />, title: L('Η φωνή συνδέεται…', 'Voice is connecting…'), cls: 'is-off' }
      : null;

  return (
    <li className={`sm-row${me ? ' me' : ''}${vs ? '' : ' out'}${pinned && camOn ? ' pinned' : ''}`}>
      {camOn ? (
        <button
          type="button"
          className="sm-who cam"
          aria-pressed={pinned}
          title={pinned ? L(`${name}: ξεκαρφίτσωμα από το παράθυρο της κάμερας`, `${name}: unpin from the camera window`) : L(`${name}: δείξε την κάμερά του/της στο παράθυρο`, `${name}: show their camera in the window`)}
          onClick={() => voice.pin(pinned ? null : pid)}
        >
          {who}
        </button>
      ) : (
        <span className="sm-who" title={name}>
          {who}
        </span>
      )}
      {rules && pid !== 'h' && (
        hostView ? (
          <button
            type="button"
            className={`sm-chip${editor ? ' edit' : ''}`}
            title={editor ? L('Αλλάζει την ανάλυση· πάτα για «μόνο βλέπει»', 'Can change the analysis; click for view only') : L('Μόνο βλέπει· πάτα για να αλλάζει την ανάλυση', 'View only; click to let them change the analysis')}
            aria-pressed={editor}
            onClick={() => conn.send({ t: 'perm', pid, edit: !editor })}
          >
            {editor ? <Pencil size={12} /> : <Eye size={12} />}
            {editor ? L('Αλλάζει', 'Edits') : L('Βλέπει', 'Views')}
          </button>
        ) : (
          <span className={`sm-chip static${editor ? ' edit' : ''}`} title={editor ? L('Αλλάζει την ανάλυση', 'Can change the analysis') : L('Μόνο βλέπει', 'View only')}>
            {editor ? <Pencil size={12} /> : <Eye size={12} />}
            {editor ? L('Αλλάζει', 'Edits') : L('Βλέπει', 'Views')}
          </span>
        )
      )}
      {hostView && voice.camSupported && (
        <button
          type="button"
          className={`sm-chip icon${camOk ? ' edit' : ''}`}
          aria-pressed={camOk}
          aria-label={L('Άδεια για κάμερα', 'Camera permission')}
          title={camOk ? L('Μπορεί να ανοίξει κάμερα· πάτα για να μην μπορεί', 'May turn the camera on; click to forbid') : L('Χωρίς κάμερα· πάτα για να μπορεί να ανοίξει κάμερα', 'No camera; click to allow the camera')}
          onClick={() => conn.send({ t: 'cam', pid, on: !camOk })}
        >
          {camOk ? <Video size={13} /> : <VideoOff size={13} />}
        </button>
      )}
      <span className="sm-icons">
        {camOn && (
          <span className={`sm-ic ${pinned ? 'is-pin' : 'is-on'}`} title={pinned ? L('Καρφιτσωμένη κάμερα', 'Pinned camera') : L('Κάμερα ανοιχτή', 'Camera on')}>
            {pinned ? <Pin size={13} /> : <Video size={14} />}
          </span>
        )}
        {linkInfo && (
          <span className={`sm-ic ${linkInfo.cls}`} title={linkInfo.title}>
            {linkInfo.icon}
          </span>
        )}
        {state ? (
          <span className={`sm-ic ${state.cls}`} title={state.title}>
            {state.icon}
          </span>
        ) : (
          voice.supported && <span className="sm-out faint small">{L('εκτός φωνής', 'not in voice')}</span>
        )}
        {!me && vs && voice.joined && (
          <button type="button" className={`sm-btn${mutedByMe ? ' is-bad' : ''}`} aria-pressed={mutedByMe} title={mutedByMe ? L('Άρση σίγασης (μόνο για σένα)', 'Unmute (just for you)') : L('Σίγαση μόνο για σένα: δεν τον/την ακούς εσύ', 'Mute just for you')} onClick={() => voice.setMuted(pid, !mutedByMe)}>
            {mutedByMe ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        )}
        {!me && (vs || hostView) && (
          <span className="sm-menu-wrap">
            <button type="button" className={`sm-btn${menu ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={menu} title={L('Περισσότερα', 'More')} onClick={() => setMenu((m) => !m)}>
              <MoreVertical size={15} />
            </button>
            {menu && <MemberMenu conn={conn} pid={pid} name={name} onClose={() => setMenu(false)} />}
          </span>
        )}
      </span>
    </li>
  );
}

function MemberMenu({ conn, pid, name, onClose }: { conn: ShareConn; pid: Pid; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { voice, rules } = conn;
  const hostView = conn.pid === 'h' && !!rules;
  const inVoice = !!conn.voices[pid] && voice.joined;
  const silenced = !!rules?.silenced.includes(pid);
  const editor = canEdit(rules, pid);
  const camOk = !!rules?.cams?.includes(pid);
  const vol = Math.round((voice.volume[pid] ?? 1) * 100);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div className="sm-menu" role="menu" ref={ref}>
      <div className="sm-menu-title">{name}</div>
      {inVoice && (
        <>
          <label className="sm-vol">
            <span>{L('Ένταση', 'Volume')}</span>
            <input type="range" min={0} max={100} step={5} value={vol} onChange={(e) => voice.setVolume(pid, Number(e.target.value) / 100)} onKeyDown={(e) => e.stopPropagation()} />
            <span className="tnum">{vol}%</span>
          </label>
          <button type="button" role="menuitemcheckbox" aria-checked={!!voice.muted[pid]} onClick={() => (voice.setMuted(pid, !voice.muted[pid]), onClose())}>
            {voice.muted[pid] ? <Volume2 size={15} /> : <VolumeX size={15} />}
            {voice.muted[pid] ? L('Άρση σίγασης για μένα', 'Unmute for me') : L('Σίγαση μόνο για μένα', 'Mute just for me')}
          </button>
        </>
      )}
      {hostView && (
        <>
          {inVoice && <div className="sm-menu-sep" />}
          <button type="button" role="menuitemcheckbox" aria-checked={editor} onClick={() => (conn.send({ t: 'perm', pid, edit: !editor }), onClose())}>
            {editor ? <Eye size={15} /> : <Pencil size={15} />}
            {editor ? L('Να μόνο βλέπει', 'View only') : L('Να αλλάζει την ανάλυση', 'Let them change the analysis')}
          </button>
          {voice.supported && <button type="button" role="menuitemcheckbox" aria-checked={silenced} onClick={() => (conn.send({ t: 'silence', pid, on: !silenced }), onClose())}>
            {silenced ? <Mic size={15} /> : <MicOff size={15} />}
            {silenced ? L('Άρση σίγασης για όλους', 'Unmute for everyone') : L('Σίγαση για όλους', 'Mute for everyone')}
          </button>}
          {voice.camSupported && (
            <button type="button" role="menuitemcheckbox" aria-checked={camOk} onClick={() => (conn.send({ t: 'cam', pid, on: !camOk }), onClose())}>
              {camOk ? <VideoOff size={15} /> : <Video size={15} />}
              {camOk ? L('Να μην ανοίγει κάμερα', 'Forbid the camera') : L('Να μπορεί να ανοίξει κάμερα', 'Allow the camera')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onClose();
              if (window.confirm(L(`Να βγει ο/η ${name} από την κοινή ανάλυση; Το δωμάτιο κλειδώνει: κανείς νέος δεν μπαίνει ώσπου να το ξεκλειδώσεις.`, `Remove ${name} from the shared analysis? The room locks: nobody new can join until you unlock it.`))) conn.send({ t: 'kick', pid });
            }}
          >
            <UserX size={15} />
            {L('Αποβολή από την ανάλυση', 'Remove from the analysis')}
          </button>
        </>
      )}
    </div>
  );
}

function VoiceBar({ conn }: { conn: ShareConn }) {
  const { voice } = conn;
  if (!voice.joined) {
    return (
      <div className="sm-voice-wrap">
        <p className="sm-ip small" id="sm-ip-note">
          {L(
            'Η φωνή και η κάμερα συνδέουν απευθείας τους συμμετέχοντες: όσοι είναι στη φωνή θα μπορούν να δουν τη διεύθυνση IP σου (δείχνει περίπου περιοχή και πάροχο). Μπες μόνο με ανθρώπους που εμπιστεύεσαι.',
            'Voice and camera connect participants directly: people in voice will be able to see your IP address (it shows your rough area and provider). Join only with people you trust.',
          )}
        </p>
        <div className="sm-voice">
          <button type="button" className="sm-join" aria-describedby="sm-ip-note" onClick={voice.join} disabled={conn.status !== 'open'}>
            <Headphones size={15} />
            {L('Μπες στη φωνή', 'Join voice')}
          </button>
          <span className="faint small">{voice.full ? L('Η φωνή είναι γεμάτη (8 άτομα).', 'Voice is full (8 people).') : L('Ακούς τους άλλους· το μικρόφωνο ανοίγει όταν το θες.', 'You hear the others; the microphone opens when you want.')}</span>
        </div>
      </div>
    );
  }
  const me = conn.pid ?? '';
  const text = voice.silenced
    ? L('Ο οικοδεσπότης σού έκλεισε το μικρόφωνο', 'The host muted you')
    : voice.deaf
      ? L('Δεν ακούς κανέναν', 'You hear no one')
      : voice.mic
        ? voice.speaking[me]
          ? L('Μιλάς…', 'Speaking…')
          : L('Μικρόφωνο ανοιχτό', 'Microphone on')
        : L('Ακούς · μικρόφωνο κλειστό', 'Listening · mic off');
  return (
    <div className="sm-voice-wrap">
      <div className="sm-voice">
        <button
          type="button"
          className={`sm-round${voice.mic ? ' on' : ' off'}`}
          disabled={voice.silenced}
          aria-pressed={voice.mic}
          title={voice.silenced ? L('Ο οικοδεσπότης σού έκλεισε το μικρόφωνο', 'The host muted you') : voice.mic ? L('Κλείσιμο μικροφώνου', 'Turn microphone off') : L('Άνοιγμα μικροφώνου', 'Turn microphone on')}
          onClick={voice.toggleMic}
        >
          {voice.mic ? <Mic size={17} /> : <MicOff size={17} />}
        </button>
        <button type="button" className={`sm-round${voice.deaf ? ' off' : ''}`} aria-pressed={voice.deaf} title={voice.deaf ? L('Να ακούω ξανά', 'Undeafen') : L('Deafen: να μην ακούω κανέναν (κλείνει και το μικρόφωνο)', 'Deafen: hear no one (also turns the mic off)')} onClick={voice.toggleDeaf}>
          {voice.deaf ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
        </button>
        {voice.camSupported && (
          <button
            type="button"
            className={`sm-round${voice.cam ? ' on' : ''}`}
            disabled={!voice.camAllowed}
            aria-pressed={voice.cam}
            title={!voice.camAllowed ? L('Κάμερα: χρειάζεσαι άδεια από τον οικοδεσπότη', 'Camera: the host has to allow it') : voice.cam ? L('Κλείσιμο κάμερας', 'Turn camera off') : L('Άνοιγμα κάμερας', 'Turn camera on')}
            onClick={voice.toggleCam}
          >
            {voice.cam ? <Video size={17} /> : <VideoOff size={17} />}
          </button>
        )}
        <span className={`sm-voice-text${voice.silenced ? ' is-bad' : ''}`}>{text}</span>
        <span className="sa-spacer" />
        <button type="button" className="sm-round leave" title={L('Έξοδος από τη φωνή', 'Leave voice')} onClick={voice.leave}>
          <PhoneOff size={16} />
        </button>
      </div>
      {voice.blocked && (
        <button type="button" className="sm-unblock" onClick={voice.unblock}>
          <Volume2 size={14} /> {L('Πάτα εδώ για να ακούς τους άλλους', 'Click here to hear the others')}
        </button>
      )}
      {voice.micError && <div className="sm-err">{voice.micError}</div>}
      {voice.camError && <div className="sm-err">{voice.camError}</div>}
    </div>
  );
}

/** Το ένα παράθυρο της κάμερας (16:9): όποιον καρφίτσωσες, αλλιώς ο host· μαζεύεται σε μια λωρίδα. */
function ShareVideo({ conn }: { conn: ShareConn }) {
  const { voice } = conn;
  const p = voice.shown;
  const ref = useRef<HTMLVideoElement>(null);
  const stream = p && !voice.collapsed ? voice.streamOf(p) : null;
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  });
  if (!p) return null;
  const name = conn.presence.names[p] ?? p;
  const me = p === conn.pid;
  const label = me ? `${name} (${L('εσύ', 'you')})` : name;
  if (voice.collapsed)
    return (
      <button type="button" className="sv-bar" title={L('Εμφάνιση της κάμερας', 'Show the camera')} onClick={() => voice.setCollapsed(false)}>
        <Video size={14} />
        <span className="sv-bar-name">{label}</span>
        <ChevronDown size={14} />
      </button>
    );
  return (
    <div className="sv">
      <span className="sv-ph" style={{ '--hue': hueOf(p) } as CSSProperties} aria-hidden>
        {initial(name)}
      </span>
      <video ref={ref} className={me ? 'mirror' : ''} autoPlay playsInline muted aria-label={L(`Κάμερα: ${label}`, `Camera: ${label}`)} />
      <span className="sv-name">
        {voice.pinned === p && <Pin size={11} />}
        {label}
      </span>
      <span className="sv-tools">
        {voice.pinned === p && (
          <button type="button" title={L('Ξεκαρφίτσωμα (ξανά ο οικοδεσπότης)', 'Unpin (back to the host)')} onClick={() => voice.pin(null)}>
            <PinOff size={14} />
          </button>
        )}
        <button type="button" title={L('Μάζεμα: μόνο σκάκι (δεν έρχεται βίντεο)', 'Collapse: chess only (no video comes in)')} onClick={() => voice.setCollapsed(true)}>
          <Minus size={14} />
        </button>
      </span>
    </div>
  );
}

/** Για όποιον μόνο βλέπει: τι ισχύει, και μικρό «τίναγμα» όταν προσπαθεί να αλλάξει κάτι. */
export function ShareViewOnly({ conn }: { conn: ShareConn }) {
  const [flash, setFlash] = useState(false);
  const [granted, setGranted] = useState(false);
  const prev = useRef(conn.canEdit);
  useEffect(() => {
    if (!conn.blockedAt) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [conn.blockedAt]);
  useEffect(() => {
    const was = prev.current;
    prev.current = conn.canEdit;
    if (!conn.rules || conn.pid === 'h' || was === conn.canEdit || !conn.canEdit) return;
    setGranted(true);
    const t = setTimeout(() => setGranted(false), 5000);
    return () => clearTimeout(t);
  }, [conn.canEdit, conn.rules, conn.pid]);

  if (!conn.rules || conn.pid === 'h' || conn.status !== 'open') return null;
  if (conn.canEdit)
    return granted ? (
      <div className="sm-note ok">
        <Pencil size={14} /> {L('Ο οικοδεσπότης σού έδωσε άδεια: τώρα αλλάζεις κι εσύ την ανάλυση.', 'The host let you in: you can now change the analysis.')}
      </div>
    ) : null;
  return (
    <div className={`sm-note${flash ? ' flash' : ''}`}>
      <Eye size={14} /> {L('Βλέπεις μόνο. Ο οικοδεσπότης αποφασίζει ποιος αλλάζει την ανάλυση.', 'View only. The host decides who can change the analysis.')}
    </div>
  );
}
