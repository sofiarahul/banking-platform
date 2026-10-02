import {APIRequestContext} from '@playwright/test';
import {z} from 'zod';

const authResponseSchema = z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    tokenType: z.string(),
    expiresIn: z.number()
});

const customerResponseSchema = z.object({
    customerId: z.number()
});

const accountResponseSchema = z.object({
    accountId: z.number()
});

export type SeededAccounts = {
    /** Bearer token for the seeded customer, so steps can arrange more data over the API. */
    accessToken: string;
    customerId: number;
    /** Opened with a balance, so a goal under that balance derives as ACHIEVED. */
    fundedAccountId: number;
    /** Opened at zero, so a goal on it derives as NOT_STARTED. */
    emptyAccountId: number;
};

/**
 * API-level setup for tests that need a signed-up customer with accounts before
 * they touch the UI. Driving registration through the browser for every goals
 * scenario would cost a minute a run and test the registration form all over
 * again, which login.feature and registration.feature already cover.
 *
 * All paths are relative: playwright.config.ts sets baseURL to the Vite dev
 * server, which proxies through to the backend on 8080 (vite.config.js).
 *
 * Note the two prefixes. AuthController and CustomerController are mapped under
 * /api, but AccountController declares a bare @RequestMapping, so its routes are
 * /customers/{id}/accounts and /accounts/{id} with no prefix at all. Posting an
 * account to /api/customers/{id}/accounts does not 404 - it reaches
 * CustomerController and fails as a 500, which is a slow way to find this out.
 */
export class AccountAPI {
    private request: APIRequestContext;

    constructor(request: APIRequestContext) {
        this.request = request;
    }

    async registerAccountAPI(data: {username: string, password: string}) {
        return this.request.post('/api/auth/register', { data });
    }

    async loginAccountAPI(data: {username: string, password: string}) {
        return this.request.post('/api/auth/login', { data });
    }

    /** Signs in and returns the bearer token every other call below needs. */
    async getAccessToken(data: {username: string, password: string}): Promise<string> {
        const response = await this.loginAccountAPI(data);
        if (!response.ok()) {
            throw new Error(`Login failed for ${data.username}: ${response.status()} ${await response.text()}`);
        }
        return authResponseSchema.parse(await response.json()).accessToken;
    }

    async createCustomerAPI(accessToken: string, data: {name: string, address: string, dateOfBirth: string}) {
        return this.request.post('/api/customers', {
            headers: { Authorization: `Bearer ${accessToken}` },
            data: { ...data, type: 'PERSON', kycVerified: true }
        });
    }

    async createAccountAPI(accessToken: string, customerId: number, data: {accountType: string, balance: string}) {
        return this.request.post(`/customers/${customerId}/accounts`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            data
        });
    }

    async getAccountAPI(accessToken: string, accountId: number) {
        return this.request.get(`/accounts/${accountId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
    }

    /**
     * Registers a login, signs in, and creates its customer profile.
     *
     * Split from account opening so the caller can record the customer id the
     * moment it exists. Seeding used to do both in one call and only hand back a
     * result at the very end, which meant a failure while opening the second
     * account left a customer and one account behind with nothing holding their
     * ids to clean up.
     */
    async registerAndCreateCustomer(credentials: {username: string, password: string}): Promise<{accessToken: string, customerId: number}> {
        const registration = await this.registerAccountAPI(credentials);
        if (![201, 409].includes(registration.status())) {
            throw new Error(`Could not register ${credentials.username}: ${registration.status()} ${await registration.text()}`);
        }

        const accessToken = await this.getAccessToken(credentials);

        const customer = await this.createCustomerAPI(accessToken, {
            name: 'Goals Test Customer',
            address: '100 Auto Main Street',
            dateOfBirth: '1990-01-01'
        });
        if (!customer.ok()) {
            throw new Error(`Could not create a customer: ${customer.status()} ${await customer.text()}`);
        }

        return { accessToken, customerId: customerResponseSchema.parse(await customer.json()).customerId };
    }

    /**
     * Opens one chequing account.
     *
     * CHECKING is the only type that takes no interestRate, which keeps the
     * arrangement free of the TFSA/RRSP eligibility rules in AccountService.
     */
    async openCheckingAccount(accessToken: string, customerId: number, balance: string): Promise<number> {
        const response = await this.createAccountAPI(accessToken, customerId, {
            accountType: 'CHECKING',
            balance
        });
        if (!response.ok()) {
            throw new Error(`Could not open an account for customer ${customerId}: ${response.status()} ${await response.text()}`);
        }
        return accountResponseSchema.parse(await response.json()).accountId;
    }
}

export default AccountAPI;
