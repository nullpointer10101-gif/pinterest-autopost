# X (Twitter) Automation Implementation Plan

This document outlines the best architecture for adding X (Twitter) automation (auto-engage, comment, like, and post) to the existing Pinterest Autopost system. 

The primary goal is to **guarantee zero interference with the existing Pinterest automation** while reusing the proven architecture already in place.

## 1. Core Architecture Strategy (Isolation)
To ensure Pinterest remains entirely unaffected, X automation will be built as an independent, parallel subsystem using the exact same design patterns as the Pinterest side.

* **No Shared State**: X will have its own queue, its own history, and its own service files.
* **Service Separation**: Instead of modifying `puppeteerService.js` to handle both, we will create dedicated files:
  * `services/xService.js` (for X API / basic data fetching if needed)
  * `services/xPuppeteerService.js` (for X headless browser bot tasks)
  * `services/xQueueService.js` (X-specific queue management)
  * `services/xAutomationService.js` (Orchestrator for X's posting and engagement loops)

## 2. Authentication & Session Management
Just like Pinterest uses the `_pinterest_sess` cookie, X relies heavily on the `auth_token` and `ct0` cookies for authentication.
* **Implementation**: We will create an endpoint in the UI where the user can link their X session.
* **Storage**: We will update `data/state.json` (or create `data/x-state.json`) to store the X session cookie.
* **Execution**: When `xPuppeteerService.js` launches a browser, it will inject the `auth_token` cookie for `x.com` before navigating, ensuring it logs in seamlessly without triggering login prompts.

## 3. Auto-Posting Mechanism (Fire-and-Forget)
* **The Queue**: X posts will be queued into `data/x-queue.json`.
* **The Bot Action**: 
  1. Puppeteer launches a headless browser.
  2. Navigates to `https://x.com/compose/tweet`.
  3. Uploads the media (video/image) using the file input (`input[type="file"][accept*="image"], input[type="file"][accept*="video"]`).
  4. Types the tweet content into the DraftEditor (`[data-testid="tweetTextarea_0"]`).
  5. Clicks the Post button (`[data-testid="tweetButton"]`).
  6. Scrapes the resulting Tweet URL to mark the queue item as `completed`.

## 4. Auto-Engagement (Like & Comment)
To avoid X's strict spam filters and shadowbans, the engager will act entirely human, just like the `runAutoEngagerSafe` function built for Pinterest.

* **The Flow**:
  1. Puppeteer navigates to the user's `For You` feed (`https://x.com/home`) or a specific search URL.
  2. Scrolls randomly down the page with variable human-like delays (2000ms - 5000ms).
  3. Identifies a tweet container (`[data-testid="tweet"]`).
  4. **Like**: Finds the Like button (`[data-testid="like"]`) and clicks it.
  5. **Comment**: Randomly decides to comment based on a `COMMENT_PROBABILITY` config. If true, clicks Reply (`[data-testid="reply"]`), picks a random natural comment from a pre-defined pool, types it with realistic keystroke delays, and submits.
* **Safety Rules**: The bot will enforce strict minimum and maximum gaps between engagements (e.g., waiting 30-60 seconds between likes) to simulate a real human scrolling on a phone.

## 5. Workflow & Scheduling (GitHub Actions)
To prevent the automation processes from blocking each other or timing out the server:
* We will create a **new GitHub Actions workflow** (e.g., `.github/workflows/x-hourly-automation.yml`).
* This workflow will run on its own schedule (e.g., every hour at the 30-minute mark, while Pinterest runs at the top of the hour).
* It will hit a new endpoint: `POST /api/x-automation/run`.
* This completely decouples X from Pinterest. If the X bot crashes or takes too long, Pinterest will continue to run flawlessly.

## 6. Dashboard Integration
* **API Routes**: Create `routes/xApi.js` (mounted at `/api/x`) with endpoints for queuing, fetching status, and triggering manual engagements.
* **Frontend**: Add an "X (Twitter)" tab next to the Pinterest tab. It will feature its own Queue, History, and Auto-Engage settings panels, ensuring the user interface remains clean and organized.

## Summary of New Files to Create Later
1. `services/xPuppeteerService.js`
2. `services/xAutomationService.js`
3. `services/xQueueService.js`
4. `routes/xApi.js` (API endpoints)
5. `data/x-queue.json` & `data/x-history.json`
6. `.github/workflows/x-hourly-automation.yml`

This architecture guarantees that your Pinterest automation remains untouched and highly stable, while X automation runs seamlessly in parallel.
