import BasePage from '../BasePage';
import { Locator, type Page } from '@playwright/test';

export class RegistrationPage extends BasePage {
    readonly accountType: Locator;
    readonly continueButton: Locator;
    readonly backButton: Locator;
    readonly email: Locator;
    readonly password: Locator;
    readonly name: Locator;
    readonly address: Locator;
    readonly dob: Locator;
    readonly createAccountButton: Locator;
    readonly govBusinessId: Locator;
    readonly errorMessage: Locator;
    readonly stepIndicator: Locator;

    async selectType(type : String){
        if (type == 'business'){
            await this.accountType.selectOption('Business');
        }
        await this.continueButton.click();
    }

    async enterPersonalDetails(details: {email: string, password: string, name: string, address: string, dob: string}) {
        await this.email.fill(details.email);
        await this.password.fill(details.password);
        await this.name.fill(details.name);
        await this.address.fill(details.address);
        await this.dob.fill(details.dob);
    }

    async enterBusinessDetails(details: {email: string, password: string, name: string, address: string, businessNumber: string}) {
        await this.email.fill(details.email);
        await this.password.fill(details.password);
        await this.name.fill(details.name);
        await this.address.fill(details.address);
        await this.govBusinessId.fill(details.businessNumber);
    }

    async clickCreateAccount() {
        await this.createAccountButton.click();
    }

    constructor(page: Page){
        super(page, '/register');

        // Ids come straight from src/pages/RegisterPage.jsx. The form is two steps:
        // the account-type select is the whole of step 1, and every field below it
        // is only mounted once Continue has been clicked.
        this.accountType = page.locator('#register-type');
        this.continueButton = page.getByRole('button', { name: 'Continue' });
        this.backButton = page.getByRole('button', { name: 'Back', exact: true });
        this.email = page.locator('#register-username');
        this.password = page.locator('#register-password');
        this.name = page.locator('#register-name');
        this.address = page.locator('#register-address');
        this.dob = page.locator('#register-dob');
        this.createAccountButton = page.getByRole('button', { name: 'Create Account' });
        this.govBusinessId = page.locator('#register-gbn');
        this.errorMessage = page.locator('.banner.error');
        this.stepIndicator = page.locator('.register-step');

    }
}
