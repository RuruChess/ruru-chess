/**
 * Κοινή ανάλυση: φωνή. Ο ήχος πάει απευθείας από browser σε browser (WebRTC, ο καθένας σε όλους, ως 8 άτομα)·
 * το relay μόνο προωθεί τα σήματα σύνδεσης. Κάθε ζεύγος έχει μία σύνδεση με ένα κανάλι ήχου από την αρχή, ώστε
 * το μικρόφωνο να ανοιγοκλείνει με `replaceTrack` χωρίς νέα διαπραγμάτευση. Την προσφορά τη στέλνει πάντα ο ίδιος
 * από τους δύο (το μικρότερο pid), άρα οι δύο πλευρές δεν συγκρούονται. Η σίγαση του οικοδεσπότη ισχύει και εδώ:
 * τον ήχο όποιου έχει σιγηθεί δεν τον παίζει κανείς, όποιο πρόγραμμα κι αν τρέχει εκείνος.
 *
 * Κάμερα: κάθε σύνδεση έχει από την αρχή και κανάλι βίντεο (πάλι `replaceTrack`, χωρίς νέα διαπραγμάτευση). Φαίνεται
 * μία κάμερα τη φορά, και ο καθένας λέει ποιου την κάμερα βλέπει (`watch`): η κάμερα στέλνει βίντεο μόνο σε όσους
 * τη βλέπουν, ελαφρύ (360p, 20 fps, ~300 kbps). Βίντεο όποιου δεν έχει άδεια από τον οικοδεσπότη δεν δείχνει κανείς.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { randomId } from '../../core/online.ts';
import { VOICE } from '../../core/features.ts';
import { VOICE_MAX, canCam, pickCamera, type Pid, type RtcSignal, type ShareClientMsg, type ShareRules, type VoiceState } from '../../core/share.ts';
import { L } from '../i18n.ts';

export type LinkState = 'connecting' | 'connected' | 'failed';

export interface VoiceConn {
  /** το relay και ο browser ξέρουν φωνή */
  supported: boolean;
  joined: boolean;
  mic: boolean;
  deaf: boolean;
  /** ο οικοδεσπότης μάς έκλεισε το μικρόφωνο */
  silenced: boolean;
  /** η φωνή είναι γεμάτη */
  full: boolean;
  micError: string | null;
  /** ο browser δεν παίζει ήχο πριν από ένα κλικ στη σελίδα */
  blocked: boolean;
  speaking: Record<Pid, boolean>;
  links: Record<Pid, LinkState>;
  muted: Record<Pid, boolean>;
  volume: Record<Pid, number>;
  join: () => void;
  leave: () => void;
  toggleMic: () => void;
  toggleDeaf: () => void;
  setMuted: (pid: Pid, on: boolean) => void;
  setVolume: (pid: Pid, v: number) => void;
  unblock: () => void;
  /** το relay ξέρει κάμερα (έκδοση 3) */
  camSupported: boolean;
  cam: boolean;
  /** έχουμε άδεια για κάμερα (ο οικοδεσπότης πάντα) */
  camAllowed: boolean;
  camError: string | null;
  toggleCam: () => void;
  /** ποιου η κάμερα φαίνεται στο παράθυρο (null: καμία ανοιχτή) */
  shown: Pid | null;
  pinned: Pid | null;
  pin: (pid: Pid | null) => void;
  /** το παράθυρο της κάμερας είναι μαζεμένο (δεν έρχεται βίντεο) */
  collapsed: boolean;
  setCollapsed: (on: boolean) => void;
  /** το βίντεο κάποιου (το δικό μας: η προεπισκόπηση) */
  streamOf: (pid: Pid) => MediaStream | null;
}

interface Peer {
  pid: Pid;
  /** η είσοδος του άλλου στη φωνή στην οποία ανήκει αυτή η σύνδεση */
  sid: string;
  /** αύξων αριθμός προσπάθειας (αποφυγή σύγκρουσης ICE ανάμεσα σε retries) */
  gen: number;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** η κάμερα του άλλου (έρχεται εικόνα μόνο όσο τη βλέπουμε) */
  video: MediaStream | null;
  /** σήματα ICE που ήρθαν πριν από την περιγραφή του άλλου */
  ice: RTCIceCandidateInit[];
  tries: number;
  /** χρονόμετρο επανάληψης όταν το ICE μείνει σε `disconnected` */
  discTimer: ReturnType<typeof setTimeout> | null;
  retryScheduled: boolean;
}

// μόνο η Cloudflare, που είναι ήδη στην πολιτική απορρήτου: κάθε STUN/TURN server μαθαίνει την IP του χρήστη
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
const MAX_PENDING_ICE = 64;
const MAX_PENDING_KEYS = 32;
const iceKey = (p: Pid, remoteSid: string, gen: number) => `${p}:${remoteSid}:${gen}`;
/** κάμερα: 640×360, 20 fps, ~300 kbps προς κάθε άτομο που τη βλέπει */
const CAM_H = 360;
const CAM_FPS = 20;
const CAM_BITRATE = 300_000;
const CAM_VIDEO: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: CAM_H }, frameRate: { ideal: CAM_FPS, max: CAM_FPS }, facingMode: 'user' };
const CAM_MIN_KEY = 'kb.cam.min';

/** Το κανάλι ήχου ή βίντεο μιας σύνδεσης (με το είδος, όχι με τη σειρά). */
const trOf = (pc: RTCPeerConnection, kind: 'audio' | 'video') => pc.getTransceivers().find((t) => t.receiver.track.kind === kind);

/** Ελαφρύ βίντεο: όριο bitrate και fps, και μικρότερη εικόνα αν η κάμερα δίνει μεγαλύτερη από 360p. */
async function limitVideo(s: RTCRtpSender, t: MediaStreamTrack): Promise<void> {
  const p = s.getParameters();
  const e = p.encodings?.[0];
  if (!e) return;
  const scale = Math.max(1, (t.getSettings().height ?? CAM_H) / CAM_H);
  if (e.maxBitrate === CAM_BITRATE && e.maxFramerate === CAM_FPS && e.scaleResolutionDownBy === scale) return;
  e.maxBitrate = CAM_BITRATE;
  e.maxFramerate = CAM_FPS;
  e.scaleResolutionDownBy = scale;
  await s.setParameters(p).catch(() => {});
}
/** όποιος βγήκε από τη φωνή δεν ξαναμπαίνει μόνος του στην επόμενη κοινή ανάλυση */
const prefsKey = (id: string) => `kb.voice.${id}`;
/** όριο «μιλά» (~−40 dB): στάθμη 0–1 του ήχου που φτάνει (audioLevel) και RMS του δικού μας μικροφώνου */
const SPEAK_LEVEL = 0.01;
const SPEAK_RMS = 0.01;

function loadPrefs(id: string): { muted: Record<Pid, boolean>; volume: Record<Pid, number> } {
  try {
    const p = JSON.parse(localStorage.getItem(prefsKey(id)) ?? 'null') as { muted?: Record<Pid, boolean>; volume?: Record<Pid, number> } | null;
    return { muted: p?.muted ?? {}, volume: p?.volume ?? {} };
  } catch {
    return { muted: {}, volume: {} };
  }
}

function storage(fn: () => void): void {
  try {
    fn();
  } catch {
    // χωρίς αποθήκευση: απλώς δεν θυμόμαστε
  }
}

export function useVoice(o: {
  id: string;
  pid: Pid | null;
  v: number;
  status: string;
  voices: Record<Pid, VoiceState>;
  rules: ShareRules | null;
  send: (m: ShareClientMsg) => void;
  rtcRef: MutableRefObject<((by: Pid, data: RtcSignal) => void) | null>;
  fetchIceServers?: () => Promise<RTCIceServer[] | null>;
}): VoiceConn {
  const { id, pid, v, status, voices, rules } = o;
  const supported = VOICE && v >= 2 && typeof RTCPeerConnection !== 'undefined';
  const [joined, setJoined] = useState(false);
  const [mic, setMic] = useState(false);
  const [deaf, setDeaf] = useState(false);
  const [full, setFull] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [speaking, setSpeaking] = useState<Record<Pid, boolean>>({});
  const [links, setLinks] = useState<Record<Pid, LinkState>>({});
  const [prefs, setPrefs] = useState(() => loadPrefs(id));
  const silenced = !!pid && !!rules?.silenced.includes(pid);
  const camSupported = supported && v >= 3;
  const camAllowed = canCam(rules, pid);
  const [cam, setCam] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Pid | null>(null);
  const [collapsed, setCollapsedState] = useState(() => {
    let on = false;
    storage(() => {
      on = localStorage.getItem(CAM_MIN_KEY) === '1';
    });
    return on;
  });
  /** ήρθε βίντεο από κάποιον (για να ξαναζωγραφιστεί το παράθυρο) */
  const [, setVideoTick] = useState(0);

  // ποια κάμερα φαίνεται, και ποιου την κάμερα ζητάμε (όχι τη δική μας, όχι όταν το παράθυρο είναι μαζεμένο)
  const mine = pid && voices[pid] ? { ...voices, [pid]: { ...voices[pid], cam } } : voices;
  const order = Object.keys(voices).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const shown = camSupported && joined ? pickCamera({ me: pid, pinned, voices: mine, rules, order }) : null;
  const watch = shown && shown !== pid && !collapsed ? shown : undefined;

  const peers = useRef(new Map<Pid, Peer>());
  /** πρόωρα ICE candidates (πριν φτιαχτεί το peer από το offer ή πριν από το remoteDescription) */
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const genSeq = useRef(0);
  const iceServers = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const icePromise = useRef<Promise<RTCIceServer[]> | null>(null);
  const sid = useRef('');
  const track = useRef<MediaStreamTrack | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const meter = useRef<{ ctx: AudioContext; an: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null>(null);
  const wasMic = useRef(false);
  const announced = useRef(false);
  // τα τελευταία στοιχεία για τα callbacks του WebRTC (που ζουν έξω από το React)
  const live = useRef({ joined, deaf, mic, pid, voices, rules, prefs, send: o.send, fetchIceServers: o.fetchIceServers });
  live.current = { joined, deaf, mic, pid, voices, rules, prefs, send: o.send, fetchIceServers: o.fetchIceServers };

  const ensureIce = (refresh = false): Promise<RTCIceServer[]> => {
    if (!refresh && icePromise.current) return icePromise.current;
    const fn = live.current.fetchIceServers;
    if (!fn) return Promise.resolve(DEFAULT_ICE_SERVERS);
    const p = fn()
      .then((got) => {
        const list = got && got.length ? got : DEFAULT_ICE_SERVERS;
        iceServers.current = list;
        return list;
      })
      .catch(() => DEFAULT_ICE_SERVERS);
    icePromise.current = p;
    return p;
  };

  const setLink = (p: Pid, s: LinkState | null) =>
    setLinks((all) => {
      if ((all[p] ?? null) === s) return all;
      const next = { ...all };
      if (s) next[p] = s;
      else delete next[p];
      return next;
    });

  /** Ο ήχος ενός άλλου: σιωπή αν είμαστε σε deafen, αν τον σιγήσαμε εμείς ή αν τον σίγησε ο οικοδεσπότης. */
  const applyAudio = (peer: Peer) => {
    const l = live.current;
    peer.audio.muted = l.deaf || !!l.prefs.muted[peer.pid] || !!l.rules?.silenced.includes(peer.pid);
    peer.audio.volume = Math.max(0, Math.min(1, l.prefs.volume[peer.pid] ?? 1));
  };

  const play = (a: HTMLAudioElement) => {
    void a.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    );
  };

  const closePeer = (p: Pid) => {
    const peer = peers.current.get(p);
    if (!peer) return;
    peers.current.delete(p);
    if (peer.discTimer) clearTimeout(peer.discTimer);
    pendingIce.current.delete(iceKey(p, peer.sid, peer.gen));
    try {
      peer.pc.close();
    } catch {
      // ήδη κλειστή
    }
    peer.audio.srcObject = null;
    peer.video = null;
    setLink(p, null);
  };

  /** Η κάμερά μας προς αυτό το άτομο: μόνο αν τη βλέπει. */
  const syncVideo = (peer: Peer) => {
    const l = live.current;
    const tr = trOf(peer.pc, 'video');
    if (!tr) return;
    const t = camTrack.current && l.pid && l.voices[peer.pid]?.watch === l.pid ? camTrack.current : null;
    if (tr.sender.track !== t) void tr.sender.replaceTrack(t).catch(() => {});
    if (t) void limitVideo(tr.sender, t);
  };

  const closeAll = () => {
    for (const p of [...peers.current.keys()]) closePeer(p);
    pendingIce.current.clear();
  };

  const createPeer = (p: Pid, remoteSid: string, gen: number, initiator: boolean, tries: number, servers: RTCIceServer[]): Peer => {
    const pc = new RTCPeerConnection({ iceServers: servers });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pid: p, sid: remoteSid, gen, pc, audio, video: null, ice: [], tries, discTimer: null, retryScheduled: false };
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      if (c?.candidate && peers.current.get(p) === peer)
        live.current.send({ t: 'rtc', to: p, data: { sid: sid.current, gen, ice: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } } });
    };
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') {
        peer.video = new MediaStream([e.track]);
        setVideoTick((n) => n + 1);
        return;
      }
      audio.srcObject = new MediaStream([e.track]);
      applyAudio(peer);
      play(audio);
    };
    const scheduleRetry = () => {
      if (!initiator || tries >= 2 || peer.retryScheduled) return;
      peer.retryScheduled = true;
      setTimeout(() => {
        if (peers.current.get(p) !== peer || !live.current.joined) return;
        closePeer(p);
        void offer(p, remoteSid, tries + 1);
      }, 2000);
    };
    const checkState = () => {
      if (peers.current.get(p) !== peer) return;
      const cs = pc.connectionState;
      const is = pc.iceConnectionState;
      if (cs === 'connected' || is === 'connected' || is === 'completed') {
        if (peer.discTimer) {
          clearTimeout(peer.discTimer);
          peer.discTimer = null;
        }
        setLink(p, 'connected');
        return;
      }
      if (cs === 'failed' || is === 'failed') {
        if (peer.discTimer) {
          clearTimeout(peer.discTimer);
          peer.discTimer = null;
        }
        setLink(p, 'failed');
        scheduleRetry();
        return;
      }
      setLink(p, 'connecting');
      if (is === 'disconnected' && initiator && tries < 2 && !peer.discTimer) {
        peer.discTimer = setTimeout(() => {
          peer.discTimer = null;
          if (peers.current.get(p) !== peer || !live.current.joined) return;
          if (pc.iceConnectionState === 'disconnected' || pc.connectionState === 'disconnected') scheduleRetry();
        }, 5000);
      }
    };
    pc.onconnectionstatechange = checkState;
    pc.oniceconnectionstatechange = checkState;
    peers.current.set(p, peer);
    setLink(p, 'connecting');
    return peer;
  };

  const flushIce = async (peer: Peer) => {
    const key = iceKey(peer.pid, peer.sid, peer.gen);
    const early = pendingIce.current.get(key);
    if (early) {
      pendingIce.current.delete(key);
      peer.ice.unshift(...early);
    }
    for (const c of peer.ice.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  };

  async function offer(p: Pid, remoteSid: string, tries = 0): Promise<void> {
    const servers = await ensureIce(tries > 0);
    if (!live.current.joined || live.current.voices[p]?.sid !== remoteSid) return;
    const existing = peers.current.get(p);
    if (existing && existing.sid === remoteSid && tries === 0) return;
    if (existing) closePeer(p);
    const gen = ++genSeq.current;
    const peer = createPeer(p, remoteSid, gen, true, tries, servers);
    try {
      const tr = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (track.current) await tr.sender.replaceTrack(track.current);
      peer.pc.addTransceiver('video', { direction: 'sendrecv', sendEncodings: [{ maxBitrate: CAM_BITRATE, maxFramerate: CAM_FPS }] });
      syncVideo(peer);
      const desc = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(desc);
      if (peers.current.get(p) !== peer) return;
      live.current.send({ t: 'rtc', to: p, data: { sid: sid.current, gen, sdp: { type: 'offer', sdp: desc.sdp ?? '' } } });
    } catch {
      if (peers.current.get(p) === peer) setLink(p, 'failed');
    }
  }

  async function onSignal(by: Pid, data: RtcSignal): Promise<void> {
    if (!live.current.joined || !data || typeof data.sid !== 'string') return;
    const gen = typeof data.gen === 'number' && Number.isFinite(data.gen) ? data.gen : 0;
    if ('sdp' in data) {
      if (data.sdp.type === 'offer') {
        const servers = await ensureIce(false);
        if (!live.current.joined) return;
        // νέα προσφορά: νέα σύνδεση (ο άλλος μόλις μπήκε ή ξαναπροσπαθεί)
        closePeer(by);
        const peer = createPeer(by, data.sid, gen, false, 0, servers);
        try {
          await peer.pc.setRemoteDescription(data.sdp);
          // ήχος και (αν τον ξέρει και ο άλλος) βίντεο, και προς τις δύο μεριές
          for (const tr of peer.pc.getTransceivers()) tr.direction = 'sendrecv';
          const tr = trOf(peer.pc, 'audio');
          if (tr && track.current) await tr.sender.replaceTrack(track.current);
          await flushIce(peer);
          const desc = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(desc);
          if (peers.current.get(by) !== peer) return;
          syncVideo(peer);
          live.current.send({ t: 'rtc', to: by, data: { sid: sid.current, gen, sdp: { type: 'answer', sdp: desc.sdp ?? '' } } });
        } catch {
          if (peers.current.get(by) === peer) setLink(by, 'failed');
        }
        return;
      }
      const peer = peers.current.get(by);
      if (!peer || peer.sid !== data.sid || peer.gen !== gen || peer.pc.signalingState !== 'have-local-offer') return;
      try {
        await peer.pc.setRemoteDescription(data.sdp);
        await flushIce(peer);
        syncVideo(peer);
      } catch {
        setLink(by, 'failed');
      }
      return;
    }
    if (!data.ice) return;
    const peer = peers.current.get(by);
    if (peer && peer.sid === data.sid && peer.gen === gen) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.ice).catch(() => {});
      else if (peer.ice.length < MAX_PENDING_ICE) peer.ice.push(data.ice);
      return;
    }
    // πρόωρο ICE candidate (πριν φτάσει/ολοκληρωθεί το offer): κρατιέται ώσπου να στηθεί το peer
    const key = iceKey(by, data.sid, gen);
    let q = pendingIce.current.get(key);
    if (!q) {
      if (pendingIce.current.size >= MAX_PENDING_KEYS) {
        const oldest = pendingIce.current.keys().next().value;
        if (oldest !== undefined) pendingIce.current.delete(oldest);
      }
      q = [];
      pendingIce.current.set(key, q);
    }
    if (q.length < MAX_PENDING_ICE) q.push(data.ice);
  }
  o.rtcRef.current = (by, data) => void onSignal(by, data);

  const stopMeter = () => {
    void meter.current?.ctx.close().catch(() => {});
    meter.current = null;
  };

  const stopMic = () => {
    track.current?.stop();
    track.current = null;
    for (const peer of peers.current.values()) void trOf(peer.pc, 'audio')?.sender.replaceTrack(null).catch(() => {});
    stopMeter();
    setMic(false);
  };

  const stopCam = () => {
    camTrack.current?.stop();
    camTrack.current = null;
    for (const peer of peers.current.values()) void trOf(peer.pc, 'video')?.sender.replaceTrack(null).catch(() => {});
    setCamStream(null);
    setCam(false);
  };

  const startCam = async () => {
    setCamError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('no media', 'NotSupportedError');
      const stream = await navigator.mediaDevices.getUserMedia({ video: CAM_VIDEO });
      const t = stream.getVideoTracks()[0];
      const l = live.current;
      if (!t || !l.joined || !canCam(l.rules, l.pid)) {
        for (const x of stream.getTracks()) x.stop();
        return;
      }
      camTrack.current?.stop();
      camTrack.current = t;
      // η κάμερα αποσυνδέθηκε ή την πήρε άλλο πρόγραμμα
      t.onended = () => camTrack.current === t && stopCam();
      setCamStream(new MediaStream([t]));
      setCam(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setCamError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? L('Ο browser δεν έδωσε την κάμερα. Επίτρεψέ την από το εικονίδιο στη γραμμή διεύθυνσης και πάτα ξανά.', 'The browser did not allow the camera. Allow it from the icon in the address bar and try again.')
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? L('Δεν βρέθηκε κάμερα.', 'No camera found.')
            : L('Η κάμερα δεν άνοιξε (μήπως τη χρησιμοποιεί άλλο πρόγραμμα;).', 'The camera did not open (is another program using it?).'),
      );
    }
  };

  const startMic = async () => {
    setMicError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('no media', 'NotSupportedError');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const t = stream.getAudioTracks()[0];
      if (!t || !live.current.joined || (live.current.pid && live.current.rules?.silenced.includes(live.current.pid))) {
        for (const x of stream.getTracks()) x.stop();
        return;
      }
      track.current?.stop();
      track.current = t;
      for (const peer of peers.current.values()) void trOf(peer.pc, 'audio')?.sender.replaceTrack(t).catch(() => {});
      try {
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(new MediaStream([t])).connect(an);
        stopMeter();
        meter.current = { ctx, an, buf: new Float32Array(an.fftSize) };
      } catch {
        // χωρίς μετρητή: απλώς δεν φαίνεται πότε μιλάμε
      }
      setMic(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setMicError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? L('Ο browser δεν έδωσε το μικρόφωνο. Επίτρεψέ το από το εικονίδιο στη γραμμή διεύθυνσης και πάτα ξανά.', 'The browser did not allow the microphone. Allow it from the icon in the address bar and try again.')
          : name === 'NotFoundError'
            ? L('Δεν βρέθηκε μικρόφωνο.', 'No microphone found.')
            : L('Το μικρόφωνο δεν άνοιξε (μήπως το χρησιμοποιεί άλλο πρόγραμμα;).', 'The microphone did not open (is another program using it?).'),
      );
    }
  };

  const join = () => {
    if (!supported || live.current.joined) return;
    const others = Object.keys(live.current.voices).filter((p) => p !== live.current.pid).length;
    if (others >= VOICE_MAX) {
      setFull(true);
      return;
    }
    sid.current = randomId(12);
    live.current.joined = true;
    icePromise.current = null;
    void ensureIce(false);
    setFull(false);
    setJoined(true);
  };

  // μπαίνει μόνο με κλικ, ποτέ μόνος του: πριν από το κλικ διαβάζει ότι φαίνεται η IP του
  const leave = () => {
    live.current.joined = false;
    icePromise.current = null;
    iceServers.current = DEFAULT_ICE_SERVERS;
    stopMic();
    stopCam();
    closeAll();
    setDeaf(false);
    setJoined(false);
    setSpeaking({});
  };

  // η δική μας κατάσταση στους άλλους (και ξανά μετά από κάθε επανασύνδεση)
  useEffect(() => {
    if (!supported || status !== 'open') return;
    if (!joined && !announced.current) return;
    announced.current = joined;
    o.send({ t: 'voice', state: joined ? { sid: sid.current, mic, deaf, cam, ...(watch ? { watch } : {}) } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, status, joined, mic, deaf, cam, watch]);

  // συνδέσεις με όσους είναι στη φωνή: νέα όταν κάποιος μπαίνει (ή ξαναμπαίνει), κλείσιμο όταν φεύγει
  useEffect(() => {
    if (!joined || !pid) {
      closeAll();
      return;
    }
    for (const [p, st] of Object.entries(voices)) {
      if (p === pid) continue;
      const cur = peers.current.get(p);
      if (cur && cur.sid === st.sid) continue;
      if (cur) closePeer(p);
      if (pid < p) void offer(p, st.sid);
    }
    for (const p of [...peers.current.keys()]) if (!voices[p]) closePeer(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, voices, pid]);

  // deafen, προσωπική σίγαση, ένταση, σίγαση του οικοδεσπότη
  useEffect(() => {
    for (const peer of peers.current.values()) applyAudio(peer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deaf, prefs, rules, links]);

  // ο οικοδεσπότης μάς έκλεισε το μικρόφωνο
  useEffect(() => {
    if (silenced && track.current) stopMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silenced]);

  // ο οικοδεσπότης πήρε πίσω την άδεια για κάμερα
  useEffect(() => {
    if (!camAllowed && camTrack.current) stopCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camAllowed]);

  // η κάμερά μας πηγαίνει μόνο σε όσους τη βλέπουν (και ξανά όταν συνδέεται κάποιος)
  useEffect(() => {
    for (const peer of peers.current.values()) syncVideo(peer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, cam, links, pid]);

  // μας έβγαλαν ή έληξε το δωμάτιο
  useEffect(() => {
    if ((status === 'kicked' || status === 'gone') && live.current.joined) leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ποιος μιλά (κάθε 200 ms)
  useEffect(() => {
    if (!joined) return;
    const timer = setInterval(() => {
      const l = live.current;
      const next: Record<Pid, boolean> = {};
      for (const peer of peers.current.values()) {
        const src = trOf(peer.pc, 'audio')?.receiver.getSynchronizationSources?.()[0];
        if (src && (src.audioLevel ?? 0) > SPEAK_LEVEL && l.voices[peer.pid]?.mic && !l.rules?.silenced.includes(peer.pid)) next[peer.pid] = true;
      }
      const m = meter.current;
      if (m && l.pid && l.mic) {
        m.an.getFloatTimeDomainData(m.buf);
        let sum = 0;
        for (const x of m.buf) sum += x * x;
        if (Math.sqrt(sum / m.buf.length) > SPEAK_RMS) next[l.pid] = true;
      }
      setSpeaking((prev) => {
        const a = Object.keys(prev);
        const b = Object.keys(next);
        return a.length === b.length && b.every((k) => prev[k]) ? prev : next;
      });
    }, 200);
    return () => clearInterval(timer);
  }, [joined]);

  // κλείσιμο της ανάλυσης
  useEffect(
    () => () => {
      track.current?.stop();
      track.current = null;
      camTrack.current?.stop();
      camTrack.current = null;
      stopMeter();
      closeAll();
      o.rtcRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const savePrefs = (next: typeof prefs) => {
    setPrefs(next);
    storage(() => localStorage.setItem(prefsKey(id), JSON.stringify(next)));
  };

  return {
    supported,
    joined,
    mic,
    deaf,
    silenced,
    full,
    micError,
    blocked,
    speaking,
    links,
    muted: prefs.muted,
    volume: prefs.volume,
    join,
    leave,
    toggleMic: () => {
      if (!joined || silenced) return;
      if (mic) return stopMic();
      setDeaf(false);
      void startMic();
    },
    toggleDeaf: () => {
      if (!joined) return;
      if (!deaf) {
        wasMic.current = mic;
        if (mic) stopMic();
        setDeaf(true);
        return;
      }
      setDeaf(false);
      if (wasMic.current && !silenced) void startMic();
    },
    setMuted: (p, on) => savePrefs({ ...prefs, muted: { ...prefs.muted, [p]: on } }),
    setVolume: (p, vol) => savePrefs({ ...prefs, volume: { ...prefs.volume, [p]: vol } }),
    unblock: () => {
      for (const peer of peers.current.values()) play(peer.audio);
    },
    camSupported,
    cam,
    camAllowed,
    camError,
    toggleCam: () => {
      if (!joined || !camSupported) return;
      if (cam) return stopCam();
      if (camAllowed) void startCam();
    },
    shown,
    pinned,
    pin: setPinned,
    collapsed,
    setCollapsed: (on) => {
      setCollapsedState(on);
      storage(() => (on ? localStorage.setItem(CAM_MIN_KEY, '1') : localStorage.removeItem(CAM_MIN_KEY)));
    },
    streamOf: (p) => (p === pid ? camStream : (peers.current.get(p)?.video ?? null)),
  };
}
