import fs from 'fs/promises';
import { test as base, createBdd } from 'playwright-bdd';

import {LoginPage} from '../../src/pages/auth/LoginPage';
import {RegistrationPage} from '../../src/pages/auth/RegistrationPage';
import {SavingsGoalsPage} from '../../src/pages/accounts/SavingsGoalsPage';
import {AccountAPI, SeededAccounts} from '../../src/api/account';
import { RegistrationRequest } from '../../src/api/models';
import {beginRequestCapture, clearRequestCapture, recordRequest, snapshotRequestLogs} from '../../src/api/requestLogger';
import {GLOBAL_DATA} from '../../global_data/globalData';
import {deleteCustomerCascade, deleteUserByUsername} from '../../src/db/testDb';

type AppPages = {
    loginPage: LoginPage;
    registrationPage: RegistrationPage;
    savingsGoalsPage: SavingsGoalsPage;
    screenshot: (options: {path: string}) => Promise<void>;
};

/**
 * Per-test registry of the logins a scenario creates.
 *
 * The API has no user-delete endpoint, so anything a registration test signs up
 * would otherwise sit in the database forever and make the next run's duplicate
 * -email assertions fire on the wrong scenario. Every username handed out here
 * is deleted straight from the database when the test finishes, pass or fail.
 */
type TestUsers = {
    /** A fresh address, unique per test, registered for cleanup. */
    unique: (prefix?: string) => string;
    /** The address issued by the last `unique()` or `resolve()` call in this test. */
    current: () => string;
    /** Registers an address created elsewhere so it is cleaned up too. */
    track: (username: string) => string;
    /**
     * Turns a value written in a feature file into a real address.
     *
     *   uniqueEmail   a fresh throwaway, deleted after the test
     *   existingEmail the shared default testing account, never deleted
     *   anything else used as-is (including the malformed values the negative
     *                 scenarios rely on)
     */
    resolve: (value: string) => string;
};

type SeededCustomer = SeededAccounts & {username: string, password: string};

/**
 * A signed-up customer with two accounts, arranged over the API rather than
 * through the browser.
 *
 * The savings goals feature needs accounts to exist before the first click, and
 * re-registering through the form for each scenario would both cost a browser
 * round trip and re-test what registration.feature already covers.
 *
 * Lazy on purpose: nothing is created, and nothing is torn down, unless a
 * scenario actually asks for it.
 */
type BankingCustomer = {
    create: () => Promise<SeededCustomer>;
    /** The customer created earlier in this test. Throws if create() has not run. */
    current: () => SeededCustomer;
};

const wrapRequestLogging = (request: any) => {
    const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;

    for (const method of methods) {
        const original = request[method].bind(request);
        request[method] = async (...args: any[]) => {
            const [url, options] = args;
            recordRequest({
                method: method.toUpperCase(),
                url: String(url),
                body: options?.data ?? options?.json ?? options?.form ?? options?.body,
                headers: options?.headers,
            });
            return original(...args);
        };
    }
};

export const test = base.extend<{pages: AppPages, testUsers: TestUsers, bankingCustomer: BankingCustomer}>({
    request: async ({ request }, use, testInfo) => {
        beginRequestCapture(testInfo.testId);
        wrapRequestLogging(request);

        try {
            await use(request);
        } finally {
            if (testInfo.status === 'failed') {
                const reportFile = testInfo.outputPath('api-request-trace.txt');
                const requestTrace = snapshotRequestLogs(testInfo.testId);
                await fs.writeFile(reportFile, requestTrace, 'utf8');
                await testInfo.attach('api request trace', {
                    path: reportFile,
                    contentType: 'text/plain',
                });
            }
            clearRequestCapture(testInfo.testId);
        }
    },

    pages: async ({ page }, use) => {
        await use({
            loginPage: new LoginPage(page),
            registrationPage: new RegistrationPage(page),
            savingsGoalsPage: new SavingsGoalsPage(page),

            screenshot: async (options: {path: string}) => {
                await page.screenshot(options);
            }
        });
    },

    testUsers: async ({}, use) => {
        const created: string[] = [];
        let lastIssued: string | null = null;

        const track = (username: string) => {
            const normalised = username.trim().toLowerCase();
            if (!created.includes(normalised)) {
                created.push(normalised);
            }
            lastIssued = normalised;
            return normalised;
        };

        // crypto.randomUUID() provides better uniqueness than timestamp + random
        // especially under fullyParallel where workers can hit the same millisecond.
        const unique = (prefix = 'qa-reg') =>
            track(`${prefix}-${crypto.randomUUID()}@example.com`);

        await use({
            unique,

            current: () => {
                if (lastIssued === null) {
                    throw new Error('No test user has been issued yet - call testUsers.unique() first.');
                }
                return lastIssued;
            },

            track,

            resolve: (value: string) => {
                if (value === 'uniqueEmail') {
                    return unique();
                }
                if (value === 'existingEmail') {
                    // Shared across the suite - deliberately not tracked, so teardown
                    // never removes the account other scenarios depend on.
                    lastIssued = GLOBAL_DATA.test_user_username.toLowerCase();
                    return GLOBAL_DATA.test_user_username;
                }
                return value ? track(value) : value;
            }
        });

        // Teardown runs even when the scenario failed, so a broken assertion
        // mid-registration does not leave the account behind.
        for (const username of created) {
            await deleteUserByUsername(username);
        }
    },

    bankingCustomer: async ({ request, testUsers }, use) => {
        // Held on an object rather than in a plain `let`: TypeScript narrows a local
        // to `null` at its declaration and keeps that narrowing even though the
        // callbacks below reassign it, which makes the teardown check unreachable.
        const state: {seeded: SeededCustomer | null, customerId: number | null} = { seeded: null, customerId: null };

        await use({
            create: async () => {
                const credentials = RegistrationRequest.builder()
                    .withUsername(testUsers.unique('qa-goals'))
                    .withPassword(GLOBAL_DATA.test_user_password)
                    .build();
                const credentialsData = credentials.toJSON();
                const api = new AccountAPI(request);
                const { accessToken, customerId } = await api.registerAndCreateCustomer(credentialsData);

                // Recorded before the accounts are opened: if opening one fails, the
                // customer that already exists still has to be torn down.
                state.customerId = customerId;

                state.seeded = {
                    ...credentialsData,
                    accessToken,
                    customerId,
                    fundedAccountId: await api.openCheckingAccount(accessToken, customerId, '50000.00'),
                    emptyAccountId: await api.openCheckingAccount(accessToken, customerId, '0.00')
                };
                return state.seeded;
            },

            current: () => {
                if (state.seeded === null) {
                    throw new Error('No banking customer has been seeded - call bankingCustomer.create() first.');
                }
                return state.seeded;
            }
        });

        // The accounts have to go before the testUsers teardown runs, or the
        // customer row is still referenced and deleteUserByUsername leaves it
        // behind. Fixture teardown is last-in-first-out and this fixture depends
        // on testUsers, so this block is guaranteed to run first.
        if (state.customerId !== null) {
            await deleteCustomerCascade(state.customerId);
        }
    }
});

export const { Given, When, Then } = createBdd(test);
