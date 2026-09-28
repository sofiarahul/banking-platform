
import BasePage from '../BasePage';
import { Locator, type Page } from '@playwright/test';

export class LoginPage extends BasePage {
    readonly emailField: Locator;
    readonly passwordField: Locator;
    readonly signinButton: Locator;
    readonly credentialErrorMessage: Locator;

    async enterEmail(email: string) {
        await this.emailField.fill(email);
    }

    async enterPassword(password: string) {
        await this.passwordField.fill(password);
    }

    async clickSignIn() {
        await this.signinButton.click();
    }

    constructor(page: Page) {
        super(page, '/login');

        this.emailField = page.locator('#login-username');
        this.passwordField = page.locator('#login-password');
        this.signinButton = page.getByRole('button', { name: 'Sign In' });
        this.credentialErrorMessage = page.locator('xpath=//div[contains(@class, "banner error")]');
    }
}
