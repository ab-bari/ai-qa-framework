import { test, expect } from '../../src/fixtures/base';
import { LoginPage } from '../../src/pages/LoginPage';
import { InventoryPage } from '../../src/pages/InventoryPage';
import users from '../data/users.json';

// Scenario 1.1 from specs/saucedemo-login.md — standard_user successful login.
test.describe('SauceDemo Login', () => {
  test('standard_user can log in successfully @smoke @critical', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const inventoryPage = new InventoryPage(page);

    await test.step('Navigate to the login page', async () => {
      await loginPage.goto();
      await expect(page).toHaveURL('https://www.saucedemo.com/');
      await expect(loginPage.usernameInput).toBeVisible();
      await expect(loginPage.passwordInput).toBeVisible();
    });

    await test.step('Submit standard_user credentials', async () => {
      await loginPage.login(users.standard.username, users.standard.password);
    });

    await test.step('Land on the inventory page', async () => {
      await expect(page).toHaveURL(InventoryPage.URL);
      await expect(inventoryPage.appLogo).toBeVisible();
      await expect(inventoryPage.addToCartButtons.first()).toBeVisible();
      await expect(inventoryPage.addToCartButtons).not.toHaveCount(0);
    });

    await test.step('No login error is shown', async () => {
      await expect(loginPage.errorMessage).toBeHidden();
    });
  });
});
