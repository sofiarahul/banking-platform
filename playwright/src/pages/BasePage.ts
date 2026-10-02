import { type Page } from '@playwright/test';

class BasePage {
    readonly page: Page;
    // Relative on purpose: page.goto resolves it against baseURL in
    // playwright.config.ts, so APP_BASE_URL moves the UI and the API together.
    readonly URL: string;

    async goto() {
        await this.page.goto(this.URL);
    }

    constructor(page: Page, url: string) {
        this.page = page;
        this.URL = url;
    }

}

export default BasePage;
