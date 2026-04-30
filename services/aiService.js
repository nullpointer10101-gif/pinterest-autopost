const OpenAI = require('openai');

function getAIConfig() {
  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.QWEN_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    '';

  const isGemini = apiKey.startsWith('AIza');
  
  const baseURL =
    process.env.AI_BASE_URL ||
    (isGemini ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : '') ||
    process.env.OPENAI_BASE_URL ||
    process.env.QWEN_BASE_URL ||
    '';

  const model =
    process.env.AI_MODEL ||
    (isGemini ? 'gemini-2.0-flash' : 'gpt-4o');

  return { apiKey, baseURL, model, isGemini };
}

const aiConfig = getAIConfig();

let openai = null;
if (aiConfig.apiKey) {
  const clientOptions = { apiKey: aiConfig.apiKey };
  if (aiConfig.baseURL) clientOptions.baseURL = aiConfig.baseURL;
  openai = new OpenAI(clientOptions);
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

// ─── OpenAI Generation ────────────────────────────────────────────────────────
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
    model: aiConfig.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.9,
    max_tokens: 800,
  };

  // Only use json_object for OpenAI, some providers like Gemini 1.5 via OpenAI shim don't like it
  if (!aiConfig.isGemini && aiConfig.model.includes('gpt')) {
    options.response_format = { type: 'json_object' };
  }

  const response = await openai.chat.completions.create(options);

  const raw = response.choices[0].message.content;
  const parsed = JSON.parse(raw);

  // Validate and trim
  return {
    title: (parsed.title || '').substring(0, 100),
    description: (parsed.description || '').substring(0, 500),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 15) : [],
    aiGenerated: true,
  };
}

// ─── Main Export ──────────────────────────────────────────────────────────────
async function generatePinterestContent({ caption = '', username = 'creator', mediaType = 'video' }) {
  if (!openai) {
    console.warn('[AI] No AI API key configured — using fallback generator');
    return fallbackGenerate({ caption, username });
  }

  try {
    return await generateWithAI({ caption, username, mediaType });
  } catch (err) {
    console.warn(`[AI] Provider call failed (model: ${aiConfig.model}), using fallback:`, err.message);
    return fallbackGenerate({ caption, username });
  }
}

// ─── Product Identifier (for IG Affiliate Tracker) ───────────────────────────
/**
 * Analyses an Instagram caption to determine if a physical shoppable product
 * is featured. Returns { found, productName, flipkartQuery, category } or { found: false }.
 */
async function identifyProduct({ caption = '', username = '', thumbnailUrl = '' }) {
  let retries = 2;
  while (retries >= 0) {
    try {
      return await identifyProductInternal({ caption, username, thumbnailUrl });
    } catch (err) {
      if (err.message.includes('429') && retries > 0) {
        console.warn(`[AI] Rate limited (429). Retrying in 10s... (${retries} left)`);
        await new Promise(r => setTimeout(r, 10000));
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
    flipkartQuery: productName, 
    fallbackQuery: productName.split(' ').slice(0, 2).join(' '),
    category: 'other' 
  };
}

async function identifyProductInternal({ caption = '', username = '', thumbnailUrl = '' }) {
  if (!openai) {
    return heuristicIdentifyProduct(caption);
  }

  const systemPrompt = 'You are an AI visual product identifier for affiliate marketing. You must visually analyze the provided image frame from an Instagram reel alongside the caption to determine the exact product being showcased. Be concise and return only valid JSON.';
  
  const textPrompt = `Instagram Reel from @${username}:
Caption: "${caption.substring(0, 600)}"

Task: Identify the exact primary product being promoted in this reel. You must use BOTH the text caption and the provided image frame.
1. The caption often contains the exact product name, brand, or type.
2. The image shows the visual style, color, and design.

Combine BOTH sources of information. If the caption mentions "white sneakers" and the image shows casual white sneakers, your search query should be highly specific to find that exact item.

If YES, a specific physical product is clearly showcased → Return: { "found": true, "productName": "exact product name from caption and image", "flipkartQuery": "4-6 word highly specific search phrase for Flipkart including color and type", "fallbackQuery": "2-3 word generic search phrase (e.g. 'white casual sneakers')", "category": "electronics|fashion|home|beauty|other" }
If NO clear product → Return: { "found": false }

Return ONLY the JSON object. No explanation.`;

  const userMessageContent = [];
  userMessageContent.push({ type: 'text', text: textPrompt });
  
  if (thumbnailUrl) {
    userMessageContent.push({
      type: 'image_url',
      image_url: { url: thumbnailUrl }
    });
  }

  const options = {
    model: aiConfig.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent },
    ],
    temperature: 0.3,
    max_tokens: 150,
  };
  if (!aiConfig.isGemini && aiConfig.model.includes('gpt')) {
    options.response_format = { type: 'json_object' };
  }
  const response = await openai.chat.completions.create(options);
  const raw = response.choices[0].message.content.trim();
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(cleaned);
  if (parsed.found === true && parsed.productName) {
    return {
      found: true,
      productName: parsed.productName,
      flipkartQuery: parsed.flipkartQuery || parsed.productName,
      fallbackQuery: parsed.fallbackQuery || parsed.category || 'other',
      category: parsed.category || 'other',
    };
  }
  return { found: false };
}

/**
 * Generates a high-quality, professional Pinterest comment based on a pin's content.
 */
async function generateEngagementComment({ title, description }) {
  if (!openai) {
    const fallbacks = [
        'Absolutely love this style! ✨',
        'This is such a clean look. 🧥',
        'So inspiring! Thanks for sharing.',
        'Adding this to my mood board for sure.',
        'The details here are incredible.'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  const systemPrompt = `You are a high-end Fashion & Lifestyle Blogger. 
  Your goal is to leave authentic, professional, and helpful comments on Pinterest pins.
  Rules:
  1. Be specific to the content.
  2. Use a positive, authoritative tone.
  3. Keep it to 1-2 sentences.
  4. DO NOT use hashtags. 
  5. DO NOT sound like a bot. No "Great post!", "Cool video!".
  6. Mention a specific detail from the title or description if possible.`;

  const userPrompt = `Generate a comment for this Pin:
  Title: ${title}
  Description: ${description}
  
  Comment:`;

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

    return response.choices[0].message.content.trim().replace(/^"/, '').replace(/"$/, '');
  } catch (err) {
    console.error('[AI] Comment generation failed:', err.message);
    return 'This looks absolutely incredible! ✨';
  }
}

module.exports = { generatePinterestContent, identifyProduct, generateEngagementComment };
