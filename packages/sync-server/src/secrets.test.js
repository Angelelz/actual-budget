import request from 'supertest';

import { getAccountDb } from './account-db';
import { handlers as app } from './app-secrets';
import {
  getScopedSecretName,
  secretsService,
} from './services/secrets-service';

const createFile = ({ fileId, owner = 'genericAdmin' }) => {
  getAccountDb().mutate(
    'INSERT INTO files (id, name, owner, deleted) VALUES (?, ?, ?, 0)',
    [fileId, fileId, owner],
  );
};

const deleteFile = fileId => {
  getAccountDb().mutate('DELETE FROM user_access WHERE file_id = ?', [fileId]);
  getAccountDb().mutate('DELETE FROM files WHERE id = ?', [fileId]);
};

describe('secretsService', () => {
  const testSecretName = 'testSecret';
  const testSecretValue = 'testValue';

  it('should set a secret', () => {
    const result = secretsService.set(testSecretName, testSecretValue);
    expect(result).toBeDefined();
    expect(result.changes).toBe(1);
  });

  it('should get a secret', () => {
    const result = secretsService.get(testSecretName);
    expect(result).toBeDefined();
    expect(result).toBe(testSecretValue);
  });

  it('should check if a secret exists', () => {
    const exists = secretsService.exists(testSecretName);
    expect(exists).toBe(true);

    const nonExistent = secretsService.exists('nonExistentSecret');
    expect(nonExistent).toBe(false);
  });

  it('should update a secret', () => {
    const newValue = 'newValue';
    const setResult = secretsService.set(testSecretName, newValue);
    expect(setResult).toBeDefined();
    expect(setResult.changes).toBe(1);

    const getResult = secretsService.get(testSecretName);
    expect(getResult).toBeDefined();
    expect(getResult).toBe(newValue);
  });

  describe('secrets api', () => {
    it('returns 401 if the user is not authenticated', async () => {
      secretsService.set(testSecretName, testSecretValue);
      const res = await request(app).get(`/${testSecretName}`);

      expect(res.statusCode).toEqual(401);
      expect(res.body).toEqual({
        details: 'token-not-found',
        reason: 'unauthorized',
        status: 'error',
      });
    });

    it('returns 404 if secret does not exist', async () => {
      const res = await request(app)
        .get(`/thiskeydoesnotexist`)
        .set('x-actual-token', 'valid-token');

      expect(res.statusCode).toEqual(404);
    });

    it('returns 204 if secret exists', async () => {
      secretsService.set(testSecretName, testSecretValue);
      const res = await request(app)
        .get(`/${testSecretName}`)
        .set('x-actual-token', 'valid-token');

      expect(res.statusCode).toEqual(204);
    });

    it('returns 200 if secret was set', async () => {
      secretsService.set(testSecretName, testSecretValue);
      const res = await request(app)
        .post(`/`)
        .set('x-actual-token', 'valid-token')
        .send({ name: testSecretName, value: testSecretValue });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({
        status: 'ok',
      });
    });

    it('scopes SimpleFIN secrets to the provided file ID', async () => {
      const fileId = 'simplefin-secret-file';
      createFile({ fileId, owner: 'genericAdmin' });

      const res = await request(app)
        .post(`/`)
        .set('x-actual-token', 'valid-token-admin')
        .send({
          name: 'simplefin_token',
          value: 'scoped-token',
          fileId,
        });

      expect(res.statusCode).toEqual(200);
      expect(
        secretsService.get(getScopedSecretName('simplefin_token', fileId)),
      ).toBe('scoped-token');
      expect(secretsService.get('simplefin_token')).not.toBe('scoped-token');

      deleteFile(fileId);
    });

    it('allows a budget owner to set scoped SimpleFIN secrets', async () => {
      const fileId = 'simplefin-owner-file';
      createFile({ fileId, owner: 'genericUser' });

      const res = await request(app)
        .post(`/`)
        .set('x-actual-token', 'valid-token-user')
        .send({
          name: 'simplefin_token',
          value: 'owner-token',
          fileId,
        });

      expect(res.statusCode).toEqual(200);
      expect(
        secretsService.get(getScopedSecretName('simplefin_token', fileId)),
      ).toBe('owner-token');

      deleteFile(fileId);
    });

    it('does not allow a non-owner basic user to set scoped SimpleFIN secrets', async () => {
      const fileId = 'simplefin-not-owner-file';
      createFile({ fileId, owner: 'genericAdmin' });

      const res = await request(app)
        .post(`/`)
        .set('x-actual-token', 'valid-token-user')
        .send({
          name: 'simplefin_token',
          value: 'rejected-token',
          fileId,
        });

      expect(res.statusCode).toEqual(403);
      expect(res.body.reason).toBe('not-owner-or-admin');

      deleteFile(fileId);
    });
  });
});
