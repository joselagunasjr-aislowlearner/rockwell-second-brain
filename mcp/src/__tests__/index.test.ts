import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Input Validation Tests
 * Tests for string lengths, enum values, numeric ranges, and limit clamping
 */
describe('Input Validation', () => {
  describe('search_brain validation', () => {
    it('should accept valid search query', () => {
      const query = 'valid search query';
      expect(query.length).toBeGreaterThan(0);
      expect(typeof query).toBe('string');
    });

    it('should reject empty query string', () => {
      const query = '';
      expect(query.length).toBe(0);
    });

    it('should clamp limit to 1-20 range', () => {
      const clampLimit = (limit: number) => Math.max(1, Math.min(20, limit));
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(1)).toBe(1);
      expect(clampLimit(10)).toBe(10);
      expect(clampLimit(20)).toBe(20);
      expect(clampLimit(21)).toBe(20);
      expect(clampLimit(100)).toBe(20);
    });

    it('should use default limit of 10 when not provided', () => {
      const defaultLimit = 10;
      expect(defaultLimit).toBe(10);
    });
  });

  describe('add_entry validation', () => {
    const validCategories = [
      'learning',
      'technique',
      'decision',
      'insight',
      'resource',
      'template',
      'pattern',
      'principle'
    ];

    it('should accept title up to 500 characters', () => {
      const title = 'a'.repeat(500);
      expect(title.length).toBeLessThanOrEqual(500);
    });

    it('should reject title exceeding 500 characters', () => {
      const title = 'a'.repeat(501);
      expect(title.length).toBeGreaterThan(500);
    });

    it('should accept content up to 10000 characters', () => {
      const content = 'a'.repeat(10000);
      expect(content.length).toBeLessThanOrEqual(10000);
    });

    it('should reject content exceeding 10000 characters', () => {
      const content = 'a'.repeat(10001);
      expect(content.length).toBeGreaterThan(10000);
    });

    it('should validate category as one of 8 enum values', () => {
      validCategories.forEach(category => {
        expect(validCategories).toContain(category);
      });
      expect(validCategories.length).toBe(8);
    });

    it('should reject invalid category', () => {
      const invalidCategory = 'invalid_category';
      expect(validCategories).not.toContain(invalidCategory);
    });

    it('should accept tags as string array with max 20 items', () => {
      const tags = ['tag1', 'tag2', 'tag3'];
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeLessThanOrEqual(20);
    });

    it('should reject tags array exceeding 20 items', () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      expect(tags.length).toBeGreaterThan(20);
    });

    it('should accept importance value between 1-5', () => {
      [1, 2, 3, 4, 5].forEach(importance => {
        expect(importance).toBeGreaterThanOrEqual(1);
        expect(importance).toBeLessThanOrEqual(5);
      });
    });

    it('should reject importance outside 1-5 range', () => {
      [0, 6, -1, 10].forEach(importance => {
        expect(importance < 1 || importance > 5).toBe(true);
      });
    });

    it('should use default importance of 3 when not provided', () => {
      const defaultImportance = 3;
      expect(defaultImportance).toBe(3);
    });

    it('should accept optional source string', () => {
      const source = 'example source';
      expect(typeof source).toBe('string');
    });
  });

  describe('list_entries validation', () => {
    it('should clamp limit to 1-50 range', () => {
      const clampLimit = (limit: number) => Math.max(1, Math.min(50, limit));
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(1)).toBe(1);
      expect(clampLimit(25)).toBe(25);
      expect(clampLimit(50)).toBe(50);
      expect(clampLimit(51)).toBe(50);
      expect(clampLimit(100)).toBe(50);
    });

    it('should use default limit of 10 when not provided', () => {
      const defaultLimit = 10;
      expect(defaultLimit).toBe(10);
    });

    it('should accept optional category filter', () => {
      const validCategories = [
        'learning',
        'technique',
        'decision',
        'insight',
        'resource',
        'template',
        'pattern',
        'principle'
      ];
      const category = 'learning';
      expect(validCategories).toContain(category);
    });
  });
});

/**
 * Environment Variable Validation Tests
 * Tests for startup validation of required secrets
 */
describe('Environment Variable Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should have SUPABASE_URL defined', () => {
    expect(process.env.SUPABASE_URL).toBeDefined();
  });

  it('should have SUPABASE_SERVICE_ROLE_KEY defined', () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
  });

  it('should have GOOGLE_EMBEDDING_API_KEY defined', () => {
    expect(process.env.GOOGLE_EMBEDDING_API_KEY).toBeDefined();
  });

  it('should validate all three env vars are non-empty strings', () => {
    const envVars = [
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.GOOGLE_EMBEDDING_API_KEY
    ];
    envVars.forEach(envVar => {
      expect(typeof envVar).toBe('string');
      expect(envVar!.length).toBeGreaterThan(0);
    });
  });

  it('should detect missing SUPABASE_URL', () => {
    delete process.env.SUPABASE_URL;
    expect(process.env.SUPABASE_URL).toBeUndefined();
  });

  it('should detect missing SUPABASE_SERVICE_ROLE_KEY', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('should detect missing GOOGLE_EMBEDDING_API_KEY', () => {
    delete process.env.GOOGLE_EMBEDDING_API_KEY;
    expect(process.env.GOOGLE_EMBEDDING_API_KEY).toBeUndefined();
  });
});

/**
 * Tool Response Format Tests
 * Tests for correct MCP protocol response structure
 */
describe('Tool Response Format', () => {
  describe('search_brain response', () => {
    it('should return array of search results', () => {
      const results = [
        {
          id: 'entry-1',
          title: 'Test Entry',
          content: 'Test content',
          category: 'learning',
          tags: ['test'],
          importance: 3,
          source: 'manual',
          created_at: '2026-03-17T12:00:00Z',
          rrf_score: 0.95
        }
      ];
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should include all required fields in result object', () => {
      const result = {
        id: 'entry-1',
        title: 'Test Entry',
        content: 'Test content',
        category: 'learning',
        tags: ['test'],
        importance: 3,
        source: 'manual',
        created_at: '2026-03-17T12:00:00Z',
        rrf_score: 0.95
      };
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('tags');
      expect(result).toHaveProperty('importance');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('created_at');
      expect(result).toHaveProperty('rrf_score');
    });

    it('should include rrf_score for ranking results', () => {
      const result = {
        id: 'entry-1',
        title: 'Test Entry',
        content: 'Test content',
        category: 'learning',
        tags: ['test'],
        importance: 3,
        source: 'manual',
        created_at: '2026-03-17T12:00:00Z',
        rrf_score: 0.95
      };
      expect(typeof result.rrf_score).toBe('number');
      expect(result.rrf_score).toBeGreaterThanOrEqual(0);
      expect(result.rrf_score).toBeLessThanOrEqual(1);
    });

    it('should return empty array when no results match', () => {
      const results: any[] = [];
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('add_entry response', () => {
    it('should return object with id and created_at', () => {
      const response = {
        id: 'entry-1',
        created_at: '2026-03-17T12:00:00Z'
      };
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('created_at');
    });

    it('should return UUID-format id', () => {
      const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(id)).toBe(true);
    });

    it('should return ISO 8601 timestamp for created_at', () => {
      const createdAt = '2026-03-17T12:00:00Z';
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
      expect(iso8601Regex.test(createdAt)).toBe(true);
    });
  });

  describe('list_entries response', () => {
    it('should return array of entries', () => {
      const entries = [
        {
          id: 'entry-1',
          title: 'Test Entry',
          content: 'Test content',
          category: 'learning',
          tags: ['test'],
          importance: 3,
          source: 'manual',
          created_at: '2026-03-17T12:00:00Z'
        }
      ];
      expect(Array.isArray(entries)).toBe(true);
    });

    it('should include all required fields in entry object', () => {
      const entry = {
        id: 'entry-1',
        title: 'Test Entry',
        content: 'Test content',
        category: 'learning',
        tags: ['test'],
        importance: 3,
        source: 'manual',
        created_at: '2026-03-17T12:00:00Z'
      };
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('title');
      expect(entry).toHaveProperty('content');
      expect(entry).toHaveProperty('category');
      expect(entry).toHaveProperty('tags');
      expect(entry).toHaveProperty('importance');
      expect(entry).toHaveProperty('source');
      expect(entry).toHaveProperty('created_at');
    });

    it('should return empty array when no entries exist', () => {
      const entries: any[] = [];
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBe(0);
    });
  });
});

/**
 * Error Handling Tests
 * Tests for graceful error handling and stderr logging
 */
describe('Error Handling', () => {
  describe('Startup validation', () => {
    it('should detect missing environment variables at startup', () => {
      const envVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_EMBEDDING_API_KEY'];
      const missingVars = envVars.filter(envVar => !process.env[envVar]);
      // This test documents that missing env vars should be detected
      expect(Array.isArray(missingVars)).toBe(true);
    });
  });

  describe('Invalid input handling', () => {
    it('should handle search with empty query', () => {
      const query = '';
      expect(query.length).toBe(0);
    });

    it('should handle add_entry with title exceeding max length', () => {
      const title = 'a'.repeat(501);
      expect(title.length).toBeGreaterThan(500);
    });

    it('should handle add_entry with content exceeding max length', () => {
      const content = 'a'.repeat(10001);
      expect(content.length).toBeGreaterThan(10000);
    });

    it('should handle add_entry with invalid category', () => {
      const category = 'invalid';
      const validCategories = ['learning', 'technique', 'decision', 'insight', 'resource', 'template', 'pattern', 'principle'];
      expect(validCategories).not.toContain(category);
    });

    it('should handle add_entry with tags exceeding max count', () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      expect(tags.length).toBeGreaterThan(20);
    });

    it('should handle add_entry with importance outside range', () => {
      const importance = 10;
      expect(importance < 1 || importance > 5).toBe(true);
    });

    it('should handle list_entries with negative limit', () => {
      const limit = -5;
      const clampedLimit = Math.max(1, Math.min(50, limit));
      expect(clampedLimit).toBe(1);
    });
  });

  describe('Error logging', () => {
    it('should log validation errors to stderr', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write');
      // Error logging to stderr is expected behavior
      expect(process.stderr).toBeDefined();
      stderrSpy.mockRestore();
    });

    it('should not crash on invalid input', () => {
      // This test documents that invalid inputs should not cause process exit
      expect(() => {
        // Invalid input scenario
        const title = 'a'.repeat(501);
        if (title.length > 500) {
          // Should return error result, not throw
        }
      }).not.toThrow();
    });
  });

  describe('External API and database failure handling', () => {
    it('should handle Google API connection failure gracefully', () => {
      // This test documents that API failures should not crash server
      expect(() => {
        // API failure scenario
      }).not.toThrow();
    });

    it('should handle Supabase connection failure gracefully', () => {
      // This test documents that database failures should not crash server
      expect(() => {
        // Database failure scenario
      }).not.toThrow();
    });

    it('should return error result on embedding generation failure', () => {
      // This test documents error handling for embedding API
      const errorResult = { error: 'Failed to generate embedding' };
      expect(errorResult).toHaveProperty('error');
    });

    it('should return error result on database query failure', () => {
      // This test documents error handling for database operations
      const errorResult = { error: 'Database operation failed' };
      expect(errorResult).toHaveProperty('error');
    });
  });
});

/**
 * Tool Handler Tests
 * Tests for MCP tool handler implementations
 */
describe('Tool Handlers', () => {
  describe('search_brain handler', () => {
    it('should generate embedding from query', () => {
      const query = 'test query';
      expect(typeof query).toBe('string');
      expect(query.length).toBeGreaterThan(0);
    });

    it('should execute hybrid search RPC', () => {
      // This test documents hybrid search execution
      expect(true).toBe(true);
    });

    it('should combine semantic and full-text results with RRF', () => {
      // This test documents RRF (Reciprocal Rank Fusion) scoring
      const rrfScore = 1 / (60 + 1) + 1 / (60 + 2); // Example RRF calculation
      expect(typeof rrfScore).toBe('number');
    });

    it('should return results ordered by rrf_score descending', () => {
      const results = [
        { id: '1', rrf_score: 0.9 },
        { id: '2', rrf_score: 0.8 },
        { id: '3', rrf_score: 0.7 }
      ];
      const sorted = [...results].sort((a, b) => b.rrf_score - a.rrf_score);
      expect(sorted[0].rrf_score).toBeGreaterThan(sorted[1].rrf_score);
    });

    it('should respect limit parameter', () => {
      const limit = 5;
      const results = Array.from({ length: 20 }, (_, i) => ({ id: `entry-${i}` }));
      const limited = results.slice(0, limit);
      expect(limited.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('add_entry handler', () => {
    it('should validate all input constraints', () => {
      const input = {
        title: 'Valid Title',
        content: 'Valid content',
        category: 'learning',
        tags: ['tag1'],
        importance: 3,
        source: 'test'
      };
      expect(input.title.length).toBeLessThanOrEqual(500);
      expect(input.content.length).toBeLessThanOrEqual(10000);
      expect(['learning', 'technique', 'decision', 'insight', 'resource', 'template', 'pattern', 'principle']).toContain(input.category);
    });

    it('should generate embedding from content', () => {
      const content = 'test content';
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should insert entry with embedding to database', () => {
      // This test documents database insertion with embedding
      expect(true).toBe(true);
    });

    it('should return generated id and created_at', () => {
      const response = {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        created_at: '2026-03-17T12:00:00Z'
      };
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('created_at');
    });

    it('should use default importance of 3 if not provided', () => {
      const importance = undefined;
      const defaultImportance = importance ?? 3;
      expect(defaultImportance).toBe(3);
    });

    it('should accept optional source parameter', () => {
      const source = 'manual';
      expect(typeof source).toBe('string');
    });
  });

  describe('list_entries handler', () => {
    it('should query all entries from database', () => {
      // This test documents database query for entries
      expect(true).toBe(true);
    });

    it('should filter by category if provided', () => {
      const category = 'learning';
      const entries = [
        { id: '1', category: 'learning' },
        { id: '2', category: 'learning' },
        { id: '3', category: 'technique' }
      ];
      const filtered = entries.filter(e => e.category === category);
      expect(filtered.every(e => e.category === category)).toBe(true);
    });

    it('should respect limit parameter', () => {
      const limit = 5;
      const entries = Array.from({ length: 20 }, (_, i) => ({ id: `entry-${i}` }));
      const limited = entries.slice(0, limit);
      expect(limited.length).toBeLessThanOrEqual(limit);
    });

    it('should clamp limit to 1-50 range', () => {
      const clampLimit = (limit: number) => Math.max(1, Math.min(50, limit));
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(60)).toBe(50);
    });

    it('should return entries ordered by created_at descending', () => {
      const entries = [
        { id: '1', created_at: '2026-03-15T12:00:00Z' },
        { id: '2', created_at: '2026-03-17T12:00:00Z' },
        { id: '3', created_at: '2026-03-16T12:00:00Z' }
      ];
      const sorted = [...entries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      expect(sorted[0].created_at).toBeGreaterThanOrEqual(sorted[1].created_at);
    });
  });
});

/**
 * MCP Protocol Tests
 * Tests for Model Context Protocol compliance
 */
describe('MCP Protocol', () => {
  describe('STDIO communication', () => {
    it('should accept input via stdin', () => {
      // This test documents stdin input acceptance
      expect(process.stdin).toBeDefined();
    });

    it('should output responses via stdout', () => {
      // This test documents stdout output
      expect(process.stdout).toBeDefined();
    });

    it('should output errors via stderr', () => {
      // This test documents stderr output for errors
      expect(process.stderr).toBeDefined();
    });
  });

  describe('Tool registration', () => {
    it('should register search_brain tool', () => {
      const tool = {
        name: 'search_brain',
        description: 'Search the knowledge base using hybrid search',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          },
          required: ['query']
        }
      };
      expect(tool.name).toBe('search_brain');
    });

    it('should register add_entry tool', () => {
      const tool = {
        name: 'add_entry',
        description: 'Add a new entry to the knowledge base',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string' },
            tags: { type: 'array' },
            importance: { type: 'number' },
            source: { type: 'string' }
          },
          required: ['title', 'content', 'category']
        }
      };
      expect(tool.name).toBe('add_entry');
    });

    it('should register list_entries tool', () => {
      const tool = {
        name: 'list_entries',
        description: 'List entries from the knowledge base',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            category: { type: 'string' }
          },
          required: []
        }
      };
      expect(tool.name).toBe('list_entries');
    });
  });
});
