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
  PROBLEMS: 'problems',                // Map of problem ID to problem data
  TAGS: 'tags',                        // Map of tag ID to tag data (including hierarchical relationships)
  REVIEW_DATA: 'reviewData',           // Spaced repetition data for each problem
  LAST_SYNC: 'lastSync',               // Timestamp of the last sync
  SETTINGS: 'settings'                 // User settings
};

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
      }
    });
    
    // Set up alarm for daily sync
    chrome.alarms.create('dailySync', { periodInMinutes: 60 }); // 1 hour
    
    // Set up alarm for review check
    chrome.alarms.create('checkReviews', { periodInMinutes: 60 }); // 1 hour
    
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
    const data = await chrome.storage.local.get([STORAGE_KEYS.AUTH_STATUS]);
    
    if (data[STORAGE_KEYS.AUTH_STATUS]) {
      // Find a LeetCode tab or create one
      const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
      
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'sync' });
        log('Sync message sent to tab', tabs[0].id);
      } else {
        log('No LeetCode tab found for sync');
      }
    } else {
      log('User not authenticated, skipping sync');
    }
  } catch (error) {
    console.error('Error triggering sync:', error);
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
  log('Received message:', message);
  
  // Handle auth status change
  if (message.action === 'updateAuthStatus') {
    updateAuthStatus(message.status, message.userInfo)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  // Handle sync complete
  if (message.action === 'syncComplete') {
    handleSyncComplete(message.problems, message.tags)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // Get due reviews
  if (message.action === 'getDueReviews') {
    getDueReviews()
      .then(reviews => sendResponse({ success: true, reviews }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // Record review result
  if (message.action === 'recordReview') {
    recordReview(message.problemId, message.result)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
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

// Handle sync completion
async function handleSyncComplete(problems, tags) {
  log(`Sync complete: ${Object.keys(problems).length} problems, ${Object.keys(tags).length} tags`);
  
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PROBLEMS]: problems,
      [STORAGE_KEYS.TAGS]: tags,
      [STORAGE_KEYS.LAST_SYNC]: new Date().toISOString()
    });
    
    // Check for due reviews after sync
    checkDueReviews();
  } catch (error) {
    console.error('Error handling sync complete:', error);
    throw error;
  }
}

// Get due reviews
async function getDueReviews() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.REVIEW_DATA,
      STORAGE_KEYS.PROBLEMS,
      STORAGE_KEYS.SETTINGS
    ]);
    
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    const problems = data[STORAGE_KEYS.PROBLEMS] || {};
    const now = new Date();
    
    // Find problems due for review
    const dueProblems = Object.entries(reviewData)
      .filter(([_, data]) => new Date(data.nextReview) <= now)
      .sort((a, b) => new Date(a[1].nextReview) - new Date(b[1].nextReview))
      .slice(0, data[STORAGE_KEYS.SETTINGS].reviewsPerDay)
      .map(([problemId, reviewData]) => ({
        ...problems[problemId],
        reviewData
      }));
    
    return dueProblems;
  } catch (error) {
    console.error('Error getting due reviews:', error);
    throw error;
  }
}

// Record a review result
async function recordReview(problemId, result) {
  log(`Recording review for ${problemId}: ${result}`);
  
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.REVIEW_DATA]);
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    
    const problemReview = reviewData[problemId] || {
      easeFactor: 2.5,
      interval: 1,
      consecutiveCorrect: 0,
      history: []
    };
    
    // Update problem review data based on SM-2 algorithm
    const now = new Date();
    const updatedReview = calculateNextReview(problemReview, result);
    
    // Add to history
    updatedReview.history = [
      ...(problemReview.history || []),
      {
        date: now.toISOString(),
        result: result
      }
    ].slice(-10); // Keep last 10 reviews
    
    // Calculate next review date
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + updatedReview.interval);
    updatedReview.nextReview = nextReview.toISOString();
    updatedReview.lastReviewed = now.toISOString();
    
    // Save updated review data
    await chrome.storage.local.set({
      [STORAGE_KEYS.REVIEW_DATA]: {
        ...reviewData,
        [problemId]: updatedReview
      }
    });
    
    // Update badge
    checkDueReviews();
  } catch (error) {
    console.error('Error recording review:', error);
    throw error;
  }
}

// Implement SM-2 algorithm for spaced repetition
function calculateNextReview(review, result) {
  const { easeFactor, interval, consecutiveCorrect } = review;
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
      newConsecutiveCorrect = consecutiveCorrect + 1;
      break;
    case 'again':
      newEaseFactor = Math.max(1.3, easeFactor - 0.3);
      newConsecutiveCorrect = 0;
      break;
    default:
      newEaseFactor = easeFactor;
      newConsecutiveCorrect = consecutiveCorrect;
  }
  
  // Calculate new interval
  if (result === 'again') {
    newInterval = 1; // Reset to 1 day
  } else if (consecutiveCorrect === 0) {
    newInterval = 1;
  } else if (consecutiveCorrect === 1) {
    newInterval = 3;
  } else {
    newInterval = Math.round(interval * newEaseFactor);
  }
  
  // Cap interval at 365 days
  newInterval = Math.min(newInterval, 365);
  
  return {
    easeFactor: newEaseFactor,
    interval: newInterval,
    consecutiveCorrect: newConsecutiveCorrect
  };
}