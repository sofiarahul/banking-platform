import { expect } from '@playwright/test';
import { Given, When, Then } from '../../../../support/fixtures/testFixtures';
import { GLOBAL_DATA } from '../../../../global_data/globalData';

Given('the user is on the login page', async ({ page, pages }) => {
    await pages.loginPage.goto();

    expect(page.url()).toContain('/login');
});

When('the user enters valid credentials', async ({ pages }) => {
    await pages.loginPage.enterEmail(GLOBAL_DATA.test_user_username);
    await pages.loginPage.enterPassword(GLOBAL_DATA.test_user_password);
});

When('clicks the login button', async ({ pages }) => {
    await pages.loginPage.clickSignIn();
});

Then('the user should be redirected to the dashboard', async ({ page, $testInfo }) => {
    await expect(page).toHaveURL(/.*customer/);
    await $testInfo.attach('dashboard', { body: await page.screenshot(), contentType: 'image/png' });
});

When('the user enters the username {string} and password {string}', async ({ pages }, username: string, password: string) => {
    await pages.loginPage.enterEmail(username);
    await pages.loginPage.enterPassword(password);
});

Then('an error message should be displayed indicating invalid credentials', async ({ page, pages, $testInfo }) => {
    await pages.loginPage.credentialErrorMessage.waitFor({ state: 'visible' });
    await $testInfo.attach('error', { body: await page.screenshot(), contentType: 'image/png' });
});
