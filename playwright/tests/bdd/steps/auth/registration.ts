import { expect } from '@playwright/test';
import { Given, When, Then } from '../../../../support/fixtures/testFixtures';
import { GLOBAL_DATA } from '../../../../global_data/globalData';
import { AccountAPI } from '../../../../src/api/account';
import { RegistrationRequest } from '../../../../src/api/models';

// await pages.screenshot({ path: 'playwright-report/screenshots/register-business.png' });

Given('registration account type step is displayed', async ({ page, pages }) => {
    await expect(page).toHaveURL(/.*register/);
    await expect(pages.registrationPage.accountType).toBeVisible();
    await expect(pages.registrationPage.stepIndicator).toHaveText('1. Account Type');
});

Given('the default testing account exists', async ({ request }) => {
    const accountAPI = new AccountAPI(request);

    // 201 on the first run, 409 USER_ALREADY_EXISTS afterwards. Both mean the
    // account is there, which is all this step promises - so neither is an error.
    const response = await accountAPI.registerAccountAPI(
        RegistrationRequest.builder()
            .withUsername(GLOBAL_DATA.test_user_username)
            .withPassword(GLOBAL_DATA.test_user_password)
            .build()
    );

    expect(
        [201, 409],
        `Could not guarantee the default testing account exists: ${response.status()} ${await response.text()}`
    ).toContain(response.status());
});

When('the user selects {string} account and clicks continue', async ({ pages }, accountType: string) => {
    await pages.registrationPage.selectType(accountType);

    if (accountType === 'personal') {
        await expect(pages.registrationPage.dob).toBeVisible();
        await expect(pages.registrationPage.govBusinessId).toBeHidden();
    } else if (accountType === 'business') {
        await expect(pages.registrationPage.govBusinessId).toBeVisible();
        await expect(pages.registrationPage.dob).toBeHidden();
    }
});

When('User enters registration email {string} password {string} name {string} address {string} and date of birth {string}',
    async ({ pages, testUsers }, email: string, password: string, name: string, address: string, dob: string) => {
        await pages.registrationPage.enterPersonalDetails({
            email: testUsers.resolve(email),
            password,
            name,
            address,
            dob
        });
    });

When('User enters registration email {string} password {string} name {string} address {string} and business number {string}',
    async ({ pages, testUsers }, email: string, password: string, name: string, address: string, businessNumber: string) => {
        await pages.registrationPage.enterBusinessDetails({
            email: testUsers.resolve(email),
            password,
            name,
            address,
            businessNumber
        });
    });

When('User submits the registration form', async ({ pages }) => {
    await pages.registrationPage.clickCreateAccount();
});

Then('User should successfully complete registration', async ({ page, pages }) => {
    // RegisterPage.jsx navigates to the new customer's account list on success,
    // handing it a flash message that AccountListPage renders as a success banner.
    await expect(page).toHaveURL(/\/customer\/\d+\/accounts/);
    // Filtered rather than matched outright: AccountListPage renders its
    // "Loading accounts..." notice with the same .banner.success class, so a bare
    // locator hits two elements and fails strict mode whenever the list is slow.
    await expect(page.locator('.banner.success').filter({ hasText: 'Account created successfully' }))
        .toBeVisible();
    await expect(pages.registrationPage.errorMessage).toHaveCount(0);
});

Then('User should see a duplicate email registration error', async ({ page, pages }) => {
    await expect(pages.registrationPage.errorMessage)
        .toContainText('A user with this email is already registered.');
    await expect(page).toHaveURL(/.*register/);
});

Then('User should see the registration error {string}', async ({ page, pages }, error: string) => {
    await expect(pages.registrationPage.errorMessage).toHaveText(error);
    await expect(page).toHaveURL(/.*register/);
});

Then('the registration form should remain open', async ({ page, pages }) => {
    // Native constraint validation - pattern="[0-9]{9}" on #register-gbn, type="email"
    // on #register-username - blocks the submit before handleSubmit runs, so the app
    // never sets an error of its own. The evidence is that nothing navigated and the
    // details step is still mounted.
    await expect(page).toHaveURL(/.*register/);
    await expect(pages.registrationPage.createAccountButton).toBeVisible();
    await expect(pages.registrationPage.errorMessage).toHaveCount(0);
});
