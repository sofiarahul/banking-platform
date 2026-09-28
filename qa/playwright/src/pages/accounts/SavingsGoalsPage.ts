import BasePage from '../BasePage';
import { Locator, type Page } from '@playwright/test';

// Mirrors GOAL_PRESETS in src/components/GoalCreationFlow.jsx. Step 1 swaps the
// free-text box out as soon as the name matches a preset, so which control a name
// goes into depends on whether it is in this list.
const GOAL_PRESETS = [
    'Emergency Fund',
    'Travel',
    'Tuition',
    'Home',
    'Car',
    'Retirement',
    'Other'
];

/**
 * Savings goals live in their own section of the customer's accounts page, not
 * on a route of their own: an account with no goal shows an "+ Add a goal" card,
 * and one with a goal shows a progress card carrying Edit and Delete.
 *
 * Creation opens a four-step flow (GoalCreationFlow.jsx) - name, amount, date,
 * then a review screen - none of whose inputs carry an id, hence the class-based
 * locators below.
 */
export class SavingsGoalsPage extends BasePage {
    readonly goalSection: Locator;
    readonly addGoalButtons: Locator;
    readonly goalCards: Locator;
    readonly emptyGoalCards: Locator;
    readonly actionMessage: Locator;
    readonly errorMessage: Locator;

    // Creation flow
    readonly creationFlow: Locator;
    readonly goalNameSelect: Locator;
    readonly goalNameInput: Locator;
    readonly targetAmountInput: Locator;
    readonly targetDateInput: Locator;
    readonly stepError: Locator;
    readonly nextButton: Locator;
    readonly backButton: Locator;
    readonly reviewValues: Locator;

    // Edit form
    readonly editForm: Locator;
    readonly editGoalName: Locator;
    readonly editTargetAmount: Locator;
    readonly editTargetDate: Locator;
    readonly saveButton: Locator;

    /** The goals section hangs off the customer's account list, so it needs the customer id. */
    async gotoCustomer(customerId: number) {
        await this.page.goto(`${this.URL}/${customerId}/accounts`);
    }

    /** The goal card for one account, matched on the last four of its account number. */
    goalCardFor(accountNumberSuffix: string): Locator {
        return this.goalCards.filter({ hasText: accountNumberSuffix });
    }

    /**
     * The success banner carrying a particular message.
     *
     * Filtered rather than matched outright: AccountListPage renders its
     * "Loading accounts..." notice with the same .banner.success class, so a bare
     * locator hits two elements and fails strict mode whenever the list is slow.
     */
    successBannerWith(text: string): Locator {
        return this.actionMessage.filter({ hasText: text });
    }

    goalCardNamed(goalName: string): Locator {
        return this.goalCards.filter({ hasText: goalName });
    }

    /** Opens the creation flow from the first account that has no goal yet. */
    async startGoalOnAccountWithoutOne() {
        await this.addGoalButtons.first().click();
    }

    /**
     * Walks steps 1 to 3 and stops at the first one that reports an error, which
     * is what lets a single step definition cover both the happy path and the
     * validation examples: the flow refuses to advance, so filling the next field
     * would fail on an element that was never mounted.
     *
     * Returns true when all three steps were accepted and the review screen is up.
     */
    async enterGoalDetails(details: {goalName: string, targetAmount: string, targetDate: string}): Promise<boolean> {
        if (GOAL_PRESETS.includes(details.goalName)) {
            await this.goalNameSelect.selectOption(details.goalName);
        } else {
            await this.goalNameInput.fill(details.goalName);
        }
        if (await this.advance()) return false;

        await this.targetAmountInput.fill(details.targetAmount);
        if (await this.advance()) return false;

        await this.targetDateInput.fill(details.targetDate);
        if (await this.advance()) return false;

        return true;
    }

    /** Clicks Next and reports whether the step was rejected. */
    private async advance(): Promise<boolean> {
        await this.nextButton.click();
        return this.stepError.first().isVisible();
    }

    /** On the review screen the primary button becomes "Create Goal". */
    async submitGoal() {
        await this.nextButton.click();
    }

    /**
     * Replaces the amount on the edit form.
     *
     * Cleared first on purpose: #targetAmount is a controlled number input, and
     * filling it in one go leaves the pre-filled value in front of the new one
     * (editing 9000 to 12000.00 submits 900012000.00).
     */
    async changeTargetAmount(targetAmount: string) {
        await this.editTargetAmount.fill('');
        await this.editTargetAmount.fill(targetAmount);
    }

    constructor(page: Page) {
        super(page, '/customer');

        this.goalSection = page.locator('section').filter({ hasText: 'Savings Goals' });
        this.addGoalButtons = page.getByRole('button', { name: '+ Add a goal' });
        this.goalCards = page.locator('.goal-card');
        this.emptyGoalCards = page.locator('.goal-empty-card');
        this.actionMessage = page.locator('.banner.success');
        this.errorMessage = page.locator('.banner.error');

        this.creationFlow = page.locator('.goal-creation-flow');
        this.goalNameSelect = this.creationFlow.locator('.step-select');
        this.goalNameInput = this.creationFlow.locator('.custom-input');
        this.targetAmountInput = this.creationFlow.locator('.amount-input');
        this.targetDateInput = this.creationFlow.locator('.date-input');
        this.stepError = this.creationFlow.locator('.error-message');
        this.nextButton = this.creationFlow.locator('.flow-footer .btn-primary');
        this.backButton = this.creationFlow.locator('.flow-footer .btn-secondary');
        this.reviewValues = this.creationFlow.locator('.review-value');

        this.editForm = page.locator('.goal-edit-form');
        this.editGoalName = this.editForm.locator('#goalName');
        this.editTargetAmount = this.editForm.locator('#targetAmount');
        this.editTargetDate = this.editForm.locator('#targetDate');
        this.saveButton = this.editForm.locator('.form-footer .btn-primary');

    }
}
