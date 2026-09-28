Feature: As a new user, I want to register an account so that I can access the platform.

    Background:
        Given the user is on the 'registration' page
        And registration account type step is displayed

    @CreatesData
    Scenario: User should be able to register a personal account with valid details
        When the user selects 'personal' account and clicks continue
        And User enters registration email "uniqueEmail" password "Testing123!" name "Test User" address "100 Auto Main Street" and date of birth "1990-01-01"
        And User submits the registration form
        Then User should successfully complete registration

    # Fails today, deliberately left asserting the intended behaviour. RegisterPage.jsx
    # omits dateOfBirth from the customer payload for a COMPANY, but CreateCustomerRequest
    # marks it @NotNull, so POST /api/customers returns "dateOfBirth is required" after the
    # login row has already been written - leaving an orphan user with no customer profile.
    # Drop @fail once the payload or the DTO is fixed; Playwright then reports this as
    # "expected to fail, but passed".
    @CreatesData @fail
    Scenario: User should be able to register a business account with valid details
        When the user selects 'business' account and clicks continue
        And User enters registration email "uniqueEmail" password "Testing123!" name "Test Company" address "100 Auto Main Street" and business number "123456789"
        And User submits the registration form
        Then User should successfully complete registration

    Scenario: User should not be able to register with an already registered email
        And the default testing account exists
        When the user selects 'personal' account and clicks continue
        And User enters registration email "existingEmail" password "Testing123!" name "Test User" address "100 Auto Main Street" and date of birth "1990-01-01"
        And User submits the registration form
        Then User should see a duplicate email registration error

    Scenario Outline: User should not be able to register a personal account when registration details are invalid
        When the user selects 'personal' account and clicks continue
        And User enters registration email "<email>" password "<password>" name "<name>" address "<address>" and date of birth "<dob>"
        And User submits the registration form
        Then User should see the registration error "<error>"

        Examples:
            | email        | password    | name      | address              | dob        | error                                              |
            | test@example | Testing123! | Test User | 100 Auto Main Street | 1990-01-01 | Enter a valid email address.                       |
            | uniqueEmail |             | Test User | 100 Auto Main Street | 1990-01-01 | Password is required.                              |
            | uniqueEmail | Testing123! |           | 100 Auto Main Street | 1990-01-01 | Name is required.                                  |
            | uniqueEmail | Testing123! | Test User |                      | 1990-01-01 | Address is required.                               |
            | uniqueEmail | Testing123! | Test User | 100 Auto Main Street |            | Date of birth is required.                         |
            | uniqueEmail | Testing123! | Test User | 100 Auto Main Street | 2015-01-01 | You must be 18 years or above to open an account.  |

    Scenario Outline: The browser blocks a malformed email before the form is submitted
        When the user selects 'personal' account and clicks continue
        And User enters registration email "<email>" password "Testing123!" name "Test User" address "100 Auto Main Street" and date of birth "1990-01-01"
        And User submits the registration form
        Then the registration form should remain open

        Examples: Rejected by type="email" on #register-username, so no app banner appears
            | email        |
            | not-an-email |
            | missing-at   |

    Scenario Outline: User should not be able to register a business account when business number is invalid
        When the user selects 'business' account and clicks continue
        And User enters registration email "uniqueEmail" password "Testing123!" name "Test Company" address "100 Auto Main Street" and business number "<businessNumber>"
        And User submits the registration form
        Then the registration form should remain open

        Examples: Rejected by the pattern="[0-9]{9}" constraint on #register-gbn
            | businessNumber |
            | 12345          |
            | abcdefghi      |
            | 12345678a      |
