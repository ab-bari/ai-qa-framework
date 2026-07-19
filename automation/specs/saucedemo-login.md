# SauceDemo Login

## Application Overview

Login flow for https://www.saucedemo.com. The login page exposes Username/Password textboxes (accessible name derived from placeholder) and a Login submit button. The page is React-driven; on submit it either navigates to /inventory.html (a stable inventory list page with 6 items) or shows an "Epic sadface: ..." error inside `.error-message-container > h3[data-test="error"]`. The seed test in this repo already establishes `getByRole('textbox', { name: 'Username' })` as the preferred locator. This plan covers the standard_user happy path, locked_out_user error, the two empty-field errors, and invalid credentials.

## Test Scenarios

### 1. SauceDemo Login

**Seed:** `tests/seed.spec.ts`

#### 1.1. Login - standard_user successful login

**File:** `tests/saucedemo/login.spec.ts`

**Steps:**
  1. Navigate to https://www.saucedemo.com/
    - expect: The page URL is https://www.saucedemo.com/ and the Login form is visible.
  2. Fill Username with 'standard_user' and Password with 'secret_sauce' (using getByRole('textbox', { name: 'Username' | 'Password' }))
    - expect: Username and Password fields are filled; Login button is enabled.
  3. Click the Login button (getByRole('button', { name: 'Login' }))
    - expect: URL becomes https://www.saucedemo.com/inventory.html, the inventory list (.inventory_list[data-test='inventory-list']) is visible with at least one inventory_item, and the 'Swag Labs' header (.app_logo) is visible.
  4. Assert the error message container is not visible
    - expect: Error container is not displayed (no .error-message-container.error visible).

#### 1.2. Login - locked_out_user shows locked out error

**File:** `tests/saucedemo/login.spec.ts`

**Steps:**
  1. Navigate to https://www.saucedemo.com/
    - expect: Login form is visible at https://www.saucedemo.com/.
  2. Fill Username with 'locked_out_user' and Password with 'secret_sauce'
    - expect: Both fields are filled.
  3. Click the Login button
    - expect: The error heading is visible with exact text 'Epic sadface: Sorry, this user has been locked out.'; URL stays on https://www.saucedemo.com/.
  4. Assert via locator with accessible name matching the full error string, or via getByRole('heading', { name: 'Epic sadface: Sorry, this user has been locked out.' })
    - expect: Selector resolves: .error-message-container h3[data-test='error'] is visible.

#### 1.3. Login - empty username shows 'Username is required'

**File:** `tests/saucedemo/login.spec.ts`

**Steps:**
  1. Navigate to https://www.saucedemo.com/
    - expect: Login form is visible at https://www.saucedemo.com/.
  2. Leave Username empty; fill Password with 'secret_sauce'
    - expect: Password field is filled; Username is empty.
  3. Click the Login button
    - expect: Error heading visible with text 'Epic sadface: Username is required'; URL stays on https://www.saucedemo.com/.
  4. Assert the error message container is visible and contains the required text
    - expect: Element resolves via .error-message-container h3[data-test='error'] or getByRole('heading', { name: 'Epic sadface: Username is required' }).

#### 1.4. Login - empty password shows 'Password is required'

**File:** `tests/saucedemo/login.spec.ts`

**Steps:**
  1. Navigate to https://www.saucedemo.com/
    - expect: Login form is visible at https://www.saucedemo.com/.
  2. Fill Username with 'standard_user'; leave Password empty
    - expect: Username field is filled; Password is empty.
  3. Click the Login button
    - expect: Error heading visible with text 'Epic sadface: Password is required'; URL stays on https://www.saucedemo.com/.
  4. Assert the error message container is visible and contains the required text
    - expect: Element resolves via .error-message-container h3[data-test='error'] or getByRole('heading', { name: 'Epic sadface: Password is required' }).

#### 1.5. Login - invalid credentials shows 'do not match' error

**File:** `tests/saucedemo/login.spec.ts`

**Steps:**
  1. Navigate to https://www.saucedemo.com/
    - expect: Login form is visible at https://www.saucedemo.com/.
  2. Fill Username with 'invalid_user' and Password with 'wrong_password' (parameterize for one extra variant: valid username + wrong password, e.g. standard_user + not_the_password)
    - expect: Both fields are filled with values that do not correspond to a real user.
  3. Click the Login button
    - expect: Error heading visible with text 'Epic sadface: Username and password do not match any user in this service'; URL stays on https://www.saucedemo.com/.
  4. Assert the error message container is visible and contains the required text
    - expect: Element resolves via .error-message-container h3[data-test='error'] or getByRole('heading', { name: 'Epic sadface: Username and password do not match any user in this service' }).
