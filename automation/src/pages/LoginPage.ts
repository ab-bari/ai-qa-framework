import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object for the SauceDemo login page (https://www.saucedemo.com/).
 */
export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.loginButton = page.getByRole('button', { name: 'Login' });
    // On failure the app renders an <h3> "Epic sadface: ..." (heading role).
    this.errorMessage = page.getByRole('heading', { name: /^Epic sadface:/ });
  }

  async goto(): Promise<void> {
    await this.page.goto('https://www.saucedemo.com/');
    await this.waitForReady();
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
