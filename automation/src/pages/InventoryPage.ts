import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object for the SauceDemo inventory page (https://www.saucedemo.com/inventory.html).
 */
export class InventoryPage extends BasePage {
  static readonly URL = 'https://www.saucedemo.com/inventory.html';

  readonly appLogo: Locator;
  readonly addToCartButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.appLogo = page.getByText('Swag Labs');
    // Each inventory item exposes an "Add to cart" button; used to assert the list rendered.
    this.addToCartButtons = page.getByRole('button', { name: 'Add to cart' });
  }

  async goto(): Promise<void> {
    await this.page.goto(InventoryPage.URL);
    await this.waitForReady();
  }
}
