require('dotenv').config();
const igTrackerService = require('../services/igTrackerService');

async function syncProfilePics() {
  console.log('🚀 Starting profile picture sync for all target channels...');
  
  try {
    const channels = await igTrackerService.getChannels();
    console.log(`Found ${channels.length} channels to sync.`);

    for (const channel of channels) {
      const username = typeof channel === 'string' ? channel : channel.username;
      console.log(`--- Syncing @${username} ---`);
      
      try {
        // fetchLatestReels calls the profile info API which updates the meta (profilePicUrl)
        // We only need the first part of the fetch, but fetchLatestReels is safe.
        // We'll pass a limit of 1 to keep it fast.
        await igTrackerService.fetchLatestReels(username);
        console.log(`✅ Synced @${username}`);
      } catch (err) {
        console.error(`❌ Failed to sync @${username}:`, err.message);
      }
      
      // Sleep to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\n✨ Profile picture sync complete!');
  } catch (err) {
    console.error('Fatal error during sync:', err.message);
  }
}

syncProfilePics();
