'use strict';

// ─── Platform Configuration ───────────────────────────────────────────────────
const PLATFORMS = {
  flipkart: {
    domain: 'flipkart.com',
    isProductUrl: (url) => /flipkart\.com\/[^/]+\/p\//.test(url),
  },
  amazon: {
    domain: 'amazon.in',
    isProductUrl: (url) => /amazon\.in\/(?:[^/]+\/)?dp\/[A-Z0-9]{10}/.test(url),
  },
  myntra: {
    domain: 'myntra.com',
    isProductUrl: (url) => /myntra\.com\/[^/]+\/[^/]+\/\d+\/buy/.test(url),
  },
  ajio: {
    domain: 'ajio.com',
    isProductUrl: (url) => /ajio\.com\/[^/]+-\d+\/p\//.test(url),
  },
  meesho: {
    domain: 'meesho.com',
    isProductUrl: (url) => /meesho\.com\/[^/]+\/p\/\d+/.test(url),
  },
};

const EARNKARO_SUPPORTED = ['flipkart', 'amazon', 'myntra', 'ajio', 'meesho'];

function fetchWithTimeout(url, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

async function searchGoogleCSE(query, domain, options = {}) {
  const { apiKey, cx, num = 5 } = options;
  if (!apiKey || !cx) throw new Error('Google CSE: missing GOOGLE_CSE_KEY or GOOGLE_CSE_CX');

  const siteQuery = `site:${domain} ${query}`;
  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: siteQuery,
    num: String(num),
    gl: 'in',
    hl: 'en',
    cr: 'countryIN',
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params}`;
  const res = await fetchWithTimeout(url, { method: 'GET' }, 10000);

  if (res.status === 429) throw new Error('Google CSE: daily quota exceeded (100/day)');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google CSE: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Google CSE API error: ${data.error.message}`);
  if (!data.items?.length) throw new Error('Google CSE: no results returned');

  return data.items.map((item) => ({ title: item.title, url: item.link }));
}

async function searchSerper(query, domain, options = {}) {
  const { apiKey, num = 5 } = options;
  if (!apiKey) throw new Error('Serper: missing SERPER_API_KEY');

  const res = await fetchWithTimeout(
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `site:${domain} ${query}`,
        gl: 'in',
        hl: 'en',
        num,
      }),
    },
    10000
  );

  if (res.status === 401) throw new Error('Serper: invalid API key');
  if (res.status === 429) throw new Error('Serper: quota exceeded');
  if (!res.ok) throw new Error(`Serper: HTTP ${res.status}`);

  const data = await res.json();
  if (!data.organic?.length) throw new Error('Serper: no organic results');

  return data.organic.map((item) => ({ title: item.title, url: item.link }));
}

async function searchBrave(query, domain, options = {}) {
  const { apiKey, num = 5 } = options;
  if (!apiKey) throw new Error('Brave: missing BRAVE_API_KEY');

  const siteQuery = `site:${domain} ${query}`;
  const params = new URLSearchParams({
    q: siteQuery,
    country: 'in',
    search_lang: 'en',
    count: String(num),
    safesearch: 'off',
  });

  const res = await fetchWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    },
    10000
  );

  if (res.status === 401) throw new Error('Brave: invalid subscription token');
  if (res.status === 429) throw new Error('Brave: rate limit hit');
  if (!res.ok) throw new Error(`Brave: HTTP ${res.status}`);

  const data = await res.json();
  if (!data.web?.results?.length) throw new Error('Brave: no web results');

  return data.web.results.map((r) => ({ title: r.title, url: r.url }));
}

async function findProductUrls(query, opts = {}) {
  const { platform = 'flipkart', strictMatch = true } = opts;

  const config = {
    googleCSE: {
      apiKey: process.env.GOOGLE_CSE_KEY,
      cx: process.env.GOOGLE_CSE_CX,
    },
    serper: {
      apiKey: process.env.SERPER_API_KEY,
    },
    brave: {
      apiKey: process.env.BRAVE_API_KEY,
    },
  };

  const platformsToTry = platform ? [platform] : EARNKARO_SUPPORTED;

  for (const platformKey of platformsToTry) {
    const platformCfg = PLATFORMS[platformKey];
    if (!platformCfg) continue;

    console.log(`\n[search] Querying platform: ${platformKey} (${platformCfg.domain})`);

    const providers = [
      {
        name: 'Google CSE',
        enabled: !!(config.googleCSE.apiKey && config.googleCSE.cx),
        fn: () => searchGoogleCSE(query, platformCfg.domain, config.googleCSE),
      },
      {
        name: 'Serper.dev',
        enabled: !!config.serper.apiKey,
        fn: () => searchSerper(query, platformCfg.domain, config.serper),
      },
      {
        name: 'Brave Search',
        enabled: !!config.brave.apiKey,
        fn: () => searchBrave(query, platformCfg.domain, config.brave),
      },
    ].filter((p) => p.enabled);

    if (providers.length === 0) {
      console.warn('[search] No search providers configured! GOOGLE_CSE_KEY, SERPER_API_KEY, or BRAVE_API_KEY is required.');
      return [];
    }

    for (const provider of providers) {
      try {
        console.log(`  [search] Trying ${provider.name}...`);
        const results = await provider.fn();

        console.log(`  [search] Got ${results.length} results from ${provider.name}`);

        if (strictMatch) {
          const validProducts = results.filter((r) => platformCfg.isProductUrl(r.url));
          if (validProducts.length > 0) {
            console.log(`  [search] ✓ Found ${validProducts.length} strict matches!`);
            return validProducts; // Returns Array of {title, url}
          }
          console.log(`  [search] ✗ No product URL pattern matched.`);
          continue;
        }

        if (results.length > 0) return results;
      } catch (err) {
        console.warn(`  [search] ✗ ${provider.name} failed: ${err.message}`);
      }
    }
  }

  return [];
}

module.exports = { findProductUrls, PLATFORMS, EARNKARO_SUPPORTED };
