import { describe, expect, it } from 'vitest';
import { applyRule, canCam, canEdit, cleanLive, cleanVideoId, cleanVideoSync, cleanVoice, parseVideoUrl, parseYouTubeId, pickCamera, pickNextHost, videoInfo, videoSyncTime, type ShareRules, type VoiceState } from '../src/core/share.ts';

const empty: ShareRules = { editors: [], silenced: [], cams: [] };

describe('shared analysis rules', () => {
  it('lets everyone edit in old rooms and only the host (and editors) in new ones', () => {
    expect(canEdit(null, 'g1')).toBe(true);
    expect(canEdit(empty, 'h')).toBe(true);
    expect(canEdit(empty, 'g1')).toBe(false);
    expect(canEdit(empty, null)).toBe(false);
    expect(canEdit({ ...empty, editors: ['g1'] }, 'g1')).toBe(true);
  });

  it('grants and takes edit rights one by one or for everyone present', () => {
    let r = applyRule(empty, { t: 'perm', pid: 'g2', edit: true }, ['g1', 'g2']);
    expect(r.editors).toEqual(['g2']);
    r = applyRule(r, { t: 'perm', pid: '*', edit: true }, ['g1', 'g2', 'g3']);
    expect([...r.editors].sort()).toEqual(['g1', 'g2', 'g3']);
    r = applyRule(r, { t: 'perm', pid: 'g1', edit: false }, ['g1', 'g2', 'g3']);
    expect(r.editors.sort()).toEqual(['g2', 'g3']);
    r = applyRule(r, { t: 'perm', pid: '*', edit: false }, ['g2', 'g3']);
    expect(r.editors).toEqual([]);
  });

  it('silences, unsilences and forgets a kicked guest', () => {
    let r = applyRule({ editors: ['g1'], silenced: [], cams: ['g1'] }, { t: 'silence', pid: 'g1', on: true }, ['g1']);
    expect(r.silenced).toEqual(['g1']);
    expect(applyRule(r, { t: 'silence', pid: 'g1', on: false }, ['g1']).silenced).toEqual([]);
    r = applyRule(r, { t: 'kick', pid: 'g1' }, ['g1']);
    expect(r).toEqual({ editors: [], silenced: [], cams: [], locked: true });
    // μένει κλειδωμένο στις άλλες αλλαγές, ώσπου να το ξεκλειδώσει ο οικοδεσπότης
    r = applyRule(r, { t: 'perm', pid: 'g2', edit: true }, ['g2']);
    expect(r.locked).toBe(true);
    expect(applyRule(r, { t: 'lock', on: false }, []).locked).toBe(false);
  });

  it('lets the host always use the camera and guests only when allowed', () => {
    expect(canCam(null, 'g1')).toBe(true);
    expect(canCam(empty, 'h')).toBe(true);
    expect(canCam(empty, 'g1')).toBe(false);
    expect(canCam(empty, null)).toBe(false);
    // δωμάτιο από πριν από την κάμερα: κανόνες χωρίς `cams`
    const old: ShareRules = { editors: ['g1'], silenced: [] };
    expect(canCam(old, 'g1')).toBe(false);
    let r = applyRule(old, { t: 'cam', pid: 'g1', on: true }, ['g1']);
    expect(r.cams).toEqual(['g1']);
    expect(canCam(r, 'g1')).toBe(true);
    expect(r.editors).toEqual(['g1']);
    r = applyRule(r, { t: 'cam', pid: 'g1', on: false }, ['g1']);
    expect(canCam(r, 'g1')).toBe(false);
  });

  it('accepts only well-formed voice states', () => {
    expect(cleanVoice({ sid: 'abc234def', mic: true, deaf: 'x' })).toEqual({ sid: 'abc234def', mic: true, deaf: false, cam: false });
    expect(cleanVoice({ sid: 'abc234def', cam: true, watch: 'g12' })).toEqual({ sid: 'abc234def', mic: false, deaf: false, cam: true, watch: 'g12' });
    expect(cleanVoice({ sid: 'abc234def', watch: '<script>' })).toEqual({ sid: 'abc234def', mic: false, deaf: false, cam: false });
    expect(cleanVoice({ sid: 'A!' })).toBeNull();
    expect(cleanVoice(null)).toBeNull();
    expect(cleanVoice('x')).toBeNull();
  });

  it('accepts only well-formed live watch states', () => {
    expect(cleanLive({ status: 'live', w: 300_000, b: 250_000, turn: 'b', at: 1234, plies: 14 })).toEqual({
      status: 'live',
      w: 300_000,
      b: 250_000,
      turn: 'b',
      at: 1234,
      plies: 14,
    });
    expect(cleanLive({ status: 'ended', w: -5, b: null, turn: 'x', at: 500, plies: 20 })).toEqual({
      status: 'ended',
      w: null,
      b: null,
      turn: 'w',
      at: 500,
      plies: 20,
    });
    expect(cleanLive({ status: 'bogus', w: 1000, b: 1000, turn: 'w', at: 1, plies: 2 })).toBeNull();
    expect(cleanLive(null)).toBeNull();
  });

  it('parses and validates YouTube, Twitch and Kick video links safely', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://www.twitch.tv/GMHikaru')).toBe('tw:gmhikaru');
    expect(parseVideoUrl('https://www.twitch.tv/videos/1234567890')).toBe('twv:1234567890');
    expect(parseVideoUrl('https://kick.com/gmhikaru')).toBe('kick:gmhikaru');
    expect(parseVideoUrl('https://www.twitch.tv/directory')).toBeNull();
    expect(parseVideoUrl('https://kick.com/browse')).toBeNull();
    expect(parseVideoUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoUrl('javascript:alert(1)')).toBeNull();
    expect(cleanVideoId('dQw4w9WgXcQ')).toBe('yt:dQw4w9WgXcQ');
    expect(cleanVideoId('tw:GMHikaru')).toBe('tw:gmhikaru');
    expect(cleanVideoId('kick:xqc')).toBe('kick:xqc');
    expect(cleanVideoId('short')).toBeNull();
    expect(cleanVideoId('<script>123')).toBeNull();
    expect(videoInfo('yt:dQw4w9WgXcQ')?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1');
    expect(videoInfo('tw:gmhikaru', 'ruru.example')?.embedUrl).toBe('https://player.twitch.tv/?channel=gmhikaru&parent=ruru.example');
    expect(videoInfo('kick:xqc')?.embedUrl).toBe('https://player.kick.com/xqc');
  });

  it('validates YouTube video sync state and advances playback time only while playing', () => {
    const s = cleanVideoSync({ id: 'yt:dQw4w9WgXcQ', time: 123.456, playing: true }, 'yt:dQw4w9WgXcQ');
    expect(s).not.toBeNull();
    expect(s?.time).toBe(123.46);
    expect(s?.playing).toBe(true);
    expect(videoSyncTime({ id: 'yt:dQw4w9WgXcQ', time: 100, playing: true, at: 1000 }, 6000)).toBe(105);
    expect(videoSyncTime({ id: 'yt:dQw4w9WgXcQ', time: 100, playing: false, at: 1000 }, 6000)).toBe(100);
    // απορρίπτει άλλο βίντεο, μη-YouTube ή αρνητικό χρόνο
    expect(cleanVideoSync({ id: 'yt:other123456', time: 10, playing: true }, 'yt:dQw4w9WgXcQ')).toBeNull();
    expect(cleanVideoSync({ id: 'tw:gmhikaru', time: 10, playing: true }, 'tw:gmhikaru')).toBeNull();
    expect(cleanVideoSync({ id: 'yt:dQw4w9WgXcQ', time: -5, playing: true }, 'yt:dQw4w9WgXcQ')).toBeNull();
    expect(cleanVideoSync({ id: 'yt:dQw4w9WgXcQ', time: 10, playing: 'yes' }, 'yt:dQw4w9WgXcQ')).toBeNull();
  });
  it('supports transferred host role for edit, camera, and picking next oldest host', () => {
    expect(canEdit(empty, 'g2', 'g2')).toBe(true);
    expect(canEdit(empty, 'h', 'g2')).toBe(false);
    expect(canCam(empty, 'g2', 'g2')).toBe(true);
    expect(canCam(empty, 'h', 'g2')).toBe(false);
    expect(pickNextHost(['h', 'g2', 'g1'], 'h', ['h', 'g1', 'g2'])).toBe('g1');
    expect(pickNextHost(['h', 'g2', 'g3'], 'h', ['h', 'g1', 'g2', 'g3'])).toBe('g2');
    // fallback χωρίς joinedOrder
    expect(pickNextHost(['h', 'g10', 'g2'], 'h', [])).toBe('g2');
    // μόνος του: κανένας επόμενος
    expect(pickNextHost(['h'], 'h', ['h'])).toBeNull();
  });
});

describe('which camera the one window shows', () => {
  const v = (cam: boolean): VoiceState => ({ sid: 'abc234def', mic: false, deaf: false, cam });
  const rules: ShareRules = { editors: [], silenced: [], cams: ['g1', 'g2'] };
  const order = ['g1', 'g2', 'g3', 'h'];

  it('shows the host by default, then another open camera, then your own', () => {
    expect(pickCamera({ me: 'g1', pinned: null, voices: { h: v(true), g2: v(true) }, rules, order })).toBe('h');
    expect(pickCamera({ me: 'g1', pinned: null, voices: { h: v(false), g2: v(true) }, rules, order })).toBe('g2');
    expect(pickCamera({ me: 'g1', pinned: null, voices: { h: v(false), g1: v(true) }, rules, order })).toBe('g1');
    expect(pickCamera({ me: 'g1', pinned: null, voices: { h: v(false), g1: v(false) }, rules, order })).toBeNull();
  });

  it('shows the guests to the host before the host’s own camera', () => {
    expect(pickCamera({ me: 'h', pinned: null, voices: { h: v(true), g2: v(true) }, rules, order })).toBe('g2');
    expect(pickCamera({ me: 'h', pinned: null, voices: { h: v(true) }, rules, order })).toBe('h');
  });

  it('follows the pin while that camera is on', () => {
    const voices = { h: v(true), g1: v(true), g2: v(true) };
    expect(pickCamera({ me: 'g1', pinned: 'g2', voices, rules, order })).toBe('g2');
    expect(pickCamera({ me: 'g1', pinned: 'g2', voices: { ...voices, g2: v(false) }, rules, order })).toBe('h');
  });

  it('never shows a guest without camera permission', () => {
    const voices = { h: v(false), g3: v(true) };
    expect(pickCamera({ me: 'g1', pinned: 'g3', voices, rules, order })).toBeNull();
    expect(pickCamera({ me: 'g1', pinned: null, voices, rules: null, order })).toBe('g3');
    // αν γίνει host ο g3, έχει αυτόματα άδεια κάμερας και προηγείται
    expect(pickCamera({ me: 'g1', pinned: null, voices, rules, order, host: 'g3' })).toBe('g3');
  });
});
