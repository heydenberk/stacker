import { describe, expect, it } from 'vitest';
import { decodeEntities, normText, stripEdition, titleVariants } from '../src/normalize';

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('Simon &amp; Garfunkel')).toBe('Simon & Garfunkel');
    expect(decodeEntities('&#34;Heroes&#34;')).toBe('"Heroes"');
  });
});

describe('normText', () => {
  it('lowercases and collapses punctuation', () => {
    expect(normText('Heaven Or Las Vegas')).toBe('heaven or las vegas');
    expect(normText('Either / Or')).toBe('either or');
    expect(normText('Either/Or')).toBe('either or');
  });
  it('strips accents', () => {
    expect(normText('João Gilberto')).toBe('joao gilberto');
    expect(normText('Sigur Rós')).toBe('sigur ros');
  });
  it('maps & to and and drops a leading "the"', () => {
    expect(normText('The Velvet Underground & Nico')).toBe('velvet underground and nico');
  });
  it('returns empty string for punctuation-only titles', () => {
    expect(normText('( )')).toBe('');
  });
});

describe('stripEdition', () => {
  it('removes edition parentheticals', () => {
    expect(stripEdition('Heaven or Las Vegas (Remastered 2014)')).toBe('Heaven or Las Vegas');
    expect(stripEdition('Spirit of Eden (2012 Remaster)')).toBe('Spirit of Eden');
    expect(stripEdition('Live at Leeds [Deluxe Edition]')).toBe('Live at Leeds');
  });
  it('removes dash suffixes that name an edition', () => {
    expect(stripEdition('Pink Moon - 2009 Remaster')).toBe('Pink Moon');
  });
  it('keeps parentheticals and suffixes that are part of the title', () => {
    expect(stripEdition("(What's the Story) Morning Glory?")).toBe("(What's the Story) Morning Glory?");
    expect(stripEdition('Kyuss [Welcome to Sky Valley]')).toBe('Kyuss [Welcome to Sky Valley]');
  });
});

describe('titleVariants', () => {
  it('splits Main [Alternate]', () => {
    expect(titleVariants('Kyuss [Welcome to Sky Valley]')).toEqual(['Kyuss', 'Welcome to Sky Valley']);
  });
  it('returns plain titles unchanged', () => {
    expect(titleVariants('Pink Moon')).toEqual(['Pink Moon']);
  });
});
