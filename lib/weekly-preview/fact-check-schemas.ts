// ── JSON Schemas for OpenRouter structured outputs ──

import type { OpenRouterResponseFormat } from '@/lib/openrouter';

export const CLAIM_EXTRACTION_SCHEMA: OpenRouterResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'claim_extraction',
    strict: true,
    schema: {
      type: 'object',
      required: ['claims'],
      additionalProperties: false,
      properties: {
        claims: {
          type: 'array',
          items: {
            type: 'object',
            required: ['claimId', 'sectionId', 'text', 'claimType'],
            additionalProperties: false,
            properties: {
              claimId: { type: 'string' },
              sectionId: { type: 'string' },
              text: {
                type: 'string',
                description:
                  'A short, atomic, verifiable factual claim extracted from the section.',
              },
              claimType: {
                type: 'string',
                enum: [
                  'player_club',
                  'manager_club',
                  'transfer_status',
                  'injury_status',
                  'suspension_status',
                  'league_position',
                  'recent_result',
                  'fixture_detail',
                  'venue',
                  'kickoff_time',
                  'general_fact',
                ],
              },
            },
          },
        },
      },
    },
  },
};

export const CLAIM_VERIFICATION_SCHEMA: OpenRouterResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'claim_verification',
    strict: true,
    schema: {
      type: 'object',
      required: ['results'],
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'claimId',
              'sectionId',
              'claim',
              'claimType',
              'verdict',
              'reasoningShort',
              'confidence',
              'evidence',
            ],
            additionalProperties: false,
            properties: {
              claimId: { type: 'string' },
              sectionId: { type: 'string' },
              claim: { type: 'string' },
              claimType: {
                type: 'string',
                enum: [
                  'player_club',
                  'manager_club',
                  'transfer_status',
                  'injury_status',
                  'suspension_status',
                  'league_position',
                  'recent_result',
                  'fixture_detail',
                  'venue',
                  'kickoff_time',
                  'general_fact',
                ],
              },
              verdict: {
                type: 'string',
                enum: ['supported', 'contradicted', 'unclear'],
              },
              correction: {
                type: ['string', 'null'],
                description:
                  'Only set if verdict is contradicted. The corrected fact.',
              },
              reasoningShort: {
                type: 'string',
                description:
                  'One or two sentences explaining the verdict decision.',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
              },
              evidence: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['title', 'url', 'sourceType', 'supports'],
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string' },
                    url: { type: 'string' },
                    sourceType: {
                      type: 'string',
                      enum: [
                        'official_club',
                        'premier_league',
                        'trusted_media',
                        'other',
                      ],
                    },
                    publishedAt: { type: ['string', 'null'] },
                    snippet: { type: ['string', 'null'] },
                    supports: {
                      type: 'string',
                      description:
                        'Short explanation of what this source says about the claim.',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
