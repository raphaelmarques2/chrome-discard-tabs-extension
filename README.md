# Tab Suspender

A Chrome extension that automatically suspends inactive tabs based on URL rules. Matching tabs are discarded after a configurable idle period, freeing memory while keeping the tab in place so you can reload it when needed.

## How it works

1. You define URL rules in the popup (e.g. `*://github.com/*` with a 30-minute timeout).
2. A content script on matching pages reports user activity (mouse, keyboard, scroll, etc.).
3. When a tab is inactive for longer than its rule allows, the extension discards it via `chrome.tabs.discard`.
4. The active tab, pinned tabs, and tabs playing audio are never suspended.

URL patterns use glob-style wildcards: `*` matches any characters. Examples:

- `*://github.com/*` — all pages on github.com
- `*://*.example.com/*` — all subdomains of example.com

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- Google Chrome (or another Chromium-based browser)

## Build

```bash
npm install
npm run build
```

The built extension is output to `dist/`.

For development with automatic rebuilds:

```bash
npm run dev
```

To package a zip file for distribution:

```bash
npm run zip
```

This creates `extension.zip` in the project root.

## Install in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the `dist/` folder.
5. After code changes, click the refresh icon on the extension card (or reload the extension from `chrome://extensions`).

## Usage

1. Click the Tab Suspender icon in the toolbar to open the popup.
2. Enter a URL pattern and idle timeout in minutes, then click **Adicionar** (Add).
3. The pattern field is pre-filled from the current tab's URL when possible.
4. Remove a rule with the **✕** button next to it.

Rules are synced across Chrome profiles via `chrome.storage.sync`.

## Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Build in watch mode |
| `npm run build` | Production build to `dist/` |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run test:all` | Run all tests |
| `npm run lint` | Lint source files |
| `npm run format` | Format source with Prettier |

## Project structure

```
src/
  background/   Service worker — tab timers, alarms, suspension logic
  content/      Activity tracking injected into matching pages
  popup/        SolidJS UI for managing URL rules
  shared/       Types and URL pattern helpers
tests/
  unit/         Vitest unit tests
  e2e/          Playwright extension tests
```
