/**
 * Direct access to the core banking database for test setup and teardown.
 *
 * Two things are only reachable at this level:
 *
 *   Teardown. There is no user-delete endpoint - AuthController exposes only
 *   /register and /login - so an account created by a registration test can
 *   only be removed here.
 *
 *   Daily transfer limits. CreateAccountRequest has no dailyTransferLimit
 *   field, so every account the API creates gets the 3000.00 default assigned
 *   by Account.prePersist(). A limits test that needs a different ceiling has
 *   to set it in the database.
 */
import { Pool } from 'pg';

// Defaults mirror backend/src/main/resources/application.properties, which points
// at the pgvector container from docker-compose.yml (host port 5433).
const pool = new Pool({
    host: process.env.APP_DB_HOST ?? 'localhost',
    port: Number(process.env.APP_DB_PORT ?? 5433),
    database: process.env.APP_DB_NAME ?? 'banking_core',
    user: process.env.APP_DB_USERNAME ?? 'banking_chat',
    password: process.env.APP_DB_PASSWORD ?? 'banking_chat',
    max: 4,
    // Without this a pooled idle client keeps the worker's event loop alive after
    // the last teardown query, and Playwright waits ~10s per worker before exiting.
    allowExitOnIdle: true
});

/**
 * Removes a registered login by email, along with the customer profile the
 * registration UI creates alongside it. Safe to call when the user does not
 * exist, so it works as both an afterEach teardown and a before-hand reset.
 *
 * Returns true if a login row was actually deleted.
 *
 * Registering through the UI is a three-call flow (RegisterPage.jsx): register,
 * login, then POST /api/customers, which writes a `customers` row and stores its
 * id on users.customer_id. Hitting /api/auth/register directly leaves
 * customer_id NULL. Both shapes are handled here.
 *
 * Delete order is forced by the foreign keys: fk_user_roles_user has no
 * ON DELETE CASCADE, and fk_account_customer means the customer cannot go while
 * accounts still point at it. Usernames are lowercased by AuthServiceImpl on the
 * way in, hence the case-insensitive match.
 */
export async function deleteUserByUsername(username: string): Promise<boolean> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const owner = await client.query<{ user_id: string, customer_id: string | null }>(
            'SELECT user_id, customer_id FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );

        if (owner.rowCount === 0) {
            await client.query('COMMIT');
            return false;
        }

        const { user_id: userId, customer_id: customerId } = owner.rows[0];

        await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM users WHERE user_id = $1', [userId]);

        if (customerId !== null) {
            // Registration alone creates no accounts, but a test that went on to
            // open one would leave rows that block the delete. Left in place and
            // reported rather than cascaded - silently deleting accounts and
            // their transactions is not something a teardown helper should do.
            const accounts = await client.query(
                'SELECT 1 FROM account WHERE customer_id = $1',
                [customerId]
            );

            if (accounts.rowCount === 0) {
                await client.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
            } else {
                console.warn(
                    `[testDb] Login ${username} removed, but customer ${customerId} still owns ` +
                    `${accounts.rowCount} account(s) and was left in place. Clean it up by hand.`
                );
            }
        }

        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Bulk teardown for suites that register throwaway accounts with a shared
 * prefix (e.g. `qa-reg-<timestamp>@example.com` with prefix 'qa-reg-').
 * Use it to sweep up orphans left by a run that crashed before teardown.
 *
 * Returns the number of logins removed.
 */
export async function deleteUsersByPrefix(prefix: string): Promise<number> {
    if (!prefix) {
        throw new Error('deleteUsersByPrefix requires a non-empty prefix - refusing to match every user.');
    }

    const matches = await pool.query<{ username: string }>(
        'SELECT username FROM users WHERE username LIKE $1',
        [`${prefix}%`]
    );

    let removed = 0;
    for (const row of matches.rows) {
        if (await deleteUserByUsername(row.username)) {
            removed++;
        }
    }
    return removed;
}

/**
 * Removes a customer and everything hanging off it: accounts, their transactions,
 * savings goals, GIC investments and standing orders, plus any risk score.
 *
 * Deliberately separate from deleteUserByUsername, which refuses to touch
 * accounts. This one is for suites that opened accounts as part of their own
 * arrangement and own every row it deletes - do not point it at a customer a
 * test did not create.
 *
 * Order follows the foreign keys in V001__baseline_schema.sql: fk_transaction_account,
 * fk_savings_goal_account and fk_gic_account all block the account delete, and
 * fk_account_customer blocks the customer delete. standing_orders has no foreign
 * key to account, so its rows are cleared to avoid orphans rather than to satisfy
 * a constraint.
 */
export async function deleteCustomerCascade(customerId: number): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const accounts = await client.query<{ account_id: string }>(
            'SELECT account_id FROM account WHERE customer_id = $1',
            [customerId]
        );
        const accountIds = accounts.rows.map((row) => row.account_id);

        if (accountIds.length > 0) {
            await client.query(
                'DELETE FROM standing_orders WHERE source_account_id = ANY($1::bigint[]) OR payee_account = ANY($1::bigint[])',
                [accountIds]
            );
            await client.query('DELETE FROM bank_transaction WHERE account_id = ANY($1::bigint[])', [accountIds]);
            await client.query('DELETE FROM savings_goals WHERE account_id = ANY($1::bigint[])', [accountIds]);
            await client.query('DELETE FROM gic_investment WHERE account_id = ANY($1::bigint[])', [accountIds]);
            await client.query('DELETE FROM account WHERE account_id = ANY($1::bigint[])', [accountIds]);
        }

        await client.query('DELETE FROM risk_scores WHERE customer_id = $1', [customerId]);
        await client.query('UPDATE users SET customer_id = NULL WHERE customer_id = $1', [customerId]);
        await client.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function userExists(username: string): Promise<boolean> {
    const result = await pool.query(
        'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
    );
    return result.rowCount === 1;
}

/**
 * Overrides an account's daily transfer limit, returning the previous value so
 * a test can put it back. There is no API for this: UpdateAccountRequest only
 * carries interestRate.
 */
export async function setDailyTransferLimit(accountId: number, limit: string): Promise<string> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const before = await client.query<{ daily_transfer_limit: string }>(
            'SELECT daily_transfer_limit FROM account WHERE account_id = $1 FOR UPDATE',
            [accountId]
        );

        if (before.rowCount === 0) {
            throw new Error(`No account ${accountId} to set a daily transfer limit on.`);
        }

        await client.query(
            'UPDATE account SET daily_transfer_limit = $2, updated_at = NOW() WHERE account_id = $1',
            [accountId, limit]
        );

        await client.query('COMMIT');
        return before.rows[0].daily_transfer_limit;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function getDailyTransferLimit(accountId: number): Promise<string | null> {
    const result = await pool.query<{ daily_transfer_limit: string }>(
        'SELECT daily_transfer_limit FROM account WHERE account_id = $1',
        [accountId]
    );
    return result.rowCount === 0 ? null : result.rows[0].daily_transfer_limit;
}

/** Closes the pool early. Not normally needed: allowExitOnIdle already lets workers exit. */
export async function closeTestDb(): Promise<void> {
    await pool.end();
}
