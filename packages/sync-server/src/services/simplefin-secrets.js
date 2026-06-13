import { isAdmin } from '#account-db';

import { getScopedSecretName, isSimpleFinSecret } from './secrets-service';
import { getFileById, getFileOwnerId } from './user-service';

// Re-exported so callers only need to import from this fork-owned module.
export { isSimpleFinSecret };

/**
 * Authorize and resolve the storage name for a SimpleFIN secret.
 *
 * SimpleFIN credentials are scoped per budget file, so the budget owner (or an
 * admin) may set them even when they are not a global secrets admin in OpenID
 * mode. Keeping this logic in a fork-owned module means the upstream
 * `app-secrets` route only needs a thin one-branch seam, which keeps future
 * merges from conflicting on the whole authorization block.
 *
 * Returns either `{ ok: true, secretName }` or `{ ok: false, error }` where
 * `error` is `{ status, body }` ready to send on the response.
 */
export function authorizeSimpleFinSecret({ name, fileId, userId }) {
  if (!fileId || typeof fileId !== 'string') {
    return {
      ok: false,
      error: {
        status: 400,
        body: {
          status: 'error',
          reason: 'file-id-required',
          details: 'fileId is required for SimpleFIN secrets',
        },
      },
    };
  }

  if (!getFileById(fileId)) {
    return {
      ok: false,
      error: {
        status: 403,
        body: {
          status: 'error',
          reason: 'file-access-denied',
          details: "File does not exist or you don't have access to it",
        },
      },
    };
  }

  const canSaveScopedSecret =
    isAdmin(userId) || getFileOwnerId(fileId) === userId;

  if (!canSaveScopedSecret) {
    return {
      ok: false,
      error: {
        status: 403,
        body: {
          status: 'error',
          reason: 'not-owner-or-admin',
          details: 'You have to be the budget owner or admin to set secrets',
        },
      },
    };
  }

  return { ok: true, secretName: getScopedSecretName(name, fileId) };
}
