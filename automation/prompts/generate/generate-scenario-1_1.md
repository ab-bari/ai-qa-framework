Use scenario 1.1 from specs/saucedemo-login.md.

Context:
- App under test: https://www.saucedemo.com
- Credentials: load from tests/data/users.json (users.standard)
- LoginPage does not exist yet — create it at src/pages/LoginPage.ts
- InventoryPage does not exist yet — create it at src/pages/InventoryPage.ts

Rules:
- Import test from src/fixtures/base.ts, NOT from @playwright/test
- Both page objects must extend BasePage
- Locators: getByRole > getByLabel > getByTestId. No CSS, no XPath.
- No page.waitForTimeout
- Tag the test with @smoke @critical

Task:
1. Create the two page objects
2. Generate the test at tests/auth/standard-login.spec.ts
3. Run the test and confirm it passes
4. Report the result