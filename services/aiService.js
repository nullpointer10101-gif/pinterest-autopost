const OpenAI = require('openai');
const { extractFrameFromVideo } = require('./frameExtractorService');

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
      // Groq (Llama) does not support multimodal array content, so we extract only text
      const groqOptions = { ...options, model: secondaryConfig.model };
      if (groqOptions.messages) {
        groqOptions.messages = groqOptions.messages.map(m => {
          if (Array.isArray(m.content)) {
            const textPart = m.content.find(part => part.type === 'text');
            return { ...m, content: textPart ? textPart.text : '' };
          }
          return m;
        });
      }
      return await secondaryClient.chat.completions.create(groqOptions);
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
async function identifyProduct({ caption = '', username = '', thumbnailUrl = '', mediaUrl = '' }) {
  let retries = 3;
  while (retries >= 0) {
    try {
      return await identifyProductInternal({ caption, username, thumbnailUrl, mediaUrl });
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

/**
 * Strips useless promotional CTA phrases from an Instagram caption so the AI
 * focuses on real product context rather than "Comment 'link' for product in dm".
 */
function cleanCaption(caption) {
  if (!caption) return '';
  const spamPatterns = [
    /comment ["']?link["']?.{0,30}(dm|inbox|bio)/gi,
    /comment.{0,10}(below|above|here|now).{0,20}(link|product|get)/gi,
    /link in (my )?bio/gi,
    /shop link in bio/gi,
    /dm (me|for|us) (the )?link/gi,
    /click (the )?link in bio/gi,
    /swipe up/gi,
    /tap (the )?link/gi,
    /\ud83d\udc46 follow @\w+.*/gi,
    /follow @\w+.*/gi,
    /💡 style tip:.*/gi,
  ];
  let cleaned = caption;
  for (const pat of spamPatterns) {
    cleaned = cleaned.replace(pat, '');
  }
  // Remove lines that are just hashtags
  cleaned = cleaned.split('\n')
    .filter(line => !(line.trim().startsWith('#') && !line.trim().replace(/#\w+/g, '').trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned;
}

/**
 * Get the best possible image for AI visual analysis.
 * Priority: (1) Video frame at 30% → (2) Thumbnail → (3) null
 * Returns { base64, mimeType } or null.
 */
async function getImageForAI(mediaUrl, thumbnailUrl) {
  // 1. Try video frame extraction (most accurate — clear mid-video product shot)
  if (mediaUrl) {
    try {
      const frame = await extractFrameFromVideo(mediaUrl);
      if (frame) {
        console.log('[AI] ✅ Using extracted video frame for product identification.');
        return frame;
      }
    } catch (e) {
      console.warn('[AI] Video frame extraction failed:', e.message);
    }
  }

  // 2. Fall back to thumbnail
  if (thumbnailUrl) {
    try {
      const fetch = require('node-fetch');
      const imgRes = await fetch(thumbnailUrl, { timeout: 10000 });
      if (imgRes.ok) {
        const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
        if (mimeType.startsWith('image/')) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          console.log('[AI] Using thumbnail as image source (video frame unavailable).');
          return { base64: buffer.toString('base64'), mimeType };
        }
      }
    } catch (e) {
      console.warn('[AI] Thumbnail download failed:', e.message);
    }
  }

  console.warn('[AI] No image available for visual identification.');
  return null;
}


function heuristicIdentifyProduct(caption) {
  const cleaned = cleanCaption(caption);
  const productKeywords = ['sneakers', 'shirt', 'jeans', 'pants', 'watch', 'jacket', 'tshirt', 't-shirt', 'hoodie', 'shorts', 'kurta', 'saree', 'shoes', 'sandals', 'phone', 'gadget', 'perfume', 'bag', 'cap', 'hat'];
  const lower = cleaned.toLowerCase();
  const hasKeyword = productKeywords.some(k => lower.includes(k));

  if (!hasKeyword && cleaned.length < 10) return { found: false };

  // Take the most informative line (longest non-hashtag line)
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 5);
  let productName = (lines[0] || cleaned).substring(0, 80);
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

async function identifyProductInternal({ caption = '', username = '', thumbnailUrl = '', mediaUrl = '' }) {
  if (!primaryClient) {
    return heuristicIdentifyProduct(caption);
  }

  const usefulCaption = cleanCaption(caption);

  const systemPrompt = 'You are an expert AI visual product identifier for affiliate marketing. Your PRIMARY source is the IMAGE — identify the exact product shown visually. The caption is ONLY secondary context and should be IGNORED if it is a generic CTA like "comment link" or "link in bio". Return only valid JSON.';

  const textPrompt = `Instagram Reel from @${username}.
${usefulCaption ? `Additional context from caption: "${usefulCaption.substring(0, 400)}"` : 'Caption: (not useful — use image only)'}

Task: Identify the PRIMARY product visible in the image.
- Look at what the person is WEARING or HOLDING in the photo.
- Identify the EXACT item: type, color, style, and brand if visible (e.g. "Brown Baggy Corduroy Pants", "White Puma Sneakers", "Oversized Denim Jacket").
- If the caption is vague (e.g. "Comment link", "Link in bio"), IGNORE it completely and rely only on the image.
- DO NOT return generic phrases. Be specific about what you SEE.

Return JSON:
{
  "found": true,
  "productName": "specific visual description (e.g. Brown Baggy Corduroy Pants)",
  "exactMatchQuery": "color + style + product type (e.g. Brown Baggy Corduroy Pants Men)",
  "similarMatchQuery": "style + product type (e.g. Baggy Corduroy Pants)",
  "broadMatchQuery": "product type only (e.g. Corduroy Pants Men)",
  "category": "fashion|electronics|home|beauty|other"
}
If no product visible → Return: { "found": false }

Return ONLY the JSON object.`;

  const userMessageContent = [{ type: 'text', text: textPrompt }];

  // Get best image: video frame first, thumbnail fallback
  const imageData = await getImageForAI(mediaUrl, thumbnailUrl);
  if (imageData) {
    userMessageContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageData.mimeType};base64,${imageData.base64}` }
    });
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
async function identifyOutfit({ caption = '', username = '', thumbnailUrl = '', mediaUrl = '' }) {
  if (!primaryClient) {
    return { found: false };
  }

  const usefulCaption = cleanCaption(caption);

  const systemPrompt = `You are an expert AI fashion stylist and visual product identifier. Your PRIMARY source is the IMAGE — identify what is VISIBLE in the photo. The caption is only secondary context; if it says "comment link" or "link in bio", treat the caption as empty and rely entirely on the image. Return only valid JSON.`;

  const textPrompt = `Instagram Reel from @${username}.
${usefulCaption ? `Caption context: "${usefulCaption.substring(0, 400)}"` : 'Caption: (not useful — identify from image only)'}

Task: Look at the IMAGE and identify the FULL outfit of the person shown.
1. 'main': The PRIMARY item they are wearing/showcasing (most prominent). Be SPECIFIC: color + style + type (e.g. "Brown Baggy Corduroy Pants", "White Oversized Cotton T-shirt").
2. Curate 3 complementary items to complete the look. Each query must be a specific, searchable product description.
3. IGNORE any caption text like "comment link", "link in bio", "shop link" — these are irrelevant.

Return ONLY this JSON:
{
  "found": true,
  "outfitName": "Catchy outfit name (e.g. 'Relaxed Streetwear Look')",
  "items": [
    { "type": "main", "query": "Brown Baggy Corduroy Pants Men" },
    { "type": "top", "query": "Oversized White T-shirt Men" },
    { "type": "shoes", "query": "White Casual Sneakers Men" },
    { "type": "accessory", "query": "Silver Chain Necklace Men" }
  ]
}

Return ONLY valid JSON.`;

  const userMessageContent = [{ type: 'text', text: textPrompt }];

  // Get best image: video frame first, thumbnail fallback
  const imageData = await getImageForAI(mediaUrl, thumbnailUrl);
  if (imageData) {
    userMessageContent.push({
      type: 'image_url',
      image_url: { url: `data:${imageData.mimeType};base64,${imageData.base64}` }
    });
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
