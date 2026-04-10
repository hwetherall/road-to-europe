import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ExtractedClaim,
  FactCheckEvidence,
  VerifiedClaim,
} from '@/lib/weekly-preview/fact-check-types';
import {
  hasStrongEvidence,
  rejectionReason,
  selectFactCheckCorrections,
} from '@/lib/weekly-preview/fact-check';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function makeEvidence(
  overrides: Partial<FactCheckEvidence> = {}
): FactCheckEvidence {
  return {
    title: 'Source',
    url: 'https://example.com',
    sourceType: 'trusted_media',
    supports: 'Confirms the claim.',
    ...overrides,
  };
}

function makeVerified(
  overrides: Partial<VerifiedClaim> = {}
): VerifiedClaim {
  return {
    claimId: 'claim-1',
    sectionId: 'club-focus',
    claim: 'Test claim',
    claimType: 'player_club',
    verdict: 'contradicted',
    correction: 'Corrected fact',
    reasoningShort: 'Evidence shows otherwise.',
    confidence: 0.9,
    evidence: [
      makeEvidence({ sourceType: 'official_club', title: 'NUFC Official' }),
    ],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────
// hasStrongEvidence
// ────────────────────────────────────────────────────────────────

describe('hasStrongEvidence', () => {
  it('returns true with one official_club source and high confidence', () => {
    const result = makeVerified({
      evidence: [makeEvidence({ sourceType: 'official_club' })],
      confidence: 0.9,
    });
    expect(hasStrongEvidence(result)).toBe(true);
  });

  it('returns true with one premier_league source and high confidence', () => {
    const result = makeVerified({
      evidence: [makeEvidence({ sourceType: 'premier_league' })],
      confidence: 0.85,
    });
    expect(hasStrongEvidence(result)).toBe(true);
  });

  it('returns true with two trusted_media sources and high confidence', () => {
    const result = makeVerified({
      evidence: [
        makeEvidence({ sourceType: 'trusted_media', title: 'BBC Sport' }),
        makeEvidence({ sourceType: 'trusted_media', title: 'Sky Sports' }),
      ],
      confidence: 0.8,
    });
    expect(hasStrongEvidence(result)).toBe(true);
  });

  it('returns false with only one trusted_media source', () => {
    const result = makeVerified({
      evidence: [makeEvidence({ sourceType: 'trusted_media' })],
      confidence: 0.9,
    });
    expect(hasStrongEvidence(result)).toBe(false);
  });

  it('returns false with only "other" sources', () => {
    const result = makeVerified({
      evidence: [
        makeEvidence({ sourceType: 'other' }),
        makeEvidence({ sourceType: 'other' }),
      ],
      confidence: 0.9,
    });
    expect(hasStrongEvidence(result)).toBe(false);
  });

  it('returns false when confidence is below 0.7', () => {
    const result = makeVerified({
      evidence: [makeEvidence({ sourceType: 'official_club' })],
      confidence: 0.5,
    });
    expect(hasStrongEvidence(result)).toBe(false);
  });

  it('returns false when verdict is not contradicted', () => {
    const result = makeVerified({
      verdict: 'supported',
      evidence: [makeEvidence({ sourceType: 'official_club' })],
      confidence: 0.9,
    });
    expect(hasStrongEvidence(result)).toBe(false);
  });

  it('returns false with empty evidence', () => {
    const result = makeVerified({ evidence: [], confidence: 0.9 });
    expect(hasStrongEvidence(result)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// rejectionReason
// ────────────────────────────────────────────────────────────────

describe('rejectionReason', () => {
  it('returns null for non-contradicted claims', () => {
    expect(rejectionReason(makeVerified({ verdict: 'supported' }))).toBeNull();
    expect(rejectionReason(makeVerified({ verdict: 'unclear' }))).toBeNull();
  });

  it('returns reason for low confidence', () => {
    const reason = rejectionReason(makeVerified({ confidence: 0.4 }));
    expect(reason).toContain('Low confidence');
    expect(reason).toContain('0.40');
  });

  it('returns reason for empty evidence', () => {
    const reason = rejectionReason(makeVerified({ evidence: [], confidence: 0.9 }));
    expect(reason).toContain('No evidence');
  });

  it('returns reason for insufficient authoritative evidence', () => {
    const reason = rejectionReason(
      makeVerified({
        evidence: [makeEvidence({ sourceType: 'other' })],
        confidence: 0.9,
      })
    );
    expect(reason).toContain('Insufficient authoritative evidence');
  });

  it('returns null when evidence threshold is met', () => {
    expect(rejectionReason(makeVerified())).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// selectFactCheckCorrections
// ────────────────────────────────────────────────────────────────

describe('selectFactCheckCorrections', () => {
  it('selects well-evidenced contradictions', () => {
    const { corrections, rejected } = selectFactCheckCorrections([
      makeVerified(),
    ]);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].claim).toBe('Test claim');
    expect(corrections[0].correction).toBe('Corrected fact');
    expect(corrections[0].severity).toBe('high');
    expect(rejected).toHaveLength(0);
  });

  it('rejects contradictions without correction text', () => {
    const { corrections, rejected } = selectFactCheckCorrections([
      makeVerified({ correction: undefined }),
    ]);
    expect(corrections).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('no correction text');
  });

  it('rejects low-confidence contradictions', () => {
    const { corrections, rejected } = selectFactCheckCorrections([
      makeVerified({ confidence: 0.3 }),
    ]);
    expect(corrections).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('Low confidence');
  });

  it('rejects contradictions with insufficient evidence', () => {
    const { corrections, rejected } = selectFactCheckCorrections([
      makeVerified({
        evidence: [makeEvidence({ sourceType: 'other' })],
      }),
    ]);
    expect(corrections).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('ignores supported and unclear verdicts', () => {
    const { corrections, rejected } = selectFactCheckCorrections([
      makeVerified({ verdict: 'supported' }),
      makeVerified({ verdict: 'unclear' }),
    ]);
    expect(corrections).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it('assigns severity based on claim type', () => {
    const highRisk = makeVerified({ claimType: 'player_club' });
    const mediumRisk = makeVerified({
      claimId: 'claim-2',
      claimType: 'venue',
    });

    const { corrections } = selectFactCheckCorrections([highRisk, mediumRisk]);
    expect(corrections).toHaveLength(2);
    expect(corrections[0].severity).toBe('high');
    expect(corrections[1].severity).toBe('medium');
  });
});

// ────────────────────────────────────────────────────────────────
// Regression tests: exact class of false-positive bugs
// ────────────────────────────────────────────────────────────────

describe('regression: transfer false positives', () => {
  it('Wissa at Newcastle should NOT be corrected back to Brentford when official sources support Newcastle', () => {
    // The verifier correctly found that Wissa is at Newcastle now.
    // This should be "supported", and no correction should reach the editor.
    const wissaSupported = makeVerified({
      claimId: 'claim-club-focus-1',
      sectionId: 'club-focus',
      claim: 'Yoane Wissa plays for Newcastle United.',
      claimType: 'player_club',
      verdict: 'supported',
      correction: undefined,
      reasoningShort: 'nufc.co.uk squad page lists Wissa as a current player.',
      confidence: 0.95,
      evidence: [
        makeEvidence({
          sourceType: 'official_club',
          title: 'Newcastle United Official Squad',
          url: 'https://www.nufc.co.uk/teams/first-team/',
          supports: 'Yoane Wissa is listed on the official NUFC first-team squad page.',
        }),
      ],
    });

    const { corrections } = selectFactCheckCorrections([wissaSupported]);
    expect(corrections).toHaveLength(0);
  });

  it('Wissa at Newcastle should NOT be corrected if a stale contradicting source has low confidence', () => {
    // Simulates the OLD bug: a model "corrects" Wissa to Brentford based on
    // stale knowledge, but the evidence is weak (only an old "other" source).
    const wissaFalseContradiction = makeVerified({
      claimId: 'claim-club-focus-1',
      sectionId: 'club-focus',
      claim: 'Yoane Wissa plays for Newcastle United.',
      claimType: 'player_club',
      verdict: 'contradicted',
      correction: 'Yoane Wissa plays for Brentford, not Newcastle United.',
      reasoningShort: 'Training data suggests Wissa is at Brentford.',
      confidence: 0.4,
      evidence: [],
    });

    const { corrections, rejected } = selectFactCheckCorrections([wissaFalseContradiction]);
    expect(corrections).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('Low confidence');
  });

  it('Ramsdale at Newcastle should NOT be corrected away from Newcastle when official sources support it', () => {
    const ramsdaleSupported = makeVerified({
      claimId: 'claim-club-focus-2',
      sectionId: 'club-focus',
      claim: 'Aaron Ramsdale plays for Newcastle United.',
      claimType: 'player_club',
      verdict: 'supported',
      correction: undefined,
      reasoningShort: 'BBC Sport confirms Ramsdale completed transfer to Newcastle.',
      confidence: 0.92,
      evidence: [
        makeEvidence({
          sourceType: 'trusted_media',
          title: 'BBC Sport: Ramsdale joins Newcastle',
          url: 'https://www.bbc.co.uk/sport/football/ramsdale-newcastle',
          supports: 'Confirms Aaron Ramsdale signed for Newcastle United.',
        }),
        makeEvidence({
          sourceType: 'official_club',
          title: 'NUFC: Ramsdale signing',
          url: 'https://www.nufc.co.uk/news/ramsdale/',
          supports: 'Official announcement of Ramsdale signing.',
        }),
      ],
    });

    const { corrections } = selectFactCheckCorrections([ramsdaleSupported]);
    expect(corrections).toHaveLength(0);
  });

  it('a stale player-club relationship should be correctable when strong evidence supports it', () => {
    // Marc Guéhi transferred from Crystal Palace — this should be correctable
    // when authoritative current sources confirm it.
    const guehiContradicted = makeVerified({
      claimId: 'claim-match-focus-3',
      sectionId: 'match-focus',
      claim: 'Marc Guéhi plays for Crystal Palace.',
      claimType: 'player_club',
      verdict: 'contradicted',
      correction: 'Marc Guéhi signed for Newcastle United in January 2026.',
      reasoningShort: 'Multiple sources confirm Guéhi completed his move to Newcastle.',
      confidence: 0.95,
      evidence: [
        makeEvidence({
          sourceType: 'official_club',
          title: 'Newcastle United: Guéhi signs',
          url: 'https://www.nufc.co.uk/news/guehi-signs/',
          supports: 'Official announcement of Marc Guéhi signing for Newcastle United.',
        }),
        makeEvidence({
          sourceType: 'premier_league',
          title: 'PL: January transfer window round-up',
          url: 'https://www.premierleague.com/news/transfers-jan-2026',
          supports: 'Guéhi listed as transferred from Crystal Palace to Newcastle United.',
        }),
      ],
    });

    const { corrections, rejected } = selectFactCheckCorrections([guehiContradicted]);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].claim).toContain('Guéhi');
    expect(corrections[0].correction).toContain('Newcastle United');
    expect(corrections[0].severity).toBe('high');
    expect(rejected).toHaveLength(0);
  });

  it('should reject a Ramsdale "correction" with only stale non-authoritative evidence', () => {
    const ramsdaleFalseContradiction = makeVerified({
      claimId: 'claim-club-focus-2',
      sectionId: 'club-focus',
      claim: 'Aaron Ramsdale plays for Newcastle United.',
      claimType: 'player_club',
      verdict: 'contradicted',
      correction: 'Aaron Ramsdale plays for Arsenal, not Newcastle United.',
      reasoningShort: 'Wikipedia suggests Ramsdale is at Arsenal.',
      confidence: 0.75,
      evidence: [
        makeEvidence({
          sourceType: 'other',
          title: 'Wikipedia: Aaron Ramsdale',
          url: 'https://en.wikipedia.org/wiki/Aaron_Ramsdale',
          supports: 'Article lists Arsenal as current club (may be outdated).',
        }),
      ],
    });

    const { corrections, rejected } = selectFactCheckCorrections([ramsdaleFalseContradiction]);
    expect(corrections).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('Insufficient authoritative evidence');
  });
});

// ────────────────────────────────────────────────────────────────
// Claim extraction output parsing (structural test)
// ────────────────────────────────────────────────────────────────

describe('claim extraction output structure', () => {
  it('ExtractedClaim type has required fields', () => {
    const claim: ExtractedClaim = {
      claimId: 'claim-club-focus-1',
      sectionId: 'club-focus',
      text: 'Yoane Wissa plays for Newcastle United.',
      claimType: 'player_club',
    };
    expect(claim.claimId).toBeDefined();
    expect(claim.sectionId).toBeDefined();
    expect(claim.text).toBeDefined();
    expect(claim.claimType).toBeDefined();
  });
});
