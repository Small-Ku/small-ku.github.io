import { test, expect } from '@playwright/test';
import { siteConfig } from '../../src/site.config.ts';
const origin = `http://127.0.0.1:${process.env.MANGLING_BROWSER_PORT}`;
const baselineOrigin = `http://127.0.0.1:${process.env.MANGLING_BASELINE_PORT}`;

test('compiled class lists and nested CSS preserve pixels on all authored surfaces', async ({ browser }) => {
  const options = { javaScriptEnabled: false, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' };
  const baselineContext = await browser.newContext(options);
  const candidateContext = await browser.newContext(options);
  const baseline = await baselineContext.newPage();
  const candidate = await candidateContext.newPage();
  for (const route of ['/', '/zh/', '/timeline/', '/projects/mangling-fixture-violet/',
    '/projects/mangling-fixture-teal/', '/projects/mangling-fixture-coral/', '/projects/mangling-fixture-neutral/',
    '/writing/mangling-fixture-note/']) {
    await baseline.goto(`${baselineOrigin}${route}`);
    await candidate.goto(`${origin}${route}`);
    expect(await candidate.screenshot({ animations: 'disabled', fullPage: true })).toEqual(
      await baseline.screenshot({ animations: 'disabled', fullPage: true }));
  }
  await candidateContext.close();
  await baselineContext.close();
});

test('soft navigation, locale, filters, history, theme, and fragments keep their contracts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => { window.__testHeader = document.querySelector('.site-header'); window.__testDocument = document; });
  await page.locator('.site-nav a[href="/timeline/"]').click();
  await expect(page).toHaveURL(/\/timeline\/$/);
  expect(await page.evaluate(() => window.__testHeader === document.querySelector('.site-header') && window.__testDocument === document)).toBe(true);
  await page.locator('[data-filter="writing"]').click();
  await expect(page.locator('[data-filter="writing"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-filter="writing"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-filter="all"]').click();
  await page.locator('[popovertarget="language-popover"]').click();
  await page.locator('#language-popover a[href="/zh/timeline/"]').click();
  await expect(page).toHaveURL(/\/zh\/timeline\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-HK');
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'zh');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', new URL('/zh/timeline/', siteConfig.url).href);
  expect(await page.evaluate(() => window.__testHeader === document.querySelector('.site-header'))).toBe(true);
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('[popovertarget="theme-popover"]').click();
  await page.locator('label').filter({ has: page.locator('[data-theme-option][value="dark"]') }).click();
  await expect(page.locator('[data-theme-option][value="dark"]')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme-popover').evaluate((element) => element.hidePopover());
  await page.locator('.site-header a[href="/"]').click();
  await expect(page).toHaveURL(`${origin}/`);
  await page.locator('.skip-link').focus();
  await page.locator('.skip-link').press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect.poll(() => page.locator('#main-content').evaluate((element) =>
    Math.abs(element.getBoundingClientRect().top))).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test('native View Transitions exercise mangled records and runtime writing fragments', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const native = document.startViewTransition.bind(document);
    window.__transitions = 0;
    window.__fragmentSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.title-line-fragment')) window.__fragmentSeen = true;
    }).observe(document, { childList: true, subtree: true });
    document.startViewTransition = (...args) => { window.__transitions++; return native(...args); };
  });
  await page.goto('/timeline/');
  await page.evaluate(() => { window.__testDocument = document; });
  await page.locator('a[data-work-slug="mangling-fixture-violet"]').first().click();
  await expect(page).toHaveURL(/\/projects\/mangling-fixture-violet\/$/);
  await expect.poll(() => page.evaluate(() => window.__transitions)).toBeGreaterThan(0);
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/timeline/`);
  const writing = page.locator('a[data-writing-slug="mangling-fixture-note"]').first();
  await writing.click();
  await expect(page).toHaveURL(/\/writing\/mangling-fixture-note\/$/);
  await expect.poll(() => page.evaluate(() => window.__fragmentSeen)).toBe(true);
  await expect(page.locator('.title-line-fragment')).toHaveCount(0);
  await expect(page.locator('#fixture-fragment')).toHaveClass('external-content-contract');
  await expect(page.locator('#fixture-fragment')).toHaveAttribute('data-fixture', 'schema-value');
  expect(await page.evaluate(() => window.__testDocument === document)).toBe(true);
  expect(errors).toEqual([]);
});

test('unsupported View Transition and JavaScript-disabled navigation retain static links', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => { document.startViewTransition = undefined; });
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await page.locator('.site-nav a[href="/timeline/"]').click();
  await expect(page).toHaveURL(/\/timeline\/$/);
  await context.close();
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(`${origin}/`);
  await staticPage.locator('.site-nav a[href="/timeline/"]').click();
  await expect(staticPage).toHaveURL(/\/timeline\/$/);
  await staticContext.close();
});
