# Pinterest Command Center — System Design & Architecture

This document provides an in-depth technical overview of the system architecture, component logic, and automation workflows of the Pinterest Autopost & Engagement tool.

---

## 1. System Architecture Overview

The application is built on a **Modular Micro-Services** architecture, designed for both local execution and serverless cloud deployment (Vercel + GitHub Actions).

### High-Level Layers:
1.  **Frontend (Vanilla JS/CSS/HTML)**: A glassmorphism-based dashboard for real-time monitoring and manual intervention.
2.  **Backend (Express.js)**: RESTful API handling coordination between the UI and services.
3.  **Services Layer**: Independent logic units for Extraction, AI, Pinterest API, and Puppeteer.
4.  **Storage Layer (Stateful)**: Hybrid persistence using Upstash Redis (Cloud) or Local JSON.
5.  **Automation Worker**: A decoupled GitHub Action that triggers hourly "Missions."

---

## 2. Core Service Modules

### A. Extraction Engine (`instagramService.js`)
Handles the transformation of a raw Instagram URL into structured media data.
-   **Multi-Fallback Strategy**: If one method fails, it automatically cycles through:
    1.  **IG-Direct (Local)**: High-speed extraction using raw network patterns.
    2.  **Ollie API**: Direct video stream resolution.
    3.  **HTML Scraping**: Parsing `og:video` and `application/ld+json` meta-data.
    4.  **Microlink**: Final fallback for metadata verification.

### B. AI Optimization Engine (`aiService.js`)
Uses Large Language Models (LLMs) to optimize content for Pinterest SEO.
-   **Contextual Analysis**: Analyzes the original Instagram caption to extract intent.
-   **Generation**: Produces 100-character titles (Pinterest limit) and 500-800 character descriptions with high-volume hashtags.

### C. Browser Bot (`puppeteerService.js`)
The "Human-Mimicry" engine that bypasses API limitations.
-   **Session Linking**: Uses a valid `_pinterest_sess` cookie to act as the user without requiring Developer API approval.
-   **Mission Execution**: Directly interacts with `pinterest.com/pin-builder` to upload media and finalize posts.
-   **Algorithm Booster**: Performs "Safe Engagements" (Likes/Comments) by navigating the home feed and reacting to niche-specific content.

---

## 3. Automation Lifecycle

The "Enterprise Automation" suite operates on a **Scheduled Mission** model.

### 1. Hourly Automation (`automationService.js`)
Triggered by a GitHub Action Cron job (`0 * * * *`).
-   **Step 1: Jitter**: Waits a random time (15s–2m) to avoid footprint detection.
-   **Step 2: Posting**: Checks the `Mission Queue`. If a post is pending, it executes a browser-based upload.
-   **Step 3: Engagement (Shutdown Loop)**: 
    -   Opens browser -> Engages 1 Pin -> Shuts down.
    -   Waits a random gap.
    -   Re-opens -> Engages 1 Pin -> Shuts down.
    -   This prevents long, suspicious browser sessions.

### 2. State Persistence (`storageService.js`)
To maintain consistency between your local machine and GitHub/Vercel:
-   **Upstash Redis**: Stores the entire application state (Queue, History, Tokens) in a globally accessible cloud DB.
-   **Local Fallback**: Uses `data/db.json` when running locally without cloud secrets.

---

## 4. UI Design Philosophy

The **"Command Center"** UI is designed for **High-Information Density** and **Premium Aesthetics**.
-   **Glassmorphism**: Uses semi-transparent layers and backdrop blurs for a modern, sleek feel.
-   **Accessibility**: Full keyboard navigation (Tabs) and ARIA attributes for screen readers.
-   **Real-Time Sync**: Polling and state-driven rendering ensure that when the background worker finishes a mission, the UI updates automatically.

---

## 5. Security & Safety Mechanisms

-   **Proxy System**: All Instagram thumbnails are routed through `/api/proxy` to bypass CORS and Referer restrictions.
-   **Safe Selectors**: Puppeteer uses multiple fallback selectors for Pinterest buttons, ensuring reliability during Pinterest UI updates.
-   **Rate Limiting**: Hard-caps on engagements per hour (default: 2) to prevent account flagging.
-   **12-Hour Sync**: Time formatting is localized to human-readable 12h (AM/PM) to make monitoring intuitive.

---

## 6. Directory Structure

```text
/public             # Frontend assets (HTML, CSS, JS)
/routes             # API endpoints (api.js)
/services           # Business logic
  ├── aiService     # AI generation
  ├── automation    # Hourly logic
  ├── puppeteer     # Browser bot
  ├── storage       # State persistence
/scripts            # CLI scripts for background workers
/data               # Local JSON storage (git-ignored)
```

---
*Created on: 2026-04-26 | System Version: 2.5.0 (Optimized)*
