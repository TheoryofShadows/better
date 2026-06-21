/**
 * Ensures the runtime DEFAULT_CONFIG constant is loaded and well-formed.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../types.js';

describe('DEFAULT_CONFIG', () => {
  it('provides sane defaults', () => {
    expect(DEFAULT_CONFIG.format).toBe('markdown');
    expect(DEFAULT_CONFIG.languages).toContain('typescript');
    expect(DEFAULT_CONFIG.include.length).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.onboarding.roles.length).toBeGreaterThan(0);
  });
});
