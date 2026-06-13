import express from 'express';

import { getAccountDb, isAdmin } from './account-db';
import {
  getScopedSecretName,
  isSimpleFinSecret,
  secretsService,
} from './services/secrets-service';
import { getFileById, getFileOwnerId } from './services/user-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from './util/middlewares';

const app = express();

export { app as handlers };
app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(validateSessionMiddleware);

app.post('/', async (req, res) => {
  let method;
  try {
    const result = getAccountDb().first(
      'SELECT method FROM auth WHERE active = 1',
    );
    method = result?.method;
  } catch (error) {
    console.error('Failed to fetch auth method:', error);
    return res.status(500).send({
      status: 'error',
      reason: 'database-error',
      details: 'Failed to validate authentication method',
    });
  }
  const { name, value, fileId } = req.body || {};
  let secretName = name;

  if (isSimpleFinSecret(name)) {
    if (!fileId || typeof fileId !== 'string') {
      res.status(400).send({
        status: 'error',
        reason: 'file-id-required',
        details: 'fileId is required for SimpleFIN secrets',
      });

      return;
    }

    if (!getFileById(fileId)) {
      res.status(403).send({
        status: 'error',
        reason: 'file-access-denied',
        details: "File does not exist or you don't have access to it",
      });

      return;
    }

    const canSaveScopedSecret =
      isAdmin(res.locals.user_id) ||
      getFileOwnerId(fileId) === res.locals.user_id;

    if (!canSaveScopedSecret) {
      res.status(403).send({
        status: 'error',
        reason: 'not-owner-or-admin',
        details: 'You have to be the budget owner or admin to set secrets',
      });

      return;
    }

    secretName = getScopedSecretName(name, fileId);
  }

  if (method === 'openid') {
    const canSaveSecrets = isAdmin(res.locals.user_id);

    if (!canSaveSecrets && !isSimpleFinSecret(name)) {
      res.status(403).send({
        status: 'error',
        reason: 'not-admin',
        details: 'You have to be admin to set secrets',
      });

      return;
    }
  }

  secretsService.set(secretName, value);

  res.status(200).send({ status: 'ok' });
});

app.get('/:name', async (req, res) => {
  const name = req.params.name;
  const keyExists = secretsService.exists(name);
  if (keyExists) {
    res.sendStatus(204);
  } else {
    res.status(404).send('key not found');
  }
});
