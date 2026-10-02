import { expect } from '@playwright/test';
import { Given, When, Then } from '../../../../support/fixtures/testFixtures';
import { GoalsAPI } from '../../../../src/api/goals';

// Local date, not toISOString(): that gives the UTC date, which runs a day ahead
// in the evening west of UTC and turns "-1 days" into today in the browser's eyes.
function dateInDays(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

Given('a customer with a funded account and an empty account exists', async ({ bankingCustomer }) => {
    await bankingCustomer.create();
});

Given('the user is logged in to the application', async ({ page, pages, bankingCustomer }) => {
    const { username, password } = bankingCustomer.current();

    await pages.loginPage.goto();
    await pages.loginPage.enterEmail(username);
    await pages.loginPage.enterPassword(password);
    await pages.loginPage.clickSignIn();

    await expect(page).toHaveURL(/.*customer/);
});

Given('the user is on the savings goals section', async ({ pages, bankingCustomer }) => {
    await pages.savingsGoalsPage.gotoCustomer(bankingCustomer.current().customerId);
    await expect(pages.savingsGoalsPage.goalSection).toBeVisible();
});

Given('the account the goal is created on is the {word} account', async ({ page, pages, request, bankingCustomer }, which: string) => {
    const seeded = bankingCustomer.current();
    const otherAccountId = which === 'funded' ? seeded.emptyAccountId : seeded.fundedAccountId;

    await new GoalsAPI(request, seeded.accessToken).createGoal(otherAccountId, {
        goalName: 'Parked Goal',
        targetAmount: 1,
        targetDate: dateInDays(365)
    });

    await page.reload();
    await expect(pages.savingsGoalsPage.addGoalButtons).toHaveCount(1);
});

Given('a savings goal {string} of {string} exists on the empty account', async ({ page, pages, request, bankingCustomer }, goalName: string, targetAmount: string) => {
    const seeded = bankingCustomer.current();

    await new GoalsAPI(request, seeded.accessToken).createGoal(seeded.emptyAccountId, {
        goalName,
        targetAmount: Number(targetAmount),
        targetDate: dateInDays(180)
    });

    await page.reload();
    await expect(pages.savingsGoalsPage.goalCardNamed(goalName)).toBeVisible();
});

When('the user views the savings goals section', async ({ pages, bankingCustomer }) => {
    await pages.savingsGoalsPage.gotoCustomer(bankingCustomer.current().customerId);
    await expect(pages.savingsGoalsPage.goalSection).toBeVisible();
});

When('the user starts a savings goal on an account without one', async ({ pages }) => {
    await pages.savingsGoalsPage.startGoalOnAccountWithoutOne();
    await expect(pages.savingsGoalsPage.creationFlow).toBeVisible();
});

When('User enters goal name {string} target amount {string} and target date in {string} days',
    async ({ pages }, goalName: string, targetAmount: string, days: string) => {
        await pages.savingsGoalsPage.enterGoalDetails({
            goalName,
            targetAmount,
            targetDate: dateInDays(Number(days))
        });
    });

When('User submits the goal from the review screen', async ({ pages }) => {
    await expect(pages.savingsGoalsPage.nextButton).toHaveText('Create Goal');
    await pages.savingsGoalsPage.submitGoal();
});

When('the user edits the savings goal {string}', async ({ pages }, goalName: string) => {
    await pages.savingsGoalsPage.goalCardNamed(goalName).getByRole('button', { name: 'Edit' }).click();
    await expect(pages.savingsGoalsPage.editForm).toBeVisible();
});

When('User changes the target amount to {string}', async ({ pages }, targetAmount: string) => {
    await pages.savingsGoalsPage.changeTargetAmount(targetAmount);
});

When('User saves the goal changes', async ({ pages }) => {
    await pages.savingsGoalsPage.saveButton.click();
});

When('the user deletes the savings goal {string}', async ({ pages }, goalName: string) => {
    await pages.savingsGoalsPage.goalCardNamed(goalName).getByRole('button', { name: 'Delete' }).click();
});

When('User confirms the deletion', async ({ page }) => {
    // The card swaps its footer for an inline confirmation rather than opening a
    // modal, so the confirming Delete is the one inside .delete-confirmation-inline.
    await page.locator('.delete-confirmation-inline').getByRole('button', { name: 'Delete' }).click();
});

Then('the savings goal {string} should be created', async ({ pages }, goalName: string) => {
    await expect(pages.savingsGoalsPage.successBannerWith('Savings goal created successfully.')).toBeVisible();
    await expect(pages.savingsGoalsPage.goalCardNamed(goalName)).toBeVisible();
});

Then('the savings goal should be updated', async ({ pages }) => {
    await expect(pages.savingsGoalsPage.successBannerWith('Savings goal updated successfully.')).toBeVisible();
});

Then('the savings goal should be deleted', async ({ pages }) => {
    await expect(pages.savingsGoalsPage.successBannerWith('Savings goal deleted.')).toBeVisible();
});

Then('the goal card for {string} should show a target of {string}', async ({ pages }, goalName: string, target: string) => {
    await expect(pages.savingsGoalsPage.goalCardNamed(goalName)).toContainText(target);
});

Then('the goal card for {string} should show the status {string}', async ({ pages }, goalName: string, status: string) => {
    await expect(pages.savingsGoalsPage.goalCardNamed(goalName).locator('.status-badge')).toHaveText(status);
});

Then('the goal card for {string} should show progress of {string}', async ({ pages }, goalName: string, progress: string) => {
    // Scoped to the percentage: the whole card also shows the target amount, so
    // "100" would match a $100.00 target regardless of progress.
    await expect(pages.savingsGoalsPage.goalCardNamed(goalName).locator('.progress-percentage'))
        .toHaveText(`${progress}%`);
});

Then('no goal card for {string} should be displayed', async ({ pages }, goalName: string) => {
    await expect(pages.savingsGoalsPage.goalCardNamed(goalName)).toHaveCount(0);
});

Then('the review screen should show goal {string} and target amount {string}', async ({ pages }, goalName: string, targetAmount: string) => {
    await expect(pages.savingsGoalsPage.nextButton).toHaveText('Create Goal');
    await expect(pages.savingsGoalsPage.reviewValues).toContainText([goalName, targetAmount]);
});

Then('the empty account should offer no way to add a second goal', async ({ pages, request, bankingCustomer }) => {
    const seeded = bankingCustomer.current();
    const goals = await new GoalsAPI(request, seeded.accessToken).listGoals(seeded.customerId);
    const goal = goals.find((g) => g.account_id === seeded.emptyAccountId);
    expect(goal, 'expected the seeded goal on the empty account').toBeDefined();

    // The empty account shows its goal card, not an "Add a goal" card; the one
    // remaining Add button belongs to the funded account.
    const lastFour = goal!.account_number.slice(-4);
    await expect(pages.savingsGoalsPage.goalCardFor(goal!.account_number)).toHaveCount(1);
    await expect(pages.savingsGoalsPage.emptyGoalCards.filter({ hasText: lastFour })).toHaveCount(0);
    await expect(pages.savingsGoalsPage.addGoalButtons).toHaveCount(1);
});

Then('User should see the goal error {string}', async ({ pages }, error: string) => {
    await expect(pages.savingsGoalsPage.stepError.first()).toHaveText(error);
});
