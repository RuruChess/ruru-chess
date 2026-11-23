import { describe, expect, it } from 'vitest';
import { MENU_NAGS, NAG_GROUPS, isMoveNag, isNagTextPrefix, isPrefixNag, nagGroup, nagSymbol, sameNag, textToNag } from '../src/core/nag.ts';

describe('σύμβολα (NAG)', () => {
  it('κάθε επιλογή του μενού ανήκει στη σωστή ομάδα και έχει σύμβολο', () => {
    for (const g of MENU_NAGS.move) expect(NAG_GROUPS.move).toContain(g);
    for (const g of MENU_NAGS.prefix) expect(nagGroup(g)).toBe(NAG_GROUPS.prefix);
    for (const g of [...MENU_NAGS.move, ...MENU_NAGS.eval, ...MENU_NAGS.prefix]) expect(nagSymbol(g)).not.toMatch(/^\$/);
    expect(nagGroup(146)).toBe(NAG_GROUPS.novelty);
    expect(nagGroup(999)).toEqual([999]);
  });

  it('παραλλαγές λευκών/μαύρων λογίζονται ίδιο σύμβολο', () => {
    expect(sameNag(40, 41)).toBe(true);
    expect(sameNag(22, 23)).toBe(true);
    expect(sameNag(10, 144)).toBe(false); // «=» αξιολόγηση ≠ «=» πρόθεμα
    expect(sameNag(1, 3)).toBe(false);
  });

  it('πληκτρολόγηση: προθέματα και τελικά σύμβολα', () => {
    expect(isNagTextPrefix('+')).toBe(true);
    expect(isNagTextPrefix('+/')).toBe(true);
    expect(isNagTextPrefix('!=')).toBe(false);
    expect(textToNag('+/-')).toBe(16);
    expect(textToNag('?!')).toBe(6);
    expect(textToNag('~')).toBe(13);
    expect(textToNag('+')).toBe(0);
  });

  it('θέση εμφάνισης: κολλητά στην κίνηση ή πριν από αυτή', () => {
    expect(isMoveNag(22)).toBe(true);
    expect(isMoveNag(14)).toBe(false);
    expect(isPrefixNag(140)).toBe(true);
    expect(isPrefixNag(146)).toBe(false);
  });
});
