import { Given } from '../../../support/fixtures/testFixtures';

Given('the user is on the {string} page', async ({ pages }, arg: string) => {
    if (arg == 'login')
        await pages.loginPage.goto();
    else if (arg == 'registration')
        await pages.registrationPage.goto();
    else
        // Fail loudly: a typo in a feature file would otherwise leave the test on about:blank.
        throw new Error(`No page object mapped for '${arg}' - add it to commonSteps.ts.`);
});
