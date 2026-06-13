import express from 'express';

import { getActiveLoginMethod, isAdmin } from './account-db';
import { SecretName, secretsService } from './services/secrets-service';
import {
  authorizeSimpleFinSecret,
  isSimpleFinSecret,
} from './services/simplefin-secrets';
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

  // SimpleFIN secrets are authorized per budget file (fork seam); every other
  // secret stays admin-managed in OpenID mode.
  let secretName = name;
  if (isSimpleFinSecret(name)) {
    const result = authorizeSimpleFinSecret({
      name,
      fileId,
      userId: res.locals.user_id,
    });
    if (!result.ok) {
      res.status(result.error.status).send(result.error.body);
      return;
    }
    secretName = result.secretName;
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
