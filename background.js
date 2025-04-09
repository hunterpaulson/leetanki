// LeetAnki - Background Service Worker

// Enable debug mode for development
const DEBUG = true;

// Helper function for debug logging
function log(...args) {
  if (DEBUG) console.log('[LeetAnki]', ...args);
}

// Storage keys for consistent access across components
const STORAGE_KEYS = {
  AUTH_STATUS: 'authStatus',           // Boolean indicating if user is authenticated
  USER_INFO: 'userInfo',               // User information (username, etc.)
  PROBLEMS: 'problems',                // Map of problem titleSlug to problem data {title, difficulty, tags, frontendId}
  TAGS: 'tags',                        // Map of tag slug to tag data {name, problems: [titleSlug]}
  REVIEW_DATA: 'reviewData',           // Spaced repetition data for each problem titleSlug
  LAST_SYNC: 'lastSync',               // Timestamp of the last sync
  SETTINGS: 'settings',                // User settings
  SYNC_STATE: 'submissionSyncState',    // State for the incremental submission sync (used by content script)
  SYNC_STATUS: 'syncStatus'             // { isActive: bool, total: number, processed: number }
};

// Simple lock and queue for handling sync progress messages sequentially
let isProcessingSyncProgress = false;
const syncProgressQueue = [];

// Initialize extension when installed
chrome.runtime.onInstalled.addListener(async () => {
  log('Extension installed');
  
  try {
    // Initialize storage with default values
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTH_STATUS]: false,
      [STORAGE_KEYS.USER_INFO]: null,
      [STORAGE_KEYS.PROBLEMS]: {},
      [STORAGE_KEYS.TAGS]: {},
      [STORAGE_KEYS.REVIEW_DATA]: {},
      [STORAGE_KEYS.LAST_SYNC]: null,
      [STORAGE_KEYS.SETTINGS]: {
        syncInterval: 1,         // Hours between syncs
        reviewsPerDay: 1,       // Target daily reviews
        notificationsEnabled: true
      },
      [STORAGE_KEYS.SYNC_STATUS]: { isActive: false, total: 0, processed: 0 }
    });
    
    // Set up alarm for daily sync
    chrome.alarms.create('dailySync', { periodInMinutes: 60 }); // Reduced for testing
    
    // Set up alarm for review check
    chrome.alarms.create('checkReviews', { periodInMinutes: 60 }); // Check hourly
    
    log('Initialization complete');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  log(`Alarm triggered: ${alarm.name}`);
  
  if (alarm.name === 'dailySync') {
    triggerSync();
  } else if (alarm.name === 'checkReviews') {
    checkDueReviews();
  }
});

// Trigger a sync with LeetCode
async function triggerSync() {
  log('Triggering sync');
  try {
    // Check if already syncing
    const syncStatusResult = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATUS);
    if (syncStatusResult[STORAGE_KEYS.SYNC_STATUS]?.isActive) {
        log('Sync trigger skipped: Sync already active.');
        return;
    }

    const data = await chrome.storage.local.get([STORAGE_KEYS.AUTH_STATUS]);
    if (data[STORAGE_KEYS.AUTH_STATUS]) {
      // Find a LeetCode tab or create one
      const tabs = await chrome.tabs.query({ url: '*://leetcode.com/*' }); // More robust URL matching

      if (tabs.length > 0) {
        // Reset sync status before starting
        await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATUS]: { isActive: true, total: 0, processed: 0 } });
        chrome.tabs.sendMessage(tabs[0].id, { action: 'sync' }).catch(err => {
            console.error('Error sending sync message to tab:', tabs[0].id, err);
             // Reset sync status on error sending message
             chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATUS]: { isActive: false, total: 0, processed: 0 } });
        });
        log('Sync message sent to tab', tabs[0].id);
      } else {
        log('No active LeetCode tab found to initiate sync.');
        // Optionally: Notify user? Create a tab?
      }
    } else {
      log('User not authenticated, skipping sync trigger.');
    }
  } catch (error) {
    console.error('Error triggering sync:', error);
    // Ensure sync status is reset on unexpected error
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATUS]: { isActive: false, total: 0, processed: 0 } }).catch(e => console.error("Failed to reset sync status on error:", e));
  }
}

// Check for problems due for review
async function checkDueReviews() {
  log('Checking for due reviews');
  
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_STATUS,
      STORAGE_KEYS.REVIEW_DATA,
      STORAGE_KEYS.SETTINGS
    ]);
    
    if (!data[STORAGE_KEYS.AUTH_STATUS]) {
      log('User not authenticated, skipping review check');
      return;
    }
    
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    const now = new Date();
    
    // Find due problems
    const dueProblems = Object.entries(reviewData)
      .filter(([_, data]) => new Date(data.nextReview) <= now)
      .map(([problemId, _]) => problemId);
    
    log(`Found ${dueProblems.length} problems due for review`);
    
    if (dueProblems.length > 0 && data[STORAGE_KEYS.SETTINGS].notificationsEnabled) {
      // Update badge to show count
      chrome.action.setBadgeText({ text: dueProblems.length.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#4285F4' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.error('Error checking reviews:', error);
  }
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('Received message:', message.action, message); // Log action for clarity
  
  // Handle auth status change
  if (message.action === 'updateAuthStatus') {
    updateAuthStatus(message.status, message.userInfo)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
          console.error('Error in updateAuthStatus handler:', error);
          sendResponse({ success: false, error: error.message });
       });
    return true; // Keep channel open for async response
  }
  
  // Handle sync started (with total count)
  if (message.action === 'syncStarted') {
      log('Sync started message received', message);
      chrome.storage.local.set({ 
          [STORAGE_KEYS.SYNC_STATUS]: { 
              isActive: true, 
              total: message.totalCount || 0, 
              processed: 0 
          }
      }).then(() => sendResponse({ success: true }))
        .catch(err => {
            console.error("Failed to set syncStarted status:", err);
            sendResponse({ success: false, error: err.message });
         });
      return true; // Async storage operation
  }
  
  // Handle sync progress batch (Queueing mechanism)
  if (message.action === 'syncProgress') {
    // Add the message data to the queue
    syncProgressQueue.push(message.data);
    log(`Added batch to queue. Queue size: ${syncProgressQueue.length}`);
    // Trigger processing if not already running
    processSyncProgressQueue(); 
    // Acknowledge receipt immediately
    sendResponse({ success: true }); 
    return false; // Indicate synchronous response to this message
  }
  
  // Handle sync complete
  if (message.action === 'syncComplete') {
    handleSyncComplete() // Modified to mainly finalize
      .then(() => sendResponse({ success: true }))
      .catch(error => {
          console.error('Error in syncComplete handler:', error);
          sendResponse({ success: false, error: error.message });
       });
    return true;
  }
  
  // Handle sync error
  if (message.action === 'syncError') {
    console.error('Sync error reported from content script:', message.error);
    // Mark sync as inactive and clear progress
    chrome.storage.local.set({ 
        [STORAGE_KEYS.SYNC_STATUS]: { isActive: false, total: 0, processed: 0 }
    }).then(() => {
        // Optionally: Reset API sync state in content script?
        // chrome.storage.local.remove(STORAGE_KEYS.SYNC_STATE);
        sendResponse({ success: true });
    }).catch(err => {
        console.error("Failed to set syncError status:", err);
        sendResponse({ success: false, error: err.message });
    });
    return true; // Async storage operation
  }
  
  // Get sync status
  if (message.action === 'getSyncStatus') {
      chrome.storage.local.get(STORAGE_KEYS.SYNC_STATUS)
          .then(result => {
              sendResponse({ success: true, status: result[STORAGE_KEYS.SYNC_STATUS] || { isActive: false, total: 0, processed: 0 } });
          })
          .catch(err => {
              console.error("Failed to get sync status:", err);
              sendResponse({ success: false, error: err.message });
          });
      return true; // Async storage operation
  }
  
  // Get due reviews
  if (message.action === 'getDueReviews') {
    getDueReviews()
      .then(reviews => sendResponse({ success: true, reviews }))
      .catch(error => {
          console.error('Error in getDueReviews handler:', error);
          sendResponse({ success: false, error: error.message });
       });
    return true;
  }
  
  // Record review result
  if (message.action === 'recordReview') {
    recordReview(message.problemId, message.result) // problemId should be titleSlug
      .then(() => {
        checkDueReviews(); // Re-check reviews immediately after recording to update badge
        sendResponse({ success: true });
      })
      .catch(error => {
          console.error('Error in recordReview handler:', error);
          sendResponse({ success: false, error: error.message });
       });
    return true;
  }
  
  // Default case for unhandled messages
  log('Unhandled message action:', message.action);
  sendResponse({ success: false, error: 'Unknown action' });
  return false;
});

// Update authentication status
async function updateAuthStatus(status, userInfo) {
  log(`Updating auth status: ${status}`);
  
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTH_STATUS]: status,
      [STORAGE_KEYS.USER_INFO]: userInfo
    });
    
    if (status) {
      // Trigger a sync when user is authenticated
      setTimeout(triggerSync, 2000);
    } else {
      // Clear badge when logged out
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.error('Error updating auth status:', error);
    throw error;
  }
}

// Function to process the sync progress queue sequentially
async function processSyncProgressQueue() {
    if (isProcessingSyncProgress || syncProgressQueue.length === 0) {
        // Already processing or queue is empty
        return;
    }

    isProcessingSyncProgress = true;
    const batchData = syncProgressQueue.shift(); // Get the next batch from the front
    log(`Processing batch from queue. Remaining: ${syncProgressQueue.length}`);

    try {
        // Call the original handler function for the specific batch
        await handleSingleSyncProgressBatch(batchData);
    } catch (error) {
        // Log error but continue processing the queue
        console.error('Error processing sync progress batch:', error);
    } finally {
        isProcessingSyncProgress = false;
        // Check if there are more items in the queue and process next
        if (syncProgressQueue.length > 0) {
            // Use setTimeout to avoid deep recursion / potential stack overflow on large queues
            setTimeout(processSyncProgressQueue, 0); 
        }
    }
}

// Renamed original handler to process a single batch
async function handleSingleSyncProgressBatch(batchData) {
  log(`Handling single sync progress batch: ${batchData.length} items`);
  if (!batchData || batchData.length === 0) {
    return; // Nothing to process
  }

  let newlyProcessedCount = 0;

  try {
    // Fetch current state - *This is the core change: fetch fresh data for each batch*
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROBLEMS,
      STORAGE_KEYS.TAGS,
      STORAGE_KEYS.REVIEW_DATA
      // Don't fetch SYNC_STATUS here, update it separately later
    ]);

    const problems = data[STORAGE_KEYS.PROBLEMS] || {};
    const tags = data[STORAGE_KEYS.TAGS] || {};
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    let changesMade = false;

    for (const item of batchData) {
      const { problemData, acceptedTimestamp } = item;
      const slug = problemData?.titleSlug; // Optional chaining

      if (!slug) {
        console.warn('Skipping item in batch due to missing titleSlug:', item);
        continue;
      }

      // Flag to track if this specific problem is new *in this batch processing*
      let isNewProblem = false;

      // 1. Update Problems Store
      if (!problems[slug]) {
        isNewProblem = true;
        problems[slug] = {
          title: problemData.title,
          titleSlug: problemData.titleSlug,
          difficulty: problemData.difficulty,
          frontendId: problemData.questionFrontendId,
          tags: problemData.topicTags ? problemData.topicTags.map(t => t.slug) : [], // Store tag slugs
          url: problemData.url // Store URL if available from API
        };
        changesMade = true;
        log(`Added new problem: ${slug}`);
      } else {
         // Optionally update existing problem data if needed (e.g., tags, difficulty)
         // Example: Update tags if they changed
         const currentTags = new Set(problems[slug].tags || []);
         const newTags = new Set(problemData.topicTags ? problemData.topicTags.map(t => t.slug) : []);
         if (currentTags.size !== newTags.size || ![...currentTags].every(tag => newTags.has(tag))) {
             problems[slug].tags = [...newTags];
             changesMade = true;
             log(`Updated tags for existing problem: ${slug}`);
         }
      }

      // 2. Update Tags Store
      if (problemData.topicTags) {
        for (const tag of problemData.topicTags) {
          if (!tags[tag.slug]) {
            tags[tag.slug] = { name: tag.name, problems: new Set() };
            changesMade = true;
            log(`Added new tag: ${tag.slug}`);
          }
          // Ensure problems is a Set before adding
          if (!(tags[tag.slug].problems instanceof Set)) {
             tags[tag.slug].problems = new Set(tags[tag.slug].problems || []);
          }
          if (!tags[tag.slug].problems.has(slug)) {
             tags[tag.slug].problems.add(slug);
             changesMade = true;
          }
        }
      }

      // 3. Initialize SRS Data (if not already present)
      if (!reviewData[slug]) {
        isNewProblem = true; // Also count SRS initialization as new
        const firstAcceptedDate = new Date(acceptedTimestamp);

        reviewData[slug] = {
          easeFactor: 2.5,
          interval: 1,
          consecutiveCorrect: 0, 
          nextReview: new Date(firstAcceptedDate.setDate(firstAcceptedDate.getDate() + 1)).toISOString(), 
          lastReviewed: new Date(acceptedTimestamp).toISOString(), 
          history: [{ date: new Date(acceptedTimestamp).toISOString(), result: 'accepted' }]
        };
        changesMade = true;
        log(`Initialized review data for: ${slug}`);
      }
      
      // Increment count if it's a newly added problem/SRS entry
      if (isNewProblem) {
          newlyProcessedCount++;
      }
    }

    // Save changes if any were made
    if (changesMade) {
       // Convert Sets back to arrays for storage
       const storableTags = {};
        for (const [slug, tagData] of Object.entries(tags)) {
            storableTags[slug] = {
                ...tagData,
                problems: Array.from(tagData.problems instanceof Set ? tagData.problems : new Set(tagData.problems || []))
            };
        }

       log('Saving updated problems, tags, and review data...');
       await chrome.storage.local.set({
         [STORAGE_KEYS.PROBLEMS]: problems,
         [STORAGE_KEYS.TAGS]: storableTags, // Save the converted tags
         [STORAGE_KEYS.REVIEW_DATA]: reviewData
       });
       log('Storage updated for batch.');
    }

    // Update sync progress count separately after saving data
    if (newlyProcessedCount > 0) {
        const statusResult = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATUS);
        const currentStatus = statusResult[STORAGE_KEYS.SYNC_STATUS] || { isActive: true, total: 0, processed: 0 };
        currentStatus.processed += newlyProcessedCount;
        await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATUS]: currentStatus });
        log(`Updated sync progress: ${currentStatus.processed} / ${currentStatus.total}`);
    }

  } catch (error) {
    console.error('Error handling single sync progress batch:', error);
    throw error; // Re-throw to be caught by processSyncProgressQueue
  }
}

// Handle sync completion
async function handleSyncComplete() {
  log(`Sync complete message received.`);
  try {
    // Ensure all queued progress messages are processed before finalizing
    while (isProcessingSyncProgress || syncProgressQueue.length > 0) {
        log('Waiting for sync progress queue to empty before completing...');
        await new Promise(resolve => setTimeout(resolve, 200)); // Wait briefly
    }
    
    log('Sync progress queue empty. Finalizing sync completion.');
    const finalStatusResult = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATUS);
    const finalStatus = finalStatusResult[STORAGE_KEYS.SYNC_STATUS] || { isActive: false, total: 0, processed: 0 };
    
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_SYNC]: new Date().toISOString(),
      [STORAGE_KEYS.SYNC_STATUS]: { ...finalStatus, isActive: false } // Mark as inactive
    });
    log(`Sync marked as complete. Last sync time updated. Final count: ${finalStatus.processed}`);
    await checkDueReviews(); // Check reviews now that sync is done
  } catch (error) {
    console.error('Error handling sync complete:', error);
    // Attempt to mark as inactive even on error
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATUS]: { isActive: false, total: 0, processed: 0 } }).catch(e=>console.error("Failed to set inactive on syncComplete error:", e));
    throw error;
  }
}

// Make sure getDueReviews uses titleSlug
async function getDueReviews() {
  log("Fetching due reviews..."); // Added log
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.REVIEW_DATA,
      STORAGE_KEYS.PROBLEMS,
      STORAGE_KEYS.SETTINGS
    ]);

    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    const problems = data[STORAGE_KEYS.PROBLEMS] || {};
    const settings = data[STORAGE_KEYS.SETTINGS] || { reviewsPerDay: 5 }; // Provide default
    const now = new Date();

    // Find problems due for review
    const dueProblemSlugs = Object.entries(reviewData)
      .filter(([slug, data]) => data.nextReview && new Date(data.nextReview) <= now) // Add check for nextReview existence
      .sort((a, b) => new Date(a[1].nextReview) - new Date(b[1].nextReview)) // Sort by next review date
      .map(([slug, _]) => slug); // Get only the slugs

     log(`Found ${dueProblemSlugs.length} due problem slugs.`);

    // Select top N based on settings and enrich with problem details
    const dueReviews = dueProblemSlugs
      .slice(0, settings.reviewsPerDay)
      .map(slug => {
        const problemDetails = problems[slug];
        if (!problemDetails) {
            log(`Warning: Problem details not found for due slug: ${slug}`);
            return null; // Or return a minimal object
        }
        return {
          ...problemDetails, // title, difficulty, frontendId, tags array etc.
          reviewData: reviewData[slug] // easeFactor, interval, nextReview etc.
        };
      })
      .filter(item => item !== null); // Filter out any nulls from missing details

     log(`Returning ${dueReviews.length} enriched due reviews.`);
    return dueReviews;
  } catch (error) {
    console.error('Error getting due reviews:', error);
    throw error;
  }
}

// Make sure recordReview uses titleSlug as problemId
async function recordReview(problemSlug, result) { // Renamed param for clarity
  log(`Recording review for ${problemSlug}: ${result}`);

  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.REVIEW_DATA]);
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};

    // Ensure the problem exists in review data, maybe synced previously
    if (!reviewData[problemSlug]) {
       log(`Warning: Attempting to record review for unknown problem: ${problemSlug}. Initializing.`);
       // Optionally initialize it here, though ideally it should exist from sync
        reviewData[problemSlug] = {
             easeFactor: 2.5, interval: 1, consecutiveCorrect: 0, history: [],
             nextReview: new Date().toISOString(), // Set next review for immediate check? Or based on result?
             lastReviewed: new Date().toISOString()
        };
    }

    const problemReview = reviewData[problemSlug];

    // Update problem review data based on SM-2 algorithm
    const now = new Date();
    const updatedReview = calculateNextReview(problemReview, result); // SM-2 logic remains the same

    // Add to history
    updatedReview.history = [
      ...(problemReview.history || []).slice(-9), // Keep last 9 + the new one = 10
      {
        date: now.toISOString(),
        result: result
      }
    ];

    // Calculate next review date
    const nextReviewDate = new Date();
    // Ensure interval is at least 1 day if not 'again'
    const intervalDays = Math.max(1, updatedReview.interval);
    nextReviewDate.setDate(nextReviewDate.getDate() + intervalDays);
    updatedReview.nextReview = nextReviewDate.toISOString();
    updatedReview.lastReviewed = now.toISOString();

    // Save updated review data
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_DATA]: {
        ...reviewData,
        [problemSlug]: updatedReview // Use problemSlug as the key
      }
    });

    log(`Review recorded for ${problemSlug}. Next review: ${updatedReview.nextReview}`);
    // Badge update will be handled by the checkDueReviews call in the message listener

  } catch (error) {
    console.error(`Error recording review for ${problemSlug}:`, error);
    throw error;
  }
}

// Implement SM-2 algorithm for spaced repetition (ensure it returns the updated review object parts)
function calculateNextReview(review, result) {
  // Default values if review object is incomplete
  const easeFactor = review.easeFactor ?? 2.5;
  const interval = review.interval ?? 1;
  const consecutiveCorrect = review.consecutiveCorrect ?? 0;

  let newEaseFactor, newInterval, newConsecutiveCorrect;

  // Adjust parameters based on result
  switch (result) {
    case 'easy':
      newEaseFactor = easeFactor + 0.15;
      newConsecutiveCorrect = consecutiveCorrect + 1;
      break;
    case 'good':
      newEaseFactor = easeFactor;
      newConsecutiveCorrect = consecutiveCorrect + 1;
      break;
    case 'hard':
      newEaseFactor = Math.max(1.3, easeFactor - 0.15);
      newConsecutiveCorrect = 0; // Treat 'hard' as needing more practice soon, reset streak
      break;
    case 'again':
      newEaseFactor = Math.max(1.3, easeFactor - 0.20); // Slightly harsher penalty
      newConsecutiveCorrect = 0; // Reset streak
      break;
    default: // Should not happen, but handle defensively
       log(`Warning: Unknown review result '${result}'`);
      newEaseFactor = easeFactor;
      newConsecutiveCorrect = consecutiveCorrect;
  }

   // Ensure ease factor doesn't go below minimum
   newEaseFactor = Math.max(1.3, newEaseFactor);

  // Calculate new interval
  if (result === 'again') {
    newInterval = 1; // Reset interval to 1 day
  } else if (newConsecutiveCorrect === 0 && result === 'hard') {
     newInterval = Math.max(1, Math.ceil(interval * 0.8)); // Reduce interval slightly for 'hard', min 1 day
  } else if (newConsecutiveCorrect <= 1) {
     // First or second correct repetition (after potential reset)
     newInterval = newConsecutiveCorrect === 0 ? 1 : 3; // 1 day then 3 days
  } else {
    // Subsequent correct repetitions
    newInterval = Math.ceil(interval * newEaseFactor);
  }

  // Cap interval at a reasonable maximum (e.g., 1 year)
  newInterval = Math.min(newInterval, 365);
  // Ensure interval is at least 1 day
  newInterval = Math.max(1, newInterval);


  return {
    easeFactor: newEaseFactor,
    interval: newInterval,
    consecutiveCorrect: newConsecutiveCorrect
    // nextReview and lastReviewed are set in recordReview
    // history is updated in recordReview
  };
}

// Ensure checkDueReviews is awaited where necessary (e.g., after syncComplete)
// Check and update badge based on due reviews
async function checkDueReviews() {
  log('Checking for due reviews to update badge...');
  try {
     // Reuse getDueReviews logic, but we only need the count here
     const data = await chrome.storage.local.get([STORAGE_KEYS.REVIEW_DATA, STORAGE_KEYS.SETTINGS]);
     const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
     const settings = data[STORAGE_KEYS.SETTINGS] || {};
     const now = new Date();

     const dueCount = Object.values(reviewData)
       .filter(data => data.nextReview && new Date(data.nextReview) <= now)
       .length;

     log(`Found ${dueCount} problems due for review (for badge update).`);

     const notificationsEnabled = settings.notificationsEnabled ?? true; // Default to true

     if (dueCount > 0 && notificationsEnabled) {
       // Update badge to show count
       chrome.action.setBadgeText({ text: dueCount.toString() });
       chrome.action.setBadgeBackgroundColor({ color: '#4285F4' }); // Blue badge
       log(`Badge updated to ${dueCount}`);
     } else {
       chrome.action.setBadgeText({ text: '' });
       log('Badge cleared.');
     }
   } catch (error) {
     console.error('Error checking reviews for badge update:', error);
     // Don't throw here, badge update isn't critical path
   }
}