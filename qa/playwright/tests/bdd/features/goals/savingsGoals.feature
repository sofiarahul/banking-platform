
Feature: As a customer, I want to set a savings goal on an account so that I can track how close I am to what I am saving for.

    Background:
        Given a customer with a funded account and an empty account exists
        And the user is logged in to the application
        And the user is on the savings goals section

    @CreatesData
    Scenario: User should be able to create a savings goal with valid details
        When the user starts a savings goal on an account without one
        And User enters goal name "Emergency Fund" target amount "5000.00" and target date in "90" days
        And User submits the goal from the review screen
        Then the savings goal "Emergency Fund" should be created
        And the goal card for "Emergency Fund" should show a target of "$5000.00"

    @CreatesData
    Scenario: The review screen shows the details entered before the goal is created
        When the user starts a savings goal on an account without one
        And User enters goal name "Travel" target amount "1200.50" and target date in "30" days
        Then the review screen should show goal "Travel" and target amount "$1200.50"

    @CreatesData
    Scenario: A goal already covered by the account balance is shown as achieved
        Given the account the goal is created on is the funded account
        When the user starts a savings goal on an account without one
        And User enters goal name "Tuition" target amount "100.00" and target date in "365" days
        And User submits the goal from the review screen
        Then the goal card for "Tuition" should show the status "Achieved"
        And the goal card for "Tuition" should show progress of "100"

    @CreatesData
    Scenario: A goal on an account with no money is shown as not started
        Given the account the goal is created on is the empty account
        When the user starts a savings goal on an account without one
        And User enters goal name "Car" target amount "20000.00" and target date in "365" days
        And User submits the goal from the review screen
        Then the goal card for "Car" should show the status "Not Started"

    @CreatesData
    Scenario: An account can only hold one active savings goal
        Given a savings goal "Home" of "15000.00" exists on the empty account
        When the user views the savings goals section
        Then the empty account should offer no way to add a second goal

    @CreatesData
    Scenario: User should be able to edit an existing savings goal
        Given a savings goal "Retirement" of "9000.00" exists on the empty account
        When the user edits the savings goal "Retirement"
        And User changes the target amount to "12000.00"
        And User saves the goal changes
        Then the savings goal should be updated
        And the goal card for "Retirement" should show a target of "$12000.00"

    @CreatesData
    Scenario: User should be able to delete a savings goal
        Given a savings goal "Other" of "800.00" exists on the empty account
        When the user deletes the savings goal "Other"
        And User confirms the deletion
        Then the savings goal should be deleted
        And no goal card for "Other" should be displayed

    Scenario Outline: User should not be able to create a savings goal with invalid details
        When the user starts a savings goal on an account without one
        And User enters goal name "<goalName>" target amount "<targetAmount>" and target date in "<days>" days
        Then User should see the goal error "<error>"

        Examples:
            | goalName        | targetAmount | days | error                                       |
            |                 | 5000.00      | 90   | Please enter a goal name                    |
            | Emergency Fund  |              | 90   | Please enter a target amount                |
            | Emergency Fund  | 0            | 90   | Target amount must be greater than $0       |
            | Emergency Fund  | -100         | 90   | Target amount must be greater than $0       |
            | Emergency Fund  | 100.123      | 90   | Target amount can have up to 2 decimal places |
            | Emergency Fund  | 5000.00      | -1   | Target date must be today or in the future  |
