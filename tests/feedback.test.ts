import { describe, expect, it } from 'vitest';
import { FEEDBACK_MAX, cleanFeedback, validEmail } from '../src/core/feedback.ts';

describe('feedback', () => {
  it('κρατά είδος, κείμενο, email, έκδοση και γλώσσα', () => {
    expect(cleanFeedback({ kind: 'idea', text: '  Ωραία εφαρμογή  ', email: ' a@b.gr ', version: '3.2.0', lang: 'el' })).toEqual({ kind: 'idea', text: 'Ωραία εφαρμογή', email: 'a@b.gr', version: '3.2.0', lang: 'el' });
  });
  it('άγνωστο είδος → άλλο, χωρίς email → κενό, παράξενη έκδοση → κενή', () => {
    expect(cleanFeedback({ kind: 'spam', text: 'abc', version: '<script>', lang: 'xx' })).toEqual({ kind: 'other', text: 'abc', email: '', version: '', lang: 'el' });
  });
  it('απορρίπτει πολύ μικρό ή μεγάλο κείμενο και λάθος email', () => {
    expect(cleanFeedback({ text: 'a' })).toBe(null);
    expect(cleanFeedback({ text: 'x'.repeat(FEEDBACK_MAX + 1) })).toBe(null);
    expect(cleanFeedback({ text: 'abc', email: 'όχι email' })).toBe(null);
    expect(cleanFeedback(null)).toBe(null);
  });
  it('email', () => {
    expect(validEmail('name.surname@mail.example.com')).toBe(true);
    expect(validEmail('a@b')).toBe(false);
    expect(validEmail('a@@b.gr')).toBe(false);
    expect(validEmail('a b@c.gr')).toBe(false);
  });
});
