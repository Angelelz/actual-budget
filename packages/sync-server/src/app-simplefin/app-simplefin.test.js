import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccountDb } from '#account-db';
import { SecretName, secretsService } from '#services/secrets-service';
import { assertUrlAllowed } from '#util/ssrf';

import { handlers as app } from './app-simplefin';

vi.mock('#util/ssrf', () => ({
  assertUrlAllowed: vi.fn().mockResolvedValue(undefined),
}));

const VALID_ACCESS_KEY = 'https://user:pass@bridge.example.com/simplefin';
const SETUP_TOKEN = Buffer.from(
  'https://bridge.example.com/claim/abc',
).toString('base64');

const statusResponse = (status, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: () => Promise.resolve(body),
});

const okResponse = body => statusResponse(200, body);

// The claim is a POST to the bridge; listing accounts is a GET. Route the mock
// by method so a test can stub one or both.
function mockFetch({ claim, accounts }) {
  global.fetch = vi
    .fn()
    .mockImplementation((url, options) =>
      Promise.resolve(options?.method === 'POST' ? claim : accounts),
    );
}

const post = path =>
  request(app).post(path).set('x-actual-token', 'valid-token');

const TEST_FILE_ID = 'simplefin-test-file';

describe('app-simplefin', () => {
  beforeEach(() => {
    secretsService.set(SecretName.simplefin_token, null);
    secretsService.set(SecretName.simplefin_accessKey, null);
    secretsService.set(SecretName.simplefin_token, null, TEST_FILE_ID);
    secretsService.set(SecretName.simplefin_accessKey, null, TEST_FILE_ID);
    vi.spyOn(console, 'log').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('/status', () => {
    it('reports configured when a real token is stored', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);

      const res = await post('/status');

      expect(res.body.data.configured).toBe(true);
    });

    it('reports not configured when the stored token is a Forbidden message', async () => {
      secretsService.set(
        SecretName.simplefin_token,
        'Forbidden (was it already claimed?)',
      );

      const res = await post('/status');

      expect(res.body.data.configured).toBe(false);
    });

    it('reports per-budget-file source when a file-scoped token is stored', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN, TEST_FILE_ID);

      const res = await post('/status').set('X-Actual-File-Id', TEST_FILE_ID);

      expect(res.body.data).toEqual({
        configured: true,
        source: 'per-budget-file',
      });
    });

    it('falls back to global credentials when the file has none', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);

      const res = await post('/status').set('X-Actual-File-Id', TEST_FILE_ID);

      expect(res.body.data).toEqual({
        configured: true,
        source: 'global',
      });
    });

    it('reports not configured when neither scope has a token', async () => {
      const res = await post('/status').set('X-Actual-File-Id', TEST_FILE_ID);

      expect(res.body.data).toEqual({
        configured: false,
        source: null,
      });
    });

    it('rejects an invalid file id', async () => {
      const res = await post('/status').set(
        'X-Actual-File-Id',
        'bad/../file/id',
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.reason).toBe('invalid-file-id');
    });

    it('rejects a user without access to the file', async () => {
      const db = getAccountDb();
      db.mutate('DELETE FROM auth');
      db.mutate(
        "INSERT INTO auth (method, active, extra_data, display_name) VALUES ('openid', 1, '', 'OpenID')",
      );
      db.mutate('INSERT INTO files (id, deleted, owner) VALUES (?, FALSE, ?)', [
        'simplefin-other-user-file',
        'genericAdmin',
      ]);

      const res = await request(app)
        .post('/status')
        .set('x-actual-token', 'valid-token-user')
        .set('X-Actual-File-Id', 'simplefin-other-user-file');

      db.mutate('DELETE FROM files WHERE id = ?', [
        'simplefin-other-user-file',
      ]);
      db.mutate('DELETE FROM auth');

      expect(res.statusCode).toBe(403);
      expect(res.body.reason).toBe('file-access-denied');
    });
  });

  describe('/accounts', () => {
    it('claims the token, trims the access key and returns accounts', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({
        claim: okResponse(`${VALID_ACCESS_KEY}\n`),
        accounts: okResponse(
          JSON.stringify({ accounts: [{ id: 'account-1' }] }),
        ),
      });

      const res = await post('/accounts');

      expect(res.body.data.accounts).toEqual([{ id: 'account-1' }]);
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBe(
        VALID_ACCESS_KEY,
      );
    });

    it('treats a "Forbidden (was it already claimed?)" claim response as invalid and does not persist it', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({ claim: okResponse('Forbidden (was it already claimed?)') });

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('INVALID_ACCESS_TOKEN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('treats a blank claim response as invalid and does not persist it', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({ claim: okResponse('   \n') });

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('INVALID_ACCESS_TOKEN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('re-claims when a stale Forbidden access key is cached', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      secretsService.set(
        SecretName.simplefin_accessKey,
        'Forbidden (was it already claimed?)',
      );
      mockFetch({
        claim: okResponse(VALID_ACCESS_KEY),
        accounts: okResponse(
          JSON.stringify({ accounts: [{ id: 'account-1' }] }),
        ),
      });

      const res = await post('/accounts');

      expect(res.body.data.accounts).toEqual([{ id: 'account-1' }]);
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBe(
        VALID_ACCESS_KEY,
      );
    });

    it('re-claims when a stale empty access key is cached', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      secretsService.set(SecretName.simplefin_accessKey, '');
      mockFetch({
        claim: okResponse(VALID_ACCESS_KEY),
        accounts: okResponse(
          JSON.stringify({ accounts: [{ id: 'account-1' }] }),
        ),
      });

      const res = await post('/accounts');

      expect(res.body.data.accounts).toEqual([{ id: 'account-1' }]);
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBe(
        VALID_ACCESS_KEY,
      );
    });

    it('re-claims when a stale non-URL access key is cached', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      secretsService.set(
        SecretName.simplefin_accessKey,
        '<html>Bad Gateway</html>',
      );
      mockFetch({
        claim: okResponse(VALID_ACCESS_KEY),
        accounts: okResponse(
          JSON.stringify({ accounts: [{ id: 'account-1' }] }),
        ),
      });

      const res = await post('/accounts');

      expect(res.body.data.accounts).toEqual([{ id: 'account-1' }]);
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBe(
        VALID_ACCESS_KEY,
      );
    });

    it('treats a claim response that is not an access URL as invalid and does not persist it', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({ claim: okResponse('<html>Service unavailable</html>') });

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('INVALID_ACCESS_TOKEN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('rejects a token that does not decode to a claim URL without contacting SimpleFIN', async () => {
      secretsService.set(
        SecretName.simplefin_token,
        Buffer.from('not a claim url').toString('base64'),
      );
      global.fetch = vi.fn();

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('INVALID_ACCESS_TOKEN');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('treats a 403 Forbidden claim as an invalid token and does not persist it', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({
        claim: statusResponse(403, 'Forbidden (was it already claimed?)'),
      });

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('INVALID_ACCESS_TOKEN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('reports SERVER_DOWN when the claim response is a redirect', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({ claim: statusResponse(302) });

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('SERVER_DOWN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('reports SERVER_DOWN when the claim fails with a server error', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({
        claim: statusResponse(502, '<html>Bad Gateway</html>'),
      });

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('SERVER_DOWN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('reports SERVER_DOWN when the claim request fails at the network level', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('SERVER_DOWN');
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('reports SERVER_DOWN when the claim URL fails the SSRF preflight', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      assertUrlAllowed.mockRejectedValueOnce(
        new Error('Unable to resolve host: bridge.example.com'),
      );
      global.fetch = vi.fn();

      const res = await post('/accounts');

      expect(res.body.data.error_code).toBe('SERVER_DOWN');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('claims a file-scoped token and stores the access key at the same scope', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN, TEST_FILE_ID);
      mockFetch({
        claim: okResponse(VALID_ACCESS_KEY),
        accounts: okResponse(
          JSON.stringify({ accounts: [{ id: 'account-1' }] }),
        ),
      });

      const res = await post('/accounts').set('X-Actual-File-Id', TEST_FILE_ID);

      expect(res.body.data.accounts).toEqual([{ id: 'account-1' }]);
      expect(
        secretsService.get(SecretName.simplefin_accessKey, TEST_FILE_ID),
      ).toBe(VALID_ACCESS_KEY);
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBeNull();
    });

    it('falls back to the global token when the file has no credentials', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN);
      mockFetch({
        claim: okResponse(VALID_ACCESS_KEY),
        accounts: okResponse(
          JSON.stringify({ accounts: [{ id: 'account-1' }] }),
        ),
      });

      const res = await post('/accounts').set('X-Actual-File-Id', TEST_FILE_ID);

      expect(res.body.data.accounts).toEqual([{ id: 'account-1' }]);
      expect(secretsService.get(SecretName.simplefin_accessKey)).toBe(
        VALID_ACCESS_KEY,
      );
      expect(
        secretsService.get(SecretName.simplefin_accessKey, TEST_FILE_ID),
      ).toBeNull();
    });
  });

  describe('/transactions', () => {
    it('reports an invalid token when the cached access key is not an access URL', async () => {
      secretsService.set(
        SecretName.simplefin_accessKey,
        '<html>Bad Gateway</html>',
      );
      global.fetch = vi.fn();

      const res = await post('/transactions').send({
        accountId: 'account-1',
        startDate: '2026-07-01',
      });

      expect(res.body.data.error_code).toBe('INVALID_ACCESS_TOKEN');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('uses the file-scoped access key when the file has credentials', async () => {
      secretsService.set(SecretName.simplefin_token, SETUP_TOKEN, TEST_FILE_ID);
      secretsService.set(
        SecretName.simplefin_accessKey,
        VALID_ACCESS_KEY,
        TEST_FILE_ID,
      );
      mockFetch({
        accounts: okResponse(
          JSON.stringify({
            accounts: [
              {
                id: 'account-1',
                balance: '10.00',
                currency: 'USD',
                'balance-date': 1753999200,
                org: { name: 'Test Bank' },
                transactions: [],
              },
            ],
            errors: [],
          }),
        ),
      });

      const res = await post('/transactions')
        .set('X-Actual-File-Id', TEST_FILE_ID)
        .send({
          accountId: 'account-1',
          startDate: '2026-07-01',
        });

      expect(res.body.data.error_code).toBeUndefined();
      expect(res.body.data.startingBalance).toBe(1000);
    });
  });
});
