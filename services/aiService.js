const OpenAI = require('openai');

function getPrimaryAIConfig() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
  return {
    apiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
    isGemini: true
  };
}

function getSecondaryAIConfig() {
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey) return null;
  return {
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile'
  };
}

function getTertiaryAIConfig() {
  const apiKey = process.env.GEMINI_FALLBACK_API_KEY || '';
  if (!apiKey) return null;
  return {
    apiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
    isGemini: true
  };
}

const primaryConfig = getPrimaryAIConfig();
const secondaryConfig = getSecondaryAIConfig();
const tertiaryConfig = getTertiaryAIConfig();

function createClient(config) {
  if (!config || !config.apiKey) return null;
  const clientOptions = { apiKey: config.apiKey };
  if (config.baseURL) clientOptions.baseURL = config.baseURL;
  return new OpenAI(clientOptions);
}

const primaryClient = createClient(primaryConfig);
const secondaryClient = createClient(secondaryConfig);
const tertiaryClient = createClient(tertiaryConfig);

async function tryAICompletion(options) {
  if (!primaryClient) throw new Error("No primary AI client configured");
  
  // Layer 1: Primary (Gemini)
  try {
    return await primaryClient.chat.completions.create({ ...options, model: primaryConfig.model });
  } catch (err1) {
    const isRateLimit1 = err1.status === 429 || err1.status === 503 || err1.message.includes('429');
    if (!isRateLimit1 || !secondaryClient) throw err1;

    console.warn(`[AI] Primary API failed (${err1.message}). Trying Layer 2 (Groq)...`);
    
    // Layer 2: Secondary (Groq)
    try {
      return await secondaryClient.chat.completions.create({ ...options, model: secondaryConfig.model });
    } catch (err2) {
      if (!tertiaryClient) throw err2;

      console.warn(`[AI] Layer 2 failed (${err2.message}). Trying Layer 3 (Gemini Fallback)...`);
      
      // Layer 3: Tertiary (Gemini 2nd Key)
      return await tertiaryClient.chat.completions.create({ ...options, model: tertiaryConfig.model });
    }
  }
}

// ─── Regex Fallback (no API key) ─────────────────────────────────────────────
function fallbackGenerate({ caption, username }) {
  // Extract hashtags from caption
  const existingTags = (caption.match(/#\w+/g) || []).slice(0, 15);
  
  const cleanCaption = caption.replace(/#\w+/g, '').trim();

  // Build detailed title like product example
  let title = cleanCaption.split(/[.!?\n]/)[0].trim().substring(0, 90);
  if (title.length < 10 && cleanCaption.length > 10) {
    title = cleanCaption.substring(0, 90);
  }
  // Add styling info if space allows
  title = title + ' ✨';
  if (title.length > 100) title = title.substring(0, 97) + '...';

  // Build detailed description with features, styling tips, hashtags embedded
  const defaultTags = ['#fashion', '#style', '#ootd', '#outfit', '#trending', '#lifestyle', '#instafashion', '#fashionblogger'];
  const tags = existingTags.length > 3 ? existingTags.slice(0, 8) : defaultTags;
  
  // Split caption into sentences for feature extraction
  const sentences = cleanCaption.split(/[.!?]+/).filter(s => s.trim().length > 10);
  let features = sentences.slice(0, 3).join('. ').trim();
  if (features.length > 300) features = features.substring(0, 297) + '...';
  
  // Add styling tips and call-to-action with hashtags embedded
  const description = `${features || cleanCaption.substring(0, 350)}\n\n💡 Style tip: Perfect for casual outings, date nights, or everyday wear. Pair with jeans or chinos for a effortless look.\n\n👆 Follow @${username} for more fashion tips!\n\n${tags.join(' ')}`.trim();

  return { title, description, hashtags: tags, aiGenerated: false };
}

// ─── Gemini Generation ────────────────────────────────────────────────────────
async function generateWithAI({ caption, username, mediaType }) {
  const systemPrompt = `You are the world's top Pinterest SEO and Viral Marketing Expert. Your goal is to turn Instagram Reels into high-traffic Pinterest Pins.
  You understand Pinterest's search algorithm and user behavior. 
  Rules for your writing:
  1. TITLES: Use high-volume keywords. Start with the most important words. Use vertical bars | to separate phrases.
  2. DESCRIPTIONS: Start with a powerful hook. Be extremely descriptive. Use "sensory" words (how it feels, looks, vibes). 
  3. SEO: Naturally weave keywords throughout the text so it ranks in Pinterest search.
  4. FORMAT: Return ONLY valid JSON. No conversational filler.`;

  const userPrompt = `Create a VIRAL Pinterest Pin from this Instagram content:

Creator: @${username}
Media: ${mediaType || 'video'}
Caption: ${caption || '(no caption)'}

Please provide:
- title: (Max 100 chars) SEO-Optimized. Format: [Main Item/Topic] | [Key Benefit/Style] | [Call to Action/Vibe]. 
  Example: "Classic Brown Leather Jacket 🧥 | Fall Streetwear Outfit Inspo | Must-Have Layering"

- description: (400-500 chars) Professional Blogger Style. 
  Structure: 
  - [Hook Line]
  - [Detailed Product/Scene Description]
  - [Why it's unique/benefits]
  - [Styling Tip or How to Use]
  - [Final CTA with 8-10 trending hashtags naturally embedded]

- hashtags: array of 12-15 highly relevant Pinterest trending tags.

Return JSON: { "title": "...", "description": "...", "hashtags": ["#tag1", "#tag2"] }`;

  const options = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 350,
  };

  let retries = 2;
  while (retries >= 0) {
    try {
      const response = await tryAICompletion(options);
      const raw = response.choices[0].message.content.trim();
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(cleaned);

      return {
        title: (parsed.title || '').substring(0, 100),
        description: (parsed.description || '').substring(0, 500),
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 15) : [],
        aiGenerated: true,
      };
    } catch (err) {
      if ((err.status === 429 || err.message.includes('429')) && retries > 0) {
        console.warn(`[AI] generateWithAI rate limited (429). Retrying in 30s... (${retries} left)`);
        await new Promise(r => setTimeout(r, 30000));
        retries--;
        continue;
      }
      throw err;
    }
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────
async function generatePinterestContent({ caption = '', username = 'creator', mediaType = 'video' }) {
  if (!primaryClient) {
    console.warn('[AI] No AI API key configured — using fallback generator');
    return fallbackGenerate({ caption, username });
  }

  try {
    return await generateWithAI({ caption, username, mediaType });
  } catch (err) {
    console.warn(`[AI] Provider call failed, using fallback:`, err.message);
    return fallbackGenerate({ caption, username });
  }
}

// ─── Product Identifier (for IG Affiliate Tracker) ───────────────────────────
/**
 * Analyses an Instagram caption to determine if a physical shoppable product
 * is featured. Returns { found, productName, flipkartQuery, category } or { found: false }.
 */
async function identifyProduct({ caption = '', username = '', thumbnailUrl = '' }) {
  let retries = 3;
  while (retries >= 0) {
    try {
      return await identifyProductInternal({ caption, username, thumbnailUrl });
    } catch (err) {
      if (err.message.includes('429') && retries > 0) {
        console.warn(`[AI] identifyProduct rate limited (429). Retrying in 35s... (${retries} left)`);
        await new Promise(r => setTimeout(r, 35000));
        retries--;
        continue;
      }
      break; 
    }
  }

  // AI Failed or Rate Limited — Use Heuristic Fallback
  console.warn(`[AI] Falling back to Keyword Heuristic for @${username}`);
  return heuristicIdentifyProduct(caption);
}

function heuristicIdentifyProduct(caption) {
  const productKeywords = ['buy', 'shop', 'link', 'available', 'price', 'offer', 'discount', 'order', 'get', 'grab', 'sneakers', 'shirt', 'jeans', 'watch', 'phone', 'gadget'];
  const lower = caption.toLowerCase();
  const hasKeyword = productKeywords.some(k => lower.includes(k));
  
  if (!hasKeyword && caption.length < 20) return { found: false };

  // Clean the caption to get a searchable product name
  // 1. Take first line or first 60 chars
  let productName = caption.split('\n')[0].substring(0, 80);
  // 2. Remove hashtags and emojis
  productName = productName.replace(/#\w+/g, '').replace(/[^\w\s]/gi, '').trim();
  
  if (productName.length < 3) return { found: false };

  return { 
    found: true, 
    productName, 
    exactMatchQuery: productName, 
    similarMatchQuery: productName.split(' ').slice(0, 4).join(' '),
    broadMatchQuery: productName.split(' ').slice(0, 2).join(' '),
    category: 'other' 
  };
}

async function identifyProductInternal({ caption = '', username = '', thumbnailUrl = '' }) {
  if (!primaryClient) {
    return heuristicIdentifyProduct(caption);
  }

  const systemPrompt = 'You are an AI visual product identifier for affiliate marketing. You must analyze the provided caption and image to determine if a shoppable product (fashion, electronics, home decor, etc.) is showcased. Be helpful and try to find a product if the caption implies one. Return only valid JSON.';
  
  const textPrompt = `Instagram Reel from @${username}:
Caption: "${caption.substring(0, 700)}"

Task: Identify the primary product being promoted. 
- CRITICAL: You MUST visually inspect the provided image. Identify the EXACT brand, specific model, and color of the main product shown (e.g., "Puma Smash V2 White Sneakers", "Rolex Submariner Watch").
- Do not just output generic terms. If the caption says "shop link in bio", you MUST rely on the image to figure out what the exact item is.
- The goal is to find the EXACT SAME product shown in the reel.

If a product is found → Return: 
{
  "found": true,
  "productName": "specific product name",
  "exactMatchQuery": "brand + specific model + color + type",
  "similarMatchQuery": "brand + color + type",
  "broadMatchQuery": "color + type",
  "category": "fashion|electronics|home|beauty|other"
}
If absolutely no product → Return: { "found": false }

Return ONLY the JSON object.`;

  const userMessageContent = [];
  userMessageContent.push({ type: 'text', text: textPrompt });
  
  if (thumbnailUrl) {
    try {
      const fetch = require('node-fetch'); // Ensure fetch is available
      const imgRes = await fetch(thumbnailUrl);
      if (imgRes.ok) {
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
        userMessageContent.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` }
        });
      } else {
        console.warn(`[AI] Failed to download image for AI: ${imgRes.statusText}`);
      }
    } catch (e) {
      console.warn(`[AI] Error downloading image for AI: ${e.message}`);
    }
  }

  const options = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent },
    ],
    temperature: 0.4,
    max_tokens: 150,
  };
  
  const response = await tryAICompletion(options);
  const raw = response.choices[0].message.content.trim();
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(cleaned);

  // If AI says not found, but we have strong keywords, use heuristic anyway
  if (parsed.found !== true) {
    const heuristic = heuristicIdentifyProduct(caption);
    if (heuristic.found) {
        console.log(`[AI] AI said no product, but heuristic found one. Using heuristic.`);
        return heuristic;
    }
  }

  if (parsed.found === true && parsed.productName) {
    return {
      found: true,
      productName: parsed.productName,
      exactMatchQuery: parsed.exactMatchQuery || parsed.productName,
      similarMatchQuery: parsed.similarMatchQuery || parsed.productName,
      broadMatchQuery: parsed.broadMatchQuery || parsed.category || 'other',
      category: parsed.category || 'other',
    };
  }
  return { found: false };
}

/**
 * Analyses an Instagram caption and image to extract a full "Shop The Look" outfit.
 * Returns { found: true, outfitName, items: [{ type, query }] } or { found: false }.
 */
async function identifyOutfit({ caption = '', username = '', thumbnailUrl = '' }) {
  if (!primaryClient) {
    return { found: false };
  }

  const systemPrompt = `You are a professional AI fashion stylist and visual product identifier. Your task is to analyze the provided caption and image from an Instagram Reel, identify the main product being showcased, and then recommend 3 matching items to complete the outfit (a full "Shop The Look" curation). If no physical product is found, return {"found": false}.`;
  
  const textPrompt = `Instagram Reel from @${username}:
Caption: "${caption.substring(0, 700)}"

Task: Extract the entire outfit from the image and caption.
1. Identify the 'main' item (e.g., the jacket or shirt shown).
2. Curate matching items (e.g., 'bottom', 'shoes', 'accessory') that complete the look. Be specific with brands and colors if possible, otherwise use highly descriptive generic terms.
3. Return ONLY a valid JSON object in this exact format:
{
  "found": true,
  "outfitName": "A catchy, stylish name for this outfit (e.g., 'Casual Summer Streetwear')",
  "items": [
    { "type": "main", "query": "Exact description of main item (e.g., 'Puma Smash V2 White Sneakers')" },
    { "type": "bottom", "query": "Matching bottom (e.g., 'Men\\'s Slim Fit Black Chinos')" },
    { "type": "shoes", "query": "Matching shoes (e.g., 'White Casual Sneakers')" },
    { "type": "accessory", "query": "Matching accessory (e.g., 'Silver Chain Watch')" }
  ]
}

Return ONLY valid JSON.`;

  const userMessageContent = [];
  userMessageContent.push({ type: 'text', text: textPrompt });
  
  if (thumbnailUrl) {
    try {
      const fetch = require('node-fetch');
      const imgRes = await fetch(thumbnailUrl);
      if (imgRes.ok) {
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
        userMessageContent.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` }
        });
      }
    } catch (e) {
      console.warn(`[AI] Error downloading image for identifyOutfit: ${e.message}`);
    }
  }

  const options = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent },
    ],
    temperature: 0.5,
    max_tokens: 300,
  };
  
  try {
    const response = await tryAICompletion(options);
    const raw = response.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned);
    
    if (parsed.found === true && parsed.items && parsed.items.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.warn('[AI] identifyOutfit failed:', err.message);
  }
  
  return { found: false };
}

/**
 * Generates a high-quality, professional Pinterest comment based on a pin's content.
 */
async function generateEngagementComment({ title, description, subNiche = 'casual' }) {
  const genericPhrases = ['nice', 'cool', 'love this', 'great outfit', 'fire bro', 'awesome'];
  const fallbacks = {
    formal: "The tailoring on this is actually clean, proper fit makes all the difference",
    streetwear: "Silhouette is on point, that layering is dialed in perfectly",
    casual: "Effortless look, really dialed in for everyday wear",
    luxury: "Immaculate taste, the actual heat here is on another level",
    athletic: "Functional and locked in, perfect gym to street fit",
    default: "Clean look, the details on this fit are properly dialed in",
  };
  const fallback = fallbacks[subNiche.toLowerCase()] || fallbacks.default;

  if (!openai) {
    return fallback;
  }

  let vocab = '';
  switch (subNiche.toLowerCase()) {
    case 'streetwear': vocab = 'Use vocabulary like: clean, heat, drip, on point, dialed.'; break;
    case 'formal': vocab = 'Use vocabulary like: sharp, dapper, tailored, clean cut, sophisticated.'; break;
    case 'casual': vocab = 'Use vocabulary like: effortless, lowkey clean, dialed in.'; break;
    case 'luxury': vocab = 'Use vocabulary like: immaculate, taste, actual heat, level.'; break;
    case 'athletic': vocab = 'Use vocabulary like: functional, locked in, gym to street.'; break;
    default: vocab = 'Use vocabulary like: clean, dialed in, sharp.'; break;
  }

  const systemPrompt = `You are a genuine men's fashion enthusiast leaving a comment on a Pinterest pin.
  Rules:
  1. Write EXACTLY 1 to 2 sentences.
  2. The total length MUST be between 8 and 20 words.
  3. Reference something SPECIFIC from the Pin's title or description.
  4. NEVER use hashtags (#).
  5. NEVER include URLs or links.
  6. Use MAXIMUM 1 emoji total.
  7. NEVER start the comment with the word "I" or "I'm".
  8. NEVER use generic phrases like: nice, cool, love this, great outfit, fire bro, or awesome.
  9. ${vocab}`;

  const userPrompt = `Generate a comment for this Pin:
  Title: ${title}
  Description: ${description}
  
  Comment:`;

  function validateComment(text) {
    const words = text.trim().split(/\s+/).length;
    if (words < 8 || words > 20) return false;
    if (text.includes('#')) return false;
    if (/https?:\/\//i.test(text) || /\w+\.\w+/.test(text)) return false; // Basic URL check
    if (text.trim().toLowerCase().startsWith('i ') || text.trim().toLowerCase().startsWith("i'm ")) return false;
    const lowerText = text.toLowerCase();
    if (genericPhrases.some(phrase => lowerText.includes(phrase))) return false;
    return true;
  }

  try {
    let retries = 3;
    while (retries > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: aiConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.85,
          max_tokens: 100,
        });
        
        let comment = response.choices[0].message.content.trim().replace(/^"/, '').replace(/"$/, '');
        if (validateComment(comment)) {
          return comment;
        }
        
        console.warn(`[AI] Comment validation failed ("${comment}"). Retries left: ${retries - 1}`);
        retries--;
      } catch (err) {
        if (err.message.includes('429') && retries > 1) {
          console.warn(`[AI] Rate limited (429). Retrying in 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          retries--;
          continue;
        }
        if (err.message.includes('400') && retries > 1) {
          console.warn(`[AI] Bad request (400). Retrying...`);
          await new Promise(r => setTimeout(r, 2000));
          retries--;
          continue;
        }
        console.error('[AI] Comment generation failed:', err.message);
        break; // break out of retry loop on other errors
      }
    }
    console.warn(`[AI] Falling back to safe comment after 3 failed attempts.`);
    return fallback;
  } catch (err) {
    console.error('[AI] generateEngagementComment outer error:', err.message);
    return fallback;
  }
}

module.exports = { generatePinterestContent, identifyProduct, identifyOutfit, generateEngagementComment };
