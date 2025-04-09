/**
 * LeetAnki Content Script
 * 
 * Runs on LeetCode pages to handle authentication detection,
 * problem synchronization, and communication with the extension.
 */

// Enable debug mode for development
const DEBUG_CONTENT = true;

// Helper function for debug logging
function logContent(...args) {
  if (DEBUG_CONTENT) console.log('[LeetAnki-Content]', ...args);
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

// Track current auth state globally in this script
let currentAuthStatus = {
  isAuthenticated: false,
  username: null,
  userSlug: null
};

/**
 * Check LeetCode authentication status using the API module.
 * Sends message to background script ONLY if status changes.
 * Updates the global currentAuthStatus variable.
 */
async function checkAuthStatus() {
  logContent('Checking authentication status...');
  try {
    const userInfo = await window.leetcodeApi.getUserInfo(); 
    const isAuthenticated = userInfo.isSignedIn;
    const username = userInfo.username;
    const userSlug = userInfo.userSlug; // Get userSlug as well

    logContent('Auth check API result:', { isAuthenticated, username, userSlug });

    if (isAuthenticated !== currentAuthStatus.isAuthenticated || username !== currentAuthStatus.username || userSlug !== currentAuthStatus.userSlug) {
      logContent(`Authentication status changed: ${currentAuthStatus.isAuthenticated} -> ${isAuthenticated}. Sending update.`);
      // Update global state, including userSlug
      currentAuthStatus = { isAuthenticated, username, userSlug }; 
      
      chrome.runtime.sendMessage({
        action: 'updateAuthStatus',
        status: isAuthenticated,
        // Include userSlug in userInfo
        userInfo: isAuthenticated ? { username: username, userSlug: userSlug } : null
      }).catch(error => {
         logContent('Error sending auth update to background:', error?.message || error);
      });
    } else {
      logContent('Authentication status unchanged.');
    }
  } catch (error) {
    console.error('Error during checkAuthStatus execution:', error);
    if (currentAuthStatus.isAuthenticated) {
       logContent('Assuming logout due to error during auth check. Updating background...');
       // Clear global state
       currentAuthStatus = { isAuthenticated: false, username: null, userSlug: null }; 
       chrome.runtime.sendMessage({
           action: 'updateAuthStatus',
           status: false,
           userInfo: null
       }).catch(error => {
          logContent('Error sending forced logout update to background:', error?.message || error);
       });
    }
  }
}

/**
 * Get CSRF token from cookies (duplicated from API module for standalone use if needed, though API module is preferred).
 */
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
     try {
        return decodeURIComponent(parts.pop().split(';').shift());
     } catch (e) {
        logContent(`Error decoding cookie ${name}:`, e);
        return null;
     }
  }
  return null;
}

// --- Message Handling ---

let isSyncing = false; // Prevent multiple syncs running concurrently

/**
 * Handle messages from the background script.
 * @param {object} message The message received.
 * @param {chrome.runtime.MessageSender} sender Info about the sender.
 * @param {Function} sendResponse Function to call to send a response.
 * @returns {boolean | undefined} True to indicate async response, undefined otherwise.
 */
async function handleBackgroundMessage(message, sender, sendResponse) {
  logContent('Received message from background:', message.action, message);

  if (message.action === 'sync') {
    logContent('Sync request received.');
    if (isSyncing) {
        logContent('Sync already in progress. Ignoring request.');
        sendResponse({ success: false, message: 'Sync already in progress' });
        return false; // Sync already running, respond synchronously
    }
    
    // Check auth state first using the global variable updated by checkAuthStatus
    if (currentAuthStatus.isAuthenticated && currentAuthStatus.username) {
        isSyncing = true; // Set flag early
        logContent('User is authenticated, fetching stats before starting sync...');
        
        try {
            // Get user slug from the stored auth status
            const userSlug = currentAuthStatus.userSlug; 
            if (!userSlug) {
                 throw new Error('User slug is missing from auth status.');
            }
            
            // Fetch total count first
            const totalProblemCount = await window.leetcodeApi.getUserStats(userSlug);
            logContent(`Total accepted problems count: ${totalProblemCount}`);
            
            // Notify background that sync is starting with the total count
            await chrome.runtime.sendMessage({ 
                action: 'syncStarted', 
                totalCount: totalProblemCount 
            });
            logContent('Sent syncStarted message to background.');

            // Define callbacks
            const progressCallback = (batchData) => {
                chrome.runtime.sendMessage({ action: 'syncProgress', data: batchData }).catch(err => {
                    logContent('Error sending syncProgress to background:', err?.message || err);
                });
            };
            const completionCallback = () => {
                logContent('API module reported sync completion. Notifying background.');
                isSyncing = false;
                chrome.runtime.sendMessage({ action: 'syncComplete' }).catch(err => {
                    logContent('Error sending syncComplete to background:', err?.message || err);
                });
            };
            const errorCallback = (errorMessage) => {
                logContent('API module reported sync error:', errorMessage);
                isSyncing = false;
                chrome.runtime.sendMessage({ action: 'syncError', error: errorMessage }).catch(err => {
                     logContent('Error sending syncError to background:', err?.message || err);
                });
            };

            // Initiate the sync process (don't await, it runs in background)
            window.leetcodeApi.syncAllSubmissions(progressCallback, completionCallback, errorCallback);
            sendResponse({ success: true, message: 'Sync initiated successfully.' });

        } catch (error) {
            console.error('Error during sync initiation (fetching stats or sending start message):', error);
            isSyncing = false; // Reset flag on error
            // Notify background of the error *if* sync didn't even start
            chrome.runtime.sendMessage({ action: 'syncError', error: `Sync initiation failed: ${error.message}` }).catch(err => {
                 logContent('Error sending sync initiation error message:', err?.message || err);
            });
            sendResponse({ success: false, message: `Sync initiation failed: ${error.message}` });
        }
        
    } else {
       logContent('Sync requested but user is not authenticated or username/slug missing. Aborting.');
       sendResponse({ success: false, message: 'User not authenticated or user info missing' });
       return false; // Respond synchronously
    }
    // Return true because we are doing async work (fetching stats, sending messages)
    // before potentially calling sendResponse in the success path of the try block. 
    // The actual syncAllSubmissions runs in the background, but the initiation is async.
    return true; 
  }

  // Handle other potential messages from background
  logContent('Unknown action received:', message.action);
  sendResponse({ success: false, message: `Unknown action: ${message.action}` });
  return false; // Indicate synchronous response
}

/**
 * Initialize the content script.
 * Sets up periodic auth checks and message listener.
 */
async function initialize() {
  // Ensure the leetcodeApi is available
  if (typeof window.leetcodeApi === 'undefined') {
     console.error('[LeetAnki-Content] LeetCode API module (leetcode-api.js) not found! Cannot initialize.');
     setTimeout(initialize, 2000); 
     return;
  }
  logContent('LeetAnki content script initializing...');

  // Perform initial authentication check immediately and store result
  await checkAuthStatus(); // Wait for the first check

  // Periodically check authentication status
  const AUTH_CHECK_INTERVAL = 5 * 60 * 1000; 
  setInterval(checkAuthStatus, AUTH_CHECK_INTERVAL);
  logContent(`Auth status check interval set to ${AUTH_CHECK_INTERVAL / 1000} seconds.`);

  // Listen for messages from the background script or popup
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  logContent('Content script initialization complete. Listening for messages.');
}

// --- Script Execution ---

// Wait for the DOM to be ready before initializing, although API doesn't strictly need it
document.addEventListener('DOMContentLoaded', () => {
    logContent('DOM fully loaded and parsed.');
    initialize();
});

// Add a fallback initialization in case DOMContentLoaded doesn't fire as expected
// or if the script is injected late.
if (document.readyState === "complete" || document.readyState === "interactive") {
    // If loaded late, leetcodeApi might already exist
    if (typeof window.leetcodeApi !== 'undefined') {
       initialize();
    } // Otherwise, the DOMContentLoaded listener should handle it.
  } else {
   // Backup listener just in case
   window.addEventListener('load', initialize, { once: true });
}