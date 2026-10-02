Feature: As a registered user, I want to log in to the application so that I can access the application.

  @smoke @regression @critical
  Scenario: User should be able to log in with valid credentials
    Given the default testing account exists
    And the user is on the 'login' page
    When the user enters valid credentials
    And clicks the login button
    Then the user should be redirected to the dashboard

  @regression @negative
  Scenario Outline: User should not be able to log in with invalid credentials
    Given the user is on the login page
    When the user enters the username "<username>" and password "<password>"
    And clicks the login button
    Then an error message should be displayed indicating invalid credentials

    Examples:
      | username            | password  |
      | invalid@example.com | Test@1234 |
      | test@example.com    | wrongpass |

