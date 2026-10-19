// Produit les icônes PNG (192, 512, maskable, Apple) à partir de public/icon.svg, avec Microsoft Edge (Playwright).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const svg = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage();

async function render(size, file, { padding = 0, background = 'transparent', square = false } = {}) {
  const inner = size - padding * 2;
  const markup = square ? svg.replace(/rx="112"/, 'rx="0"') : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${background}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">` +
      `<div style="width:${inner}px;height:${inner}px">${markup.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></div></body></html>`,
  );
  await page.screenshot({ path: join(root, 'public', file), omitBackground: background === 'transparent' });
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', { square: true });
await render(180, 'apple-touch-icon.png', { square: true });
await browser.close();
console.log('Icônes générées dans public/');
