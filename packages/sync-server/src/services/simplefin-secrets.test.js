import { getAccountDb } from '#account-db';

import { getScopedSecretName, isSimpleFinSecret } from './secrets-service';
import { authorizeSimpleFinSecret } from './simplefin-secrets';

const ADMIN = 'genericAdmin';
const OWNER = 'genericUser';
const OTHER = 'someoneElse';

const createFile = ({ fileId, owner }) => {
  getAccountDb().mutate(
    'INSERT INTO files (id, name, owner, deleted) VALUES (?, ?, ?, 0)',
    [fileId, fileId, owner],
  );
};

describe('authorizeSimpleFinSecret', () => {
  afterEach(() => {
    getAccountDb().mutate('DELETE FROM files');
  });

  it('identifies SimpleFIN secret names', () => {
    expect(isSimpleFinSecret('simplefin_token')).toBe(true);
    expect(isSimpleFinSecret('simplefin_accessKey')).toBe(true);
    expect(isSimpleFinSecret('gocardless_secretId')).toBe(false);
  });

  it('requires a fileId', () => {
    const result = authorizeSimpleFinSecret({
      name: 'simplefin_token',
      fileId: undefined,
      userId: ADMIN,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      status: 400,
      body: {
        status: 'error',
        reason: 'file-id-required',
        details: 'fileId is required for SimpleFIN secrets',
      },
    });
  });

  it('rejects an unknown / inaccessible file', () => {
    const result = authorizeSimpleFinSecret({
      name: 'simplefin_token',
      fileId: 'missing-file',
      userId: ADMIN,
    });
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(403);
    expect(result.error.body.reason).toBe('file-access-denied');
  });

  it('lets the budget owner scope the secret to their file', () => {
    createFile({ fileId: 'file-1', owner: OWNER });
    const result = authorizeSimpleFinSecret({
      name: 'simplefin_token',
      fileId: 'file-1',
      userId: OWNER,
    });
    expect(result).toEqual({
      ok: true,
      secretName: getScopedSecretName('simplefin_token', 'file-1'),
    });
  });

  it('lets an admin scope a secret to a file they do not own', () => {
    createFile({ fileId: 'file-2', owner: OWNER });
    const result = authorizeSimpleFinSecret({
      name: 'simplefin_token',
      fileId: 'file-2',
      userId: ADMIN,
    });
    expect(result.ok).toBe(true);
    expect(result.secretName).toBe(
      getScopedSecretName('simplefin_token', 'file-2'),
    );
  });

  it('rejects a non-owner, non-admin user', () => {
    createFile({ fileId: 'file-3', owner: OWNER });
    const result = authorizeSimpleFinSecret({
      name: 'simplefin_token',
      fileId: 'file-3',
      userId: OTHER,
    });
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(403);
    expect(result.error.body.reason).toBe('not-owner-or-admin');
  });
});
