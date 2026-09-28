import { Given } from '../../../../support/fixtures/testFixtures';
import { deleteUserByUsername } from '../../../../src/db/testDb';

/**
 * Clears a login left behind by an earlier run so a registration scenario can
 * start from a known-empty state. Deleting a user that is not there is a no-op.
 */
Given('the test account does not exist', async ({ testUsers }) => {
    await deleteUserByUsername(testUsers.current());
});
