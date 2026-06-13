import request from 'supertest';

import { getAccountDb } from './account-db';
import { handlers as app } from './app-simplefin/app-simplefin';
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

describe('/simplefin', () => {
  describe('POST /status', () => {
    it('requires a file ID', async () => {
      const res = await request(app)
        .post('/status')
        .set('x-actual-token', 'valid-token-admin')
        .send({});

      expect(res.statusCode).toEqual(400);
      expect(res.body.reason).toBe('file-id-required');
    });

    it('uses scoped credentials for a user with file access', async () => {
      const fileId = 'simplefin-shared-file';
      createFile({ fileId, owner: 'genericAdmin' });
      getAccountDb().mutate(
        'INSERT INTO user_access (user_id, file_id) VALUES (?, ?)',
        ['genericUser', fileId],
      );
      secretsService.set(
        getScopedSecretName('simplefin_token', fileId),
        'scoped-token',
      );

      const res = await request(app)
        .post('/status')
        .set('x-actual-token', 'valid-token-user')
        .send({ fileId });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({
        status: 'ok',
        data: {
          configured: true,
        },
      });

      deleteFile(fileId);
    });

    it('rejects users without file access', async () => {
      const fileId = 'simplefin-private-file';
      createFile({ fileId, owner: 'genericAdmin' });

      const res = await request(app)
        .post('/status')
        .set('x-actual-token', 'valid-token-user')
        .send({ fileId });

      expect(res.statusCode).toEqual(403);
      expect(res.body.reason).toBe('file-access-denied');

      deleteFile(fileId);
    });
  });
});
