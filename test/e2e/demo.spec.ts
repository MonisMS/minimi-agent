import { expect, test } from '@playwright/test';

test('isolated demo chat smoke runs in the explicitly scoped demo server', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('textbox', { name: /message/i }).fill('Hello from the fictional offline walkthrough.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Answer: Hello from the fictional offline walkthrough.')).toBeVisible();
});
