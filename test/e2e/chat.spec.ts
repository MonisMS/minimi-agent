import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('request', (request) => {
    expect(new URL(request.url()).origin).toBe('http://127.0.0.1:4173');
  });
});

test('sends one saved question, renders the streamed answer, and shows offline readiness', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Offline mode')).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('Count this request once');
  const admissions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') admissions.push(request.url());
  });
  await page.getByRole('button', { name: 'Send' }).dblclick();
  await expect(page.getByText('Answer: Count this request once')).toBeVisible();
  await expect(page.getByText('Count this request once', { exact: true })).toHaveCount(1);
  expect(admissions).toHaveLength(1);
});

test('stops an active run and reloads the saved question without re-admitting it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('slow response to stop');
  let admissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') admissions += 1;
  });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped')).toBeVisible();
  await page.reload();
  await expect(page.getByText('slow response to stop', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this question' })).toBeVisible();
  expect(admissions).toBe(1);
});

test('switching conversations prevents an older stream from appearing in the new chat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('slow old conversation answer');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('new conversation only');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Answer: new conversation only')).toBeVisible();
  await page.waitForTimeout(1_700);
  await expect(page.getByText('slow old conversation answer', { exact: true })).toHaveCount(0);
});

test('an admission response for a chat that was left cannot replace the selected chat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.locator('.conversation-link:not(.selected)').click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();

  await page.route('**/api/runs', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.getByRole('textbox', { name: 'Message' }).fill('question from the chat I am leaving');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.conversation-link:not(.selected)').click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByText('question from the chat I am leaving', { exact: true })).toHaveCount(0);
});

test('keeps a rejected draft and makes no external requests when providers are unconfigured', async ({ page }) => {
  await page.route('**/api/runs', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'service_unavailable', userMessage: 'Live generation is not configured.', retryable: false, runId: null } }),
    });
  });
  await page.goto('/');
  await expect(page.getByText('Offline mode')).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('What would you like to know?')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('Keep this draft after rejection');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert')).toHaveText('Live generation is not configured.');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft after rejection');
});
