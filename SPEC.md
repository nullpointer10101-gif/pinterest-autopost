# Reel to Pinterest Auto Poster - Specification

## 1. Project Overview

**Project Name:** Reel to Pinterest Auto Poster
**Type:** Full-stack Web Application
**Core Functionality:** Automatically convert Instagram Reels into Pinterest posts with AI-generated titles, descriptions, and hashtags
**Target Users:** Social media managers, content creators, marketers who want to repurpose Instagram content for Pinterest

---

## 2. UI/UX Specification

### Layout Structure

**Page Sections:**
- **Header:** Logo, app name, user connection status
- **Main Dashboard:** Single-page application with input area and results
- **Sidebar:** History panel (collapsible)
- **Footer:** Minimal with status indicators

**Responsive Breakpoints:**
- Mobile: < 768px (stacked layout)
- Tablet: 768px - 1024px
- Desktop: > 1024px (side-by-side panels)

### Visual Design

**Color Palette:**
- Background: `#0D0D0D` (deep black)
- Surface: `#1A1A1A` (card backgrounds)
- Surface Elevated: `#252525` (modals, dropdowns)
- Primary: `#E60023` (Pinterest red)
- Secondary: `#FF6B6B` (accent coral)
- Instagram Gradient: `linear-gradient(45deg, #F58529, #DD2A7B, #8134AF, #515BD4)`
- Success: `#00C853`
- Error: `#FF1744`
- Warning: `#FFD600`
- Text Primary: `#FFFFFF`
- Text Secondary: `#B3B3B3`
- Border: `#333333`

**Typography:**
- Font Family: `'Outfit', sans-serif` (headings), `'DM Sans', sans-serif` (body)
- Logo: 28px bold
- H1: 32px semibold
- H2: 24px semibold
- H3: 18px medium
- Body: 14px regular
- Small: 12px regular

**Spacing System:**
- Base unit: 8px
- Card padding: 24px
- Section gaps: 32px
- Element gaps: 16px

**Visual Effects:**
- Cards: 12px border-radius, subtle `0 4px 24px rgba(0,0,0,0.4)` shadow
- Buttons: 8px border-radius, hover scale 1.02, transition 200ms
- Inputs: 8px border-radius, 2px border, focus glow with primary color
- Glassmorphism on modals: `backdrop-filter: blur(20px)`
- Subtle grain texture overlay on background

### Components

**1. Header**
- Logo (Reel icon + Pinterest icon combined)
- App title "Reel to Pinterest"
- Connection status indicator (green dot = connected)
- Settings gear icon

**2. URL Input Card**
- Large text input for Instagram Reel URL
- Paste button with clipboard icon
- "Process" primary button
- URL validation indicator

**3. Preview Card** (appears after processing)
- Thumbnail preview of reel
- Editable title field
- Editable description textarea
- Hashtags display (editable)
- Board selection dropdown
- "Post to Pinterest" button
- "Regenerate" button for AI content

**4. Status Indicators**
- Processing spinner with step text
- Success checkmark animation
- Error message with retry option

**5. History Sidebar**
- List of previously posted items
- Thumbnail + title + date
- Click to view details
- Filter/search capability

**6. Connection Modal**
- Pinterest OAuth connect button
- Instructions for connection
- Disconnect option

**States:**
- Default, Hover, Active, Disabled, Loading, Success, Error

---

## 3. Functionality Specification

### Core Features

**F1: Instagram Reel URL Input**
- Accept full Instagram Reel URLs
- Validate URL format before processing
- Support both mobile and web URLs
- Show validation feedback

**F2: Content Extraction**
- Fetch reel metadata (caption, thumbnail, video URL)
- Handle private/public reels
- Extract video for Pinterest upload
- Fallback to thumbnail if video unavailable

**F3: AI Content Generation**
- Generate engaging Pinterest title (max 100 chars)
- Generate description (max 500 chars)
- Generate relevant hashtags (max 20)
- Use caption + context for generation

**F4: Pinterest Publishing**
- OAuth 2.0 authentication flow
- Board selection (create new or select existing)
- Upload image/video with metadata
- Return success/failure status

**F5: Content Preview & Edit**
- Show generated content before posting
- Allow manual edits to all fields
- Validate character limits
- Real-time character count

**F6: History Management**
- Store posted items locally (localStorage)
- Display with thumbnails and metadata
- Show posting date and board name
- Allow re-posting with modifications

### User Interactions & Flows

**Main Flow:**
1. User pastes Instagram Reel URL
2. Clicks "Process" button
3. System validates URL
4. System extracts reel content (loading state)
5. AI generates Pinterest content (loading state)
6. Preview modal appears with generated content
7. User can edit fields if needed
8. User selects Pinterest board
9. Clicks "Post to Pinterest"
10. System publishes to Pinterest
11. Success message shown
12. Item added to history

**OAuth Flow:**
1. User clicks "Connect Pinterest"
2. Redirect to Pinterest OAuth
3. User authorizes app
4. Redirect back with access token
5. Token stored securely

### Data Handling

**Local Storage:**
- Pinterest OAuth tokens
- Posting history
- User preferences

**API Endpoints (Backend):**
- `POST /api/extract` - Extract reel content
- `POST /api/generate` - Generate AI content
- `POST /api/publish` - Post to Pinterest
- `GET /api/boards` - Get user boards
- `GET /api/history` - Get posting history
- `POST /api/auth/pinterest` - OAuth callback

### Edge Cases

- Invalid URL format → Show validation error
- Private/unavailable reel → Show specific error
- OAuth token expired → Prompt re-authentication
- Pinterest API rate limit → Queue and retry
- Network failure → Retry with exponential backoff
- Empty caption → Generate from video context

---

## 4. Technical Architecture

### Frontend
- Single HTML file with embedded CSS/JS
- Vanilla JavaScript (no frameworks)
- Fetch API for backend communication
- LocalStorage for persistence

### Backend (Node.js/Express)
- Express.js server
- Instagram scraping (puppeteer or igram-scraper)
- OpenAI API for content generation
- Pinterest API integration
- Rate limiting and error handling

### API Integrations
- Instagram: Web scraping or third-party API
- OpenAI: GPT-4 for content generation
- Pinterest: Official Pinterest API

---

## 5. Acceptance Criteria

### Visual Checkpoints
- [ ] Dark theme with Pinterest-inspired colors renders correctly
- [ ] All interactive elements have hover/active states
- [ ] Loading states show animated spinners
- [ ] Success/error messages are clearly visible
- [ ] Responsive layout works on mobile/tablet/desktop

### Functional Checkpoints
- [ ] URL validation works for various Instagram URL formats
- [ ] Content extraction retrieves caption and media
- [ ] AI generates relevant titles and descriptions
- [ ] Pinterest OAuth flow completes successfully
- [ ] Publishing to Pinterest works end-to-end
- [ ] History displays all posted items
- [ ] Edit functionality works before posting

### Error Handling
- [ ] Invalid URLs show clear error messages
- [ ] Network failures are handled gracefully
- [ ] API errors display user-friendly messages
- [ ] Retry mechanisms work for transient failures

---

## 6. File Structure

```
/reel-to-pinterest-auto-poster
├── server/
│   ├── index.js          (Express server)
│   ├── routes/
│   │   ├── api.js        (API routes)
│   │   └── auth.js       (OAuth routes)
│   ├── services/
│   │   ├── instagram.js (Reel extraction)
│   │   ├── ai.js         (Content generation)
│   │   └── pinterest.js  (Pinterest API)
│   └── utils/
│       └── helpers.js
├── public/
│   ├── index.html        (Frontend)
│   ├── styles.css
│   └── app.js
├── .env                  (Environment variables)
├── package.json
└── README.md
```
