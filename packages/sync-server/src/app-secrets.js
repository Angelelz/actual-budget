import express from 'express';

import { getActiveLoginMethod, isAdmin } from './account-db';
import {
  getScopedSecretName,
  isSimpleFinSecret,
  SecretName,
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

// In OpenID mode the secrets store is admin-managed; non-admins must be
// blocked from both reads and writes, otherwise they can enumerate which
// integrations are configured.
function canManageSecrets(userId) {
  return getActiveLoginMethod() !== 'openid' || isAdmin(userId);
}

app.post('/', async (req, res) => {
  const { name, value, fileId } = req.body || {};

  if (!(name in SecretName)) {
    res.status(400).send({
      status: 'error',
      reason: 'invalid-secret-name',
      details: 'Unknown secret name',
    });
    return;
  }

  let secretName = name;

  if (isSimpleFinSecret(name)) {
    // SimpleFIN credentials are scoped per budget file, so the budget owner
    // (or an admin) may set them even when they are not a global secrets
    // admin in OpenID mode.
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
  } else if (!canManageSecrets(res.locals.user_id)) {
    res.status(403).send({
      status: 'error',
      reason: 'not-admin',
      details: 'You have to be admin to set secrets',
    });
    return;
  }

  secretsService.set(secretName, value);

  res.status(200).send({ status: 'ok' });
});

app.get('/:name', async (req, res) => {
  if (!canManageSecrets(res.locals.user_id)) {
    res.status(403).send({
      status: 'error',
      reason: 'not-admin',
      details: 'You have to be admin to read secrets',
    });
    return;
  }

  const name = req.params.name;
  if (!(name in SecretName)) {
    res.status(404).send('key not found');
    return;
  }

  if (secretsService.exists(name)) {
    res.sendStatus(204);
  } else {
    res.status(404).send('key not found');
  }
});
