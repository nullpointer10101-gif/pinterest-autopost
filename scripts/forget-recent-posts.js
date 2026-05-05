require('dotenv').config();
const historyService = require('../services/historyService');
const igStorageService = require('../services/igStorageService');
const storageService = require('../services/storageService');

async function run() {
  console.log('[Script] Forgetting recent posts without affiliate links...');

  // 1. Remove from Pinterest History
  const posts = await historyService.getAll();
  console.log(`[Script] Total history posts: ${posts.length}`);
  
  // Find posts created today or in the last run without an affiliate link
  // (We can just clear posts that don't have an affiliate link if that's safe, 
  // or just clear the most recent 15 posts)
  const recentPosts = posts.slice(0, 15);
  let removedCount = 0;
  for (const post of recentPosts) {
      // If it has NO affiliate link, remove it from history
      if (!post.destinationLink || !post.destinationLink.includes('fktr.in')) {
          await historyService.remove(post.id);
          removedCount++;
      }
  }
  console.log(`[Script] Removed ${removedCount} posts from Pinterest posting history.`);

  // 2. Remove from IG Tracker Seen List
  const DEFAULT_IG_STATE = { channels: [], seen: {}, channelMeta: {}, affiliateCache: {}, lastRunAt: null };
  const igState = await igStorageService.loadState(DEFAULT_IG_STATE);
  let igRemoved = 0;
  
  if (igState.seen) {
    for (const channel of Object.keys(igState.seen)) {
        if (Array.isArray(igState.seen[channel])) {
            const originalLength = igState.seen[channel].length;
            // Keep only posts older than index 10 (drop the 10 most recent from memory)
            // Or better, just slice the top 5 from each channel
            igState.seen[channel] = igState.seen[channel].slice(5);
            igRemoved += (originalLength - igState.seen[channel].length);
        }
    }
  }
  await igStorageService.saveState(igState);
  console.log(`[Script] Removed ${igRemoved} recent reels from IG Tracker 'seen' memory.`);

  // 3. Reset Daily Counter
  const autoState = await historyService.getAutomationState();
  if (autoState.postsToday > 0) {
      autoState.postsToday = Math.max(0, autoState.postsToday - removedCount);
      await historyService.setAutomationState(autoState);
      console.log(`[Script] Decreased today's post counter by ${removedCount}.`);
  }

  console.log('[Script] Done! The pipeline will now re-process these reels properly on the next run.');
}

run().catch(console.error);
