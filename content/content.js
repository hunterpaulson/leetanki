/**
 * LeetAnki Content Script
 * 
 * Runs on LeetCode pages to handle authentication detection,
 * problem synchronization, and communication with the extension.
 */

// Enable debug mode
const DEBUG = true;

// Helper function for debug logging
function log(...args) {
  if (DEBUG) console.log('[LeetAnki Content]', ...args);
}

// Storage keys for consistent access across components
const STORAGE_KEYS = {
  AUTH_STATUS: 'authStatus',
  USER_INFO: 'userInfo',
  PROBLEMS: 'problems',
  TAGS: 'tags',
  REVIEW_DATA: 'reviewData',
  LAST_SYNC: 'lastSync',
  SETTINGS: 'settings'
};

// Initialize the content script
function initialize() {
  log('Initializing content script');
  
  try {
    // Check authentication status
    checkAuthStatus();
    
    // Set up URL change detection
    setupUrlChangeListener();
    
    // Listen for messages from popup and background script
    setupMessageListeners();
    
    log('Content script initialized successfully');
  } catch (error) {
    console.error('Error initializing content script:', error);
  }
}

// Check user authentication status
async function checkAuthStatus() {
  try {
    log('Checking authentication status');
    
    // Check if user is authenticated using the API
    const authStatus = await window.LeetCodeAPI.checkAuth();
    
    log('Auth status:', authStatus);
    
    // Send auth status to the background script
    chrome.runtime.sendMessage({
      action: 'updateAuthStatus',
      status: authStatus.isAuthenticated,
      userInfo: authStatus.isAuthenticated ? {
        username: authStatus.username,
        userId: authStatus.userId
      } : null
    });
    
    // If authenticated, check if we need to sync
    if (authStatus.isAuthenticated) {
      checkSyncNeeded();
    }
    
    return authStatus;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return { isAuthenticated: false };
  }
}

// Set up listener for URL changes
function setupUrlChangeListener() {
  let lastUrl = window.location.href;
  
  // Use a MutationObserver to detect URL changes
  const observer = new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
      log('URL changed:', window.location.href);
      lastUrl = window.location.href;
      
      // Re-check authentication on URL change
      checkAuthStatus();
    }
  });
  
  // Start observing the document body
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Also hook into history API for SPA navigation
  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    
    if (lastUrl !== window.location.href) {
      log('URL changed via pushState:', window.location.href);
      lastUrl = window.location.href;
      
      // Re-check authentication on URL change
      checkAuthStatus();
    }
  };
}

// Set up message listeners
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('Received message:', message);
    
    // Handle different message types
    switch (message.action) {
      case 'isContentScriptReady':
        sendResponse({ ready: true });
        break;
        
      case 'checkAuthStatus':
        window.LeetCodeAPI.checkAuth()
          .then(status => sendResponse(status))
          .catch(error => {
            console.error('Error checking auth status:', error);
            sendResponse({ isAuthenticated: false });
          });
        return true; // Keep channel open for async response
        
      case 'sync':
        syncProblems()
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error syncing problems:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
        
      case 'getProblemDetails':
        window.LeetCodeAPI.fetchProblemDetails(message.titleSlug)
          .then(problem => sendResponse({ success: true, problem }))
          .catch(error => {
            console.error(`Error fetching problem ${message.titleSlug}:`, error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
    }
  });
}

// Check if a sync is needed
async function checkSyncNeeded() {
  try {
    log('Checking if sync is needed');
    
    // Get auth status and last sync time
    const authStatus = await window.LeetCodeAPI.checkAuth();
    
    if (!authStatus.isAuthenticated) {
      log('Not authenticated, skipping sync check');
      return;
    }
    
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.LAST_SYNC,
      STORAGE_KEYS.SETTINGS
    ]);
    
    const lastSync = data[STORAGE_KEYS.LAST_SYNC];
    const now = new Date();
    
    // Determine if sync is needed
    let syncNeeded = false;
    
    if (!lastSync) {
      // Never synced before
      syncNeeded = true;
      log('Sync needed: First sync');
    } else {
      const lastSyncDate = new Date(lastSync);
      const syncInterval = (data[STORAGE_KEYS.SETTINGS]?.syncInterval || 6) * 60 * 60 * 1000; // Convert hours to ms
      
      if (now - lastSyncDate > syncInterval) {
        // Last sync was more than the sync interval ago
        syncNeeded = true;
        log(`Sync needed: Last sync was ${Math.round((now - lastSyncDate) / (60 * 60 * 1000))} hours ago`);
      }
    }
    
    // Perform sync if needed
    if (syncNeeded) {
      showNotification('Syncing your LeetCode problems...');
      const result = await syncProblems();
      
      if (result.success) {
        showNotification(`Synced ${Object.keys(result.problems).length} problems`, true);
      } else {
        showNotification(`Sync failed: ${result.error}`, true);
      }
    }
  } catch (error) {
    console.error('Error checking if sync needed:', error);
  }
}

// Sync problems from LeetCode
async function syncProblems() {
  try {
    log('Starting problem sync');
    
    // Check authentication
    const authStatus = await window.LeetCodeAPI.checkAuth();
    
    if (!authStatus.isAuthenticated) {
      log('Not authenticated, cannot sync');
      return { success: false, error: 'Not authenticated' };
    }
    
    // Show sync notification
    showNotification('Syncing your LeetCode problems...');
    
    // Step 1: Fetch all tags (for hierarchical knowledge structure)
    log('Fetching all tags');
    const tags = await window.LeetCodeAPI.fetchAllTags();
    log(`Fetched ${Object.keys(tags).length} tags`);
    
    // Step 2: Fetch all solved problems
    log(`Fetching solved problems for ${authStatus.username}`);
    const solvedData = await window.LeetCodeAPI.fetchSolvedProblems(authStatus.username);
    log(`Fetched ${Object.keys(solvedData.problems).length} solved problems`);
    
    // Step 3: Fetch additional details for a sample of problems
    // This will enrich the data with difficulty and tags
    if (Object.keys(solvedData.problems).length > 0) {
      log('Fetching additional problem details...');
      showNotification('Fetching problem details...');
      
      // Take a sample of up to 10 problems to get their details
      // In a real implementation, you might want to batch this for all problems
      const sampleProblems = Object.keys(solvedData.problems).slice(0, 10);
      const problemDetailsMap = await window.LeetCodeAPI.fetchProblemsDetails(sampleProblems);
      
      // Update the problems with the details
      for (const titleSlug of sampleProblems) {
        const details = problemDetailsMap[titleSlug];
        if (details) {
          solvedData.problems[titleSlug].difficulty = details.difficulty;
          solvedData.problems[titleSlug].tags = details.tags.map(tag => tag.slug);
        }
      }
      
      log(`Updated details for ${sampleProblems.length} problems`);
    }
    
    // Step 4: Merge tags data
    const mergedTags = { ...tags };
    Object.entries(solvedData.tags).forEach(([slug, tagData]) => {
      if (mergedTags[slug]) {
        mergedTags[slug].count = tagData.count;
        mergedTags[slug].category = tagData.category;
      }
    });
    
    // Step 4: Send data to background script
    chrome.runtime.sendMessage({
      action: 'syncComplete',
      problems: solvedData.problems,
      tags: mergedTags,
      stats: solvedData.stats
    });
    
    // Show completion notification
    showNotification(`Successfully synced ${Object.keys(solvedData.problems).length} problems`, true);
    
    return {
      success: true,
      problems: solvedData.problems,
      tags: mergedTags,
      stats: solvedData.stats
    };
  } catch (error) {
    console.error('Error syncing problems:', error);
    showNotification(`Sync failed: ${error.message}`, true);
    return { success: false, error: error.message };
  }
}

// Show notification to the user
function showNotification(message, isComplete = false) {
  // Check if notification element already exists
  let notificationEl = document.getElementById('leetanki-notification');
  
  if (!notificationEl) {
    // Create notification element
    notificationEl = document.createElement('div');
    notificationEl.id = 'leetanki-notification';
    
    // Style the notification
    Object.assign(notificationEl.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '10000',
      padding: '12px 16px',
      borderRadius: '8px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      fontSize: '14px',
      transition: 'opacity 0.3s ease',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      display: 'flex',
      alignItems: 'center',
      opacity: '0'
    });
    
    document.body.appendChild(notificationEl);
    
    // Fade in
    setTimeout(() => {
      notificationEl.style.opacity = '1';
    }, 10);
  }
  
  // Update notification content
  if (!isComplete) {
    notificationEl.innerHTML = `
      <div style="display: inline-block; margin-right: 12px; width: 16px; height: 16px; border: 2px solid #f0f0f0; border-top: 2px solid #3498db; border-radius: 50%; animation: leetanki-spin 1s linear infinite;"></div>
      <span>${message}</span>
    `;
    
    // Add animation style if not already added
    if (!document.getElementById('leetanki-styles')) {
      const style = document.createElement('style');
      style.id = 'leetanki-styles';
      style.textContent = `
        @keyframes leetanki-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  } else {
    notificationEl.innerHTML = `
      <div style="display: inline-block; margin-right: 12px; color: #2ecc71;">✓</div>
      <span>${message}</span>
    `;
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      notificationEl.style.opacity = '0';
      setTimeout(() => {
        notificationEl.remove();
      }, 300);
    }, 5000);
  }
}

// Initialize the content script when the page loads
document.addEventListener('DOMContentLoaded', initialize);

// Fallback initialization for cases where DOMContentLoaded already fired
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initialize();
}