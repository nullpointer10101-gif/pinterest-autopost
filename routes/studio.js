const express = require('express');
const router = express.Router();
const instagramService = require('../services/instagramService');
const aiService = require('../services/aiService');
const productCurationService = require('../services/productCurationService');
const autoReelEditorService = require('../services/autoReelEditorService');
const mediaTools = require('../services/mediaToolService');

function absoluteUrl(req, value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  const localBase = `${req.protocol}://${req.get('host')}`;
  const base = clean.startsWith('/generated/')
    ? localBase
    : (process.env.APP_BASE_URL || localBase);
  return `${base.replace(/\/$/, '')}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

async function buildStoreLinks(reelData, aiContent) {
  const empty = {
    affiliateLinks: [],
    productInfo: null,
    mainProductName: '',
    outfitName: '',
    shoppingMission: null,
  };

  try {
    const outfitData = await aiService.identifyOutfit({
      caption: reelData.caption || '',
      username: reelData.username || '',
      thumbnailUrl: reelData.thumbnailUrl || '',
      mediaUrl: reelData.mediaUrl || '',
    });

    if (outfitData?.found && Array.isArray(outfitData.items) && outfitData.items.length) {
      const resolved = await productCurationService.buildSameTypeShelfFromOutfit(outfitData, {
        limit: 4,
        fallbackName: aiContent.title || 'Curated Look',
        logPrefix: '[Studio]',
      });
      return {
        affiliateLinks: resolved.affiliateLinks || [],
        productInfo: {
          name: resolved.outfitName || resolved.mainProductName || 'Curated Look',
          outfit: resolved.affiliateLinks || [],
          shoppingMission: resolved.shoppingMission || null,
        },
        mainProductName: resolved.mainProductName || '',
        outfitName: resolved.outfitName || '',
        shoppingMission: resolved.shoppingMission || null,
      };
    }
  } catch (err) {
    console.warn('[Studio] Outfit/product shelf failed:', err.message);
  }

  try {
    const productData = await aiService.identifyProduct({
      caption: reelData.caption || '',
      username: reelData.username || '',
      thumbnailUrl: reelData.thumbnailUrl || '',
      mediaUrl: reelData.mediaUrl || '',
    });

    if (productData?.found) {
      const resolved = await productCurationService.buildSameTypeShelfFromProductData(productData, {
        limit: 4,
        logPrefix: '[Studio]',
      });
      return {
        affiliateLinks: resolved.affiliateLinks || [],
        productInfo: {
          name: resolved.productTypeLabel ? `${resolved.productTypeLabel} Finds` : resolved.mainProductName || 'Curated Look',
          outfit: resolved.affiliateLinks || [],
          shoppingMission: resolved.shoppingMission || null,
        },
        mainProductName: resolved.mainProductName || '',
        outfitName: resolved.productTypeLabel ? `${resolved.productTypeLabel} Finds` : '',
        shoppingMission: resolved.shoppingMission || null,
      };
    }
  } catch (err) {
    console.warn('[Studio] Single product shelf failed:', err.message);
  }

  return empty;
}

router.get('/health', (req, res) => {
  res.json({
    success: true,
    editor: {
      ffmpeg: mediaTools.isFfmpegAvailable(),
      ffprobe: mediaTools.isFfprobeAvailable(),
      ffmpegPath: mediaTools.resolveFfmpegPath(),
      ffprobePath: mediaTools.resolveFfprobePath(),
      fontPath: mediaTools.getBundledFontPath(),
    },
  });
});

router.post('/auto-edit', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const options = autoReelEditorService.normalizeOptions(req.body?.options || {});

  if (!url) {
    return res.status(400).json({ success: false, error: 'Instagram Reel URL is required.' });
  }

  try {
    const reelData = await instagramService.extractReel(url);
    const aiContent = await aiService.generatePinterestContent({
      caption: reelData.caption || '',
      username: reelData.username || '',
      mediaType: reelData.mediaType || 'video',
    });

    const store = await buildStoreLinks(reelData, aiContent);
    const shortcode = reelData.shortcode || (url.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/)?.[2] || '');
    const appBase = process.env.APP_BASE_URL || 'https://pinterest-autopost.vercel.app';
    const destinationLink = shortcode ? `${appBase.replace(/\/$/, '')}/look/${shortcode}` : '';

    const editResult = await autoReelEditorService.renderAutoEditedReel({
      inputUrl: reelData.mediaUrl || reelData.thumbnailUrl,
      reelData,
      aiContent,
      title: aiContent.title,
      description: aiContent.description,
      shortcode,
      products: store.affiliateLinks,
      options,
      persist: true,
    });

    const previewMediaUrl = editResult.rendered ? absoluteUrl(req, editResult.mediaUrl) : (reelData.mediaUrl || reelData.thumbnailUrl || '');
    const previewThumbnailUrl = editResult.rendered ? absoluteUrl(req, editResult.thumbnailUrl) : (reelData.thumbnailUrl || '');

    return res.json({
      success: true,
      message: editResult.rendered
        ? 'Auto edit rendered. Review it, then queue or post.'
        : `Draft created, but preview render fell back to original media (${editResult.reason || 'unknown'}).`,
      data: {
        sourceUrl: url,
        reelData: {
          ...reelData,
          shortcode,
          originalMediaUrl: reelData.mediaUrl || '',
          previewMediaUrl,
          editedMediaUrl: previewMediaUrl,
          editedThumbnailUrl: previewThumbnailUrl,
          mediaType: 'video',
        },
        aiContent,
        destinationLink,
        affiliateLinks: store.affiliateLinks,
        productInfo: store.productInfo,
        sourcePipeline: 'studio',
        autoEdit: {
          ...options,
          source: 'studio',
          renderedPreview: !!editResult.rendered,
          editId: editResult.editId || '',
          previewMediaUrl,
          previewThumbnailUrl,
          effects: editResult.effects || [],
          fallbackReason: editResult.rendered ? '' : editResult.reason || '',
        },
      },
    });
  } catch (err) {
    console.error('[Studio] Auto edit failed:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
