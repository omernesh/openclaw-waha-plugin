import { describe, it, expect } from 'vitest'
import { labelFor, LABEL_MAP } from '../labels'

describe('labelFor', () => {
  it('returns human-readable label for known keys', () => {
    expect(labelFor('wpm')).toBe('Words Per Minute')
    expect(labelFor('readDelayMs')).toBe('Read Delay (ms)')
    expect(labelFor('dmPolicy')).toBe('DM Policy')
    expect(labelFor('godModeSuperUsers')).toBe('God Mode Users')
  })

  it('returns the key itself for unknown keys', () => {
    expect(labelFor('unknownKey')).toBe('unknownKey')
    expect(labelFor('someRandomField')).toBe('someRandomField')
  })

  it('LABEL_MAP contains all expected config keys', () => {
    const expectedKeys = ['wpm', 'readDelayMs', 'typingDurationMs', 'pauseChance',
      'dmFilter', 'groupFilter', 'allowFrom', 'groupAllowFrom', 'allowedGroups',
      'godModeSuperUsers', 'dmPolicy', 'groupPolicy', 'enabled', 'jitter']
    for (const key of expectedKeys) {
      expect(LABEL_MAP[key]).toBeDefined()
    }
  })
})
