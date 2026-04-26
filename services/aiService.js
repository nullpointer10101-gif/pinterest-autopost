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
    (isGemini ? 'gemini-1.5-flash' : 'gpt-4o');

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

module.exports = { generatePinterestContent };
