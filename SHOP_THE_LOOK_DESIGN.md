# System Design: "Shop The Look" AI Landing Page Engine

## 1. Overview
The "Shop The Look" engine transforms the bot from a single-product affiliate poster into an automated fashion stylist. It identifies a full outfit from a single video, generates multiple affiliate links, and dynamically builds a custom landing page for each post. This bypasses social media spam filters by linking to an owned domain and 4x's the earning potential per click.

## 2. Core Components

### A. AI Vision & Outfit Curation (`services/aiService.js`)
- **New Method**: `identifyOutfit(caption, thumbnailUrl)`
- **Functionality**: Instead of returning a single product, the AI will use the image/caption to identify the main item and recommend 3 matching accessories/clothing items to complete the look.
- **Output Format**:
  ```json
  {
    "outfitName": "Casual Summer Streetwear",
    "items": [
      { "type": "main", "query": "Men's Black Leather Jacket" },
      { "type": "bottom", "query": "Men's Slim Fit Chinos" },
      { "type": "shoes", "query": "White Casual Sneakers" },
      { "type": "accessory", "query": "Silver Chain Watch" }
    ]
  }
  ```

### B. Multi-Affiliate Generation (`services/automationService.js`)
- Update `processInstagramReels` to loop through the AI's outfit items.
- For each item, search Flipkart (`flipkartSearchService.js`) and generate an EarnKaro link (`earnKaroService.js`).
- Bundle all successfully found products into an `outfit` array attached to the queue item.

### C. Dynamic Landing Page Route (`routes/look.js`)
- Create a new Express route handling `GET /look/:shortcode`.
- Fetch the reel data and outfit affiliate links from the database (history or queue).
- Render a sleek, mobile-first HTML/CSS page (EJS or dynamically injected vanilla HTML) featuring:
  1. The playing Instagram reel video.
  2. A "Shop This Look" grid displaying the 4 product cards.
  3. "Buy Now" buttons routing through EarnKaro.

### D. Pinterest Link Routing (`services/puppeteerService.js` & `automationService.js`)
- Change the `destinationLink` for the Pinterest Pin from the raw EarnKaro link to the custom landing page URL: `https://[YOUR_DOMAIN]/look/[SHORTCODE]`.
- This ensures Pinterest sees a high-quality, branded domain, boosting algorithmic reach.

## 3. Data Flow
1. **Scrape**: IG Reel is fetched.
2. **AI Curate**: AI defines a 4-piece outfit based on the reel.
3. **Link**: Flipkart & EarnKaro APIs generate 4 affiliate links.
4. **Store**: Outfit data is saved to Redis via `queueService`.
5. **Publish**: Bot pins the video to Pinterest, linking to `/look/shortcode`.
6. **Convert**: User clicks pin -> lands on owned page -> clicks any of the 4 products -> Affiliate Commission earned.

## 4. Implementation Steps
1. **Phase 1**: Update `aiService.js` to return multiple outfit items.
2. **Phase 2**: Update `automationService.js` to process multiple items and bundle them into the queue object.
3. **Phase 3**: Create the frontend `look.html`/template and the backend `routes/look.js` endpoint to serve the page.
4. **Phase 4**: Update Pinterest destination link logic to point to the new landing pages.
