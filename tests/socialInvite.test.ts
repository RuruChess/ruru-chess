import { describe, expect, it } from 'vitest';
import { cleanAccounts, cleanInvite, cleanSiteUser, parseInvite, type DmMsg } from '../src/core/social.ts';

const msg = (text: string): DmMsg => ({ id: 1, from: 'u', at: 0, kind: 'invite', text }) as DmMsg;

describe('cleanInvite', () => {
  it('κρατά ρολόι και χρώμα στην παρτίδα', () => {
    expect(cleanInvite({ t: 'invite', peer: 'x', kind: 'game', room: 'abcd2345', tc: '5+3', color: 'black', title: 'όχι' })).toEqual({ kind: 'game', room: 'abcd2345', tc: '5+3', color: 'black' });
    expect(cleanInvite({ kind: 'game', room: 'abcd2345', tc: '' })).toEqual({ kind: 'game', room: 'abcd2345', tc: '' });
  });
  it('πετά ό,τι δεν είναι σωστό', () => {
    expect(cleanInvite({ kind: 'game', room: 'abcd2345', tc: '5 min', color: 'red' })).toEqual({ kind: 'game', room: 'abcd2345' });
    expect(cleanInvite({ kind: 'game', room: 'ABC' })).toBeNull();
    expect(cleanInvite({ kind: 'chat', room: 'abcd2345' })).toBeNull();
    expect(cleanInvite(null)).toBeNull();
  });
  it('τίτλος μόνο στην ανάλυση, καθαρός και έως 80 χαρακτήρες', () => {
    expect(cleanInvite({ kind: 'analysis', room: 'abcd2345', title: '  Banikas \n– Vysochin ', tc: '5+3' })).toEqual({ kind: 'analysis', room: 'abcd2345', title: 'Banikas – Vysochin' });
    expect(cleanInvite({ kind: 'analysis', room: 'abcd2345', title: 'x'.repeat(200) })?.title).toHaveLength(80);
  });
  it('οι παλιές προσκλήσεις (χωρίς στοιχεία) διαβάζονται κανονικά', () => {
    expect(parseInvite(msg('{"kind":"analysis","room":"abcd2345"}'))).toEqual({ kind: 'analysis', room: 'abcd2345' });
    expect(parseInvite(msg('όχι json'))).toBeNull();
  });
});

describe('cleanAccounts', () => {
  it('κρατά μόνο σωστά usernames', () => {
    expect(cleanAccounts({ lichess: 'DrNykterstein', chesscom: 'magnus_carlsen', x: 'y' })).toEqual({ lichess: 'DrNykterstein', chesscom: 'magnus_carlsen' });
    expect(cleanAccounts({ lichess: 'a b', chesscom: '<script>' })).toBeNull();
    expect(cleanAccounts({ lichess: 'x'.repeat(26) })).toBeNull();
    expect(cleanAccounts(null)).toBeNull();
    expect(cleanAccounts({ lichess: 42 })).toBeNull();
  });
  it('δέχεται «@όνομα» και το link του προφίλ', () => {
    expect(cleanSiteUser(' @thibault ')).toBe('thibault');
    expect(cleanSiteUser('https://lichess.org/@/thibault/all')).toBe('thibault');
    expect(cleanSiteUser('www.chess.com/member/Hikaru?ref=1')).toBe('Hikaru');
    expect(cleanSiteUser('_x')).toBeNull();
  });
});
