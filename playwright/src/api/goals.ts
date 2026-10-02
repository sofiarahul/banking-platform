import {APIRequestContext} from '@playwright/test';
import {z} from 'zod';

const goalSchema = z.object({
    goal_id: z.number(),
    account_id: z.number(),
    account_number: z.string(),
    goal_name: z.string(),
    target_amount: z.number(),
    target_date: z.string(),
    status: z.string(),
    progress_percentage: z.number()
});

export type SavingsGoal = z.infer<typeof goalSchema>;

/**
 * Savings goal setup over the API, for scenarios whose subject is editing or
 * deleting a goal rather than creating one. Walking the four-step creation flow
 * to arrange those would re-test creation on the way to every other assertion.
 *
 * Routes mirror src/api/goals.js in the frontend; note the snake_case response
 * fields, which SavingsGoalResponse sets explicitly with @JsonProperty.
 */
export class GoalsAPI {
    private request: APIRequestContext;
    private accessToken: string;

    constructor(request: APIRequestContext, accessToken: string) {
        this.request = request;
        this.accessToken = accessToken;
    }

    private get authHeaders() {
        return { Authorization: `Bearer ${this.accessToken}` };
    }

    async createGoalAPI(accountId: number, data: {goalName: string, targetAmount: number, targetDate: string}) {
        return this.request.post(`/api/goals/accounts/${accountId}`, {
            headers: this.authHeaders,
            data
        });
    }

    async listGoalsAPI(customerId: number) {
        return this.request.get(`/api/goals/customers/${customerId}`, {
            headers: this.authHeaders
        });
    }

    async deleteGoalAPI(accountId: number, goalId: number) {
        return this.request.delete(`/api/goals/accounts/${accountId}/goals/${goalId}`, {
            headers: this.authHeaders
        });
    }

    /** Creates a goal and returns it, failing loudly rather than leaving a scenario to guess. */
    async createGoal(accountId: number, data: {goalName: string, targetAmount: number, targetDate: string}): Promise<SavingsGoal> {
        const response = await this.createGoalAPI(accountId, data);
        if (!response.ok()) {
            throw new Error(`Could not create goal "${data.goalName}" on account ${accountId}: ${response.status()} ${await response.text()}`);
        }
        return goalSchema.parse(await response.json());
    }

    async listGoals(customerId: number): Promise<SavingsGoal[]> {
        const response = await this.listGoalsAPI(customerId);
        if (!response.ok()) {
            throw new Error(`Could not list goals for customer ${customerId}: ${response.status()} ${await response.text()}`);
        }
        return z.array(goalSchema).parse(await response.json());
    }
}

export default GoalsAPI;
