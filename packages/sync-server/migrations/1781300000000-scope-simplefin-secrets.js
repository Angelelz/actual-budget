import { getAccountDb } from '../src/account-db';

const ACTIVE_SIMPLEFIN_FILE_ID = 'a1672821-f875-4d94-8f48-c694cc2e5f0e';

const SIMPLEFIN_SECRET_NAMES = ['simplefin_token', 'simplefin_accessKey'];

const scopedName = name => `${name}:file:${ACTIVE_SIMPLEFIN_FILE_ID}`;

export const up = async function () {
  const accountDb = getAccountDb();

  accountDb.transaction(() => {
    for (const name of SIMPLEFIN_SECRET_NAMES) {
      accountDb.mutate(
        `
        INSERT OR IGNORE INTO secrets (name, value)
        SELECT ?, value FROM secrets WHERE name = ?
        `,
        [scopedName(name), name],
      );
    }
  });
};

export const down = async function () {
  const accountDb = getAccountDb();

  accountDb.transaction(() => {
    for (const name of SIMPLEFIN_SECRET_NAMES) {
      accountDb.mutate('DELETE FROM secrets WHERE name = ?', [
        scopedName(name),
      ]);
    }
  });
};
