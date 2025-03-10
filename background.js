// LeetAnki - Background Service Worker

// Enable debug mode
const debugMode = true;

// Helper function for debug logging
function debugLog(...args) {
  if (debugMode) {
    console.log('[LeetAnki Background]', ...args);
  }
}

// Define storage keys
const STORAGE_KEYS = {
  AUTH_STATUS: 'authStatus',
  USER_INFO: 'userInfo',
  USER_PROFILE: 'userProfile',
  COMPLETED_PROBLEMS: 'completedProblems',
  PROBLEM_TYPES: 'problemTypes',
  PROBLEM_METADATA: 'problemMetadata',
  SPACED_REPETITION_DATA: 'spacedRepetitionData',
  LAST_SYNC: 'lastSync',
  USER_SETTINGS: 'userSettings'
};

// Initialize the extension when installed
chrome.runtime.onInstalled.addListener(async () => {
  debugLog('Extension installed');
  
  try {
    // Initialize storage with default values
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTH_STATUS]: false,
      [STORAGE_KEYS.LAST_SYNC]: null,
      [STORAGE_KEYS.USER_INFO]: null,
      [STORAGE_KEYS.USER_PROFILE]: null,
      [STORAGE_KEYS.COMPLETED_PROBLEMS]: [],
      [STORAGE_KEYS.PROBLEM_TYPES]: {},
      [STORAGE_KEYS.PROBLEM_METADATA]: {},
      [STORAGE_KEYS.SPACED_REPETITION_DATA]: {},
      [STORAGE_KEYS.USER_SETTINGS]: {
        reminderInterval: 24, // in hours
        difficultyLevels: ['Easy', 'Medium', 'Hard'],
        syncOnStartup: true,
        notificationsEnabled: true,
        autoSyncInterval: 24, // in hours
        maxProblemsToStore: 2000, // limit to avoid storage issues
        syncSubmissions: true
      }
    });
    
    // Set up periodic alarm to check for problems that need review
    chrome.alarms.create('checkReviewNeeded', {
      periodInMinutes: 60 // Check every hour
    });
    
    // Set up alarm for daily sync
    chrome.alarms.create('dailySync', {
      periodInMinutes: 1440 // Once a day (24 hours)
    });
    
    debugLog('Initialization complete');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  try {
    debugLog('Alarm triggered:', alarm.name);
    
    if (alarm.name === 'checkReviewNeeded') {
      checkProblemsForReview();
    } else if (alarm.name === 'dailySync') {
      triggerDailySync();
    }
  } catch (error) {
    console.error('Error handling alarm:', error);
  }
});

// Function to check for problems due for review
async function checkProblemsForReview() {
  try {
    debugLog('Checking for problems due for review');
    
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_STATUS, 
      STORAGE_KEYS.SPACED_REPETITION_DATA, 
      STORAGE_KEYS.USER_SETTINGS
    ]);
    
    // Only check if user is authenticated
    if (!data[STORAGE_KEYS.AUTH_STATUS]) {
      debugLog('User not authenticated, skipping review check');
      return;
    }
    
    // Check if notifications are enabled
    if (!data[STORAGE_KEYS.USER_SETTINGS]?.notificationsEnabled) {
      debugLog('Notifications disabled, skipping review check');
      return;
    }
    
    // Implement logic to determine which problems need review
    // This will be expanded in Phase 3
    debugLog('Review check complete');
  } catch (error) {
    console.error('Error checking problems for review:', error);
  }
}

// Function to trigger daily sync
async function triggerDailySync() {
  try {
    debugLog('Triggering daily sync');
    
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_STATUS, 
      STORAGE_KEYS.USER_SETTINGS,
      STORAGE_KEYS.USER_INFO
    ]);
    
    // Only sync if user is authenticated and setting is enabled
    if (data[STORAGE_KEYS.AUTH_STATUS] && data[STORAGE_KEYS.USER_SETTINGS]?.syncOnStartup) {
      debugLog('User authenticated and sync enabled, proceeding with sync');
      
      // Find a tab with LeetCode open
      const leetCodeTabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
      
      if (leetCodeTabs.length > 0) {
        // Send message to the content script to sync
        chrome.tabs.sendMessage(leetCodeTabs[0].id, { 
          action: 'fetchSolvedProblems' 
        }, (response) => {
          if (chrome.runtime.lastError) {
            debugLog('Error sending message to tab:', chrome.runtime.lastError);
          } else {
            debugLog('Sync request sent to tab, response:', response);
          }
        });
      } else {
        debugLog('No LeetCode tabs open for sync');
        // Optionally, we could open one in the background here
      }
    } else {
      debugLog('Sync skipped - auth status:', data[STORAGE_KEYS.AUTH_STATUS], 
               'sync enabled:', data[STORAGE_KEYS.USER_SETTINGS]?.syncOnStartup);
    }
  } catch (error) {
    console.error('Error triggering daily sync:', error);
  }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    debugLog('Received message:', message.action);
    
    if (message.action === 'authStatusChanged') {
      updateAuthStatus(message.status, message.userInfo)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Error updating auth status:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.action === 'syncCompletedProblems') {
      syncCompletedProblems()
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Error syncing completed problems:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.action === 'userProfileUpdated') {
      updateUserProfile(message.profile)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Error updating user profile:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.action === 'getAuthStatus') {
      getAuthStatus()
        .then(status => {
          debugLog('Returning auth status:', status.isAuthenticated);
          sendResponse(status);
        })
        .catch(error => {
          console.error('Error getting auth status:', error);
          sendResponse({ error: error.message });
        });
    } else if (message.action === 'problemCompleted') {
      handleProblemCompleted(message.problem)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Error handling problem completion:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.action === 'updateSolvedProblems') {
      updateSolvedProblems(message.solvedProblems, message.source, message.timestamp)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Error updating solved problems:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else if (message.action === 'needSubmissionsPage') {
      handleSubmissionsPageRequest(message.username)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Error handling submissions page request:', error);
          sendResponse({ success: false, error: error.message });
        });
    } else {
      debugLog('Unknown message action:', message.action);
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  // Return true to indicate we'll respond asynchronously
  return true;
});

// Function to get current authentication status
async function getAuthStatus() {
  try {
    debugLog('Getting authentication status');
    
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_STATUS,
      STORAGE_KEYS.USER_INFO,
      STORAGE_KEYS.USER_PROFILE
    ]);
    
    return {
      isAuthenticated: data[STORAGE_KEYS.AUTH_STATUS],
      userInfo: data[STORAGE_KEYS.USER_INFO],
      userProfile: data[STORAGE_KEYS.USER_PROFILE]
    };
  } catch (error) {
    console.error('Error getting auth status:', error);
    throw error;
  }
}

// Function to update authentication status
async function updateAuthStatus(status, userInfo) {
  try {
    debugLog('Updating authentication status:', status);
    
    // Update storage with new authentication status
    await chrome.storage.local.set({ 
      [STORAGE_KEYS.AUTH_STATUS]: status,
      [STORAGE_KEYS.USER_INFO]: userInfo
    });
    
    // If user just logged in, trigger a sync
    if (status && userInfo) {
      debugLog('User logged in:', userInfo.username);
      await syncCompletedProblems();
    } else if (!status) {
      debugLog('User logged out');
    }
  } catch (error) {
    console.error('Error updating auth status:', error);
    throw error;
  }
}

// Function to update user profile information
async function updateUserProfile(profile) {
  try {
    if (!profile) {
      debugLog('No profile data provided');
      return;
    }
    
    debugLog('Updating user profile');
    
    // Get existing profile to merge with new data
    const data = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
    const existingProfile = data[STORAGE_KEYS.USER_PROFILE] || {};
    
    // Merge profiles, with new data taking precedence
    const updatedProfile = {
      ...existingProfile,
      ...profile,
      lastUpdated: new Date().toISOString()
    };
    
    // Save updated profile
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: updatedProfile });
    debugLog('User profile updated:', updatedProfile);
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
}

// Function to handle when a problem is newly completed
async function handleProblemCompleted(problemData) {
  try {
    if (!problemData) {
      debugLog('Invalid problem data');
      return;
    }
    
    debugLog('Problem completed:', problemData.title);
    
    // Get existing completed problems
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.COMPLETED_PROBLEMS,
      STORAGE_KEYS.PROBLEM_METADATA,
      STORAGE_KEYS.SPACED_REPETITION_DATA
    ]);
    
    const completedProblems = data[STORAGE_KEYS.COMPLETED_PROBLEMS] || [];
    const problemMetadata = data[STORAGE_KEYS.PROBLEM_METADATA] || {};
    const spacedRepetitionData = data[STORAGE_KEYS.SPACED_REPETITION_DATA] || {};
    
    // Check if this problem is already in our list
    const existingIndex = completedProblems.findIndex(p => p.titleSlug === problemData.titleSlug);
    
    // Update problem metadata regardless of whether it's new
    problemMetadata[problemData.titleSlug] = {
      id: problemData.id,
      title: problemData.title,
      difficulty: problemData.difficulty,
      topics: problemData.topics || [],
      lastUpdated: new Date().toISOString()
    };
    
    if (existingIndex === -1) {
      // New problem, add to the list
      completedProblems.push({
        titleSlug: problemData.titleSlug,
        completedAt: problemData.completedAt || new Date().toISOString(),
        url: problemData.url
      });
      
      debugLog('Added new completed problem:', problemData.title);
      
      // Initialize spaced repetition data for this problem
      spacedRepetitionData[problemData.titleSlug] = {
        easeFactor: 2.5,
        interval: 1,
        dueDate: calculateNextReviewDate(1),
        repetitions: 0,
        lastReviewedAt: new Date().toISOString()
      };
    } else {
      // If we already have this problem, just update the completion date
      completedProblems[existingIndex].completedAt = problemData.completedAt || new Date().toISOString();
      
      debugLog('Updated existing problem completion:', problemData.title);
      
      // If it doesn't have spaced repetition data yet, initialize it
      if (!spacedRepetitionData[problemData.titleSlug]) {
        spacedRepetitionData[problemData.titleSlug] = {
          easeFactor: 2.5,
          interval: 1,
          dueDate: calculateNextReviewDate(1),
          repetitions: 0,
          lastReviewedAt: new Date().toISOString()
        };
      }
    }
    
    // Save updated data
    await chrome.storage.local.set({
      [STORAGE_KEYS.COMPLETED_PROBLEMS]: completedProblems,
      [STORAGE_KEYS.PROBLEM_METADATA]: problemMetadata,
      [STORAGE_KEYS.SPACED_REPETITION_DATA]: spacedRepetitionData,
      [STORAGE_KEYS.LAST_SYNC]: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error handling problem completion:', error);
    throw error;
  }
}

// Function to update solved problems from a sync operation
async function updateSolvedProblems(solvedProblems, source, timestamp) {
  try {
    if (!solvedProblems || !Array.isArray(solvedProblems)) {
      debugLog('Invalid solved problems data');
      return;
    }
    
    debugLog(`Updating ${solvedProblems.length} solved problems from ${source}`);
    
    // Get existing data from storage
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.COMPLETED_PROBLEMS,
      STORAGE_KEYS.PROBLEM_METADATA,
      STORAGE_KEYS.USER_SETTINGS
    ]);
    
    const existingProblems = data[STORAGE_KEYS.COMPLETED_PROBLEMS] || [];
    const problemMetadata = data[STORAGE_KEYS.PROBLEM_METADATA] || {};
    const userSettings = data[STORAGE_KEYS.USER_SETTINGS];
    
    // Track new problems added in this sync
    let newProblemsCount = 0;
    
    // Process each solved problem
    for (const problem of solvedProblems) {
      // Check if we already have this problem
      const existingIndex = existingProblems.findIndex(p => p.titleSlug === problem.titleSlug);
      
      // Update problem metadata regardless of whether it's new
      problemMetadata[problem.titleSlug] = {
        id: problem.frontendQuestionId || problem.id || '',
        title: problem.title || '',
        difficulty: problem.difficulty || 'Medium',
        topics: problem.topicTags || [],
        lastUpdated: new Date().toISOString()
      };
      
      if (existingIndex === -1) {
        // New problem, add to the list
        existingProblems.push({
          titleSlug: problem.titleSlug,
          completedAt: problem.lastSubmittedAt || timestamp || new Date().toISOString(),
          url: `https://leetcode.com/problems/${problem.titleSlug}/`
        });
        newProblemsCount++;
      } else {
        // Only update if the new submission is more recent
        const existingDate = new Date(existingProblems[existingIndex].completedAt);
        const newDate = new Date(problem.lastSubmittedAt || timestamp || new Date().toISOString());
        
        if (newDate > existingDate) {
          existingProblems[existingIndex].completedAt = newDate.toISOString();
        }
      }
    }
    
    // Ensure we don't exceed the maximum problems to store
    if (existingProblems.length > userSettings.maxProblemsToStore) {
      // Sort by completion date (newest first)
      existingProblems.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      // Trim to the max size
      existingProblems.length = userSettings.maxProblemsToStore;
    }
    
    // Save updated data
    await chrome.storage.local.set({
      [STORAGE_KEYS.COMPLETED_PROBLEMS]: existingProblems,
      [STORAGE_KEYS.PROBLEM_METADATA]: problemMetadata,
      [STORAGE_KEYS.LAST_SYNC]: new Date().toISOString()
    });
    
    debugLog(`Added ${newProblemsCount} new problems, total: ${existingProblems.length}`);
  } catch (error) {
    console.error('Error updating solved problems:', error);
    throw error;
  }
}

// Function to handle request to navigate to submissions page
async function handleSubmissionsPageRequest(username) {
  try {
    if (!username) {
      debugLog('No username provided for submissions page request');
      return;
    }
    
    debugLog('Handling submissions page request for user:', username);
    
    // Check user settings to see if we should auto-navigate
    const data = await chrome.storage.local.get([STORAGE_KEYS.USER_SETTINGS]);
    if (!data[STORAGE_KEYS.USER_SETTINGS]?.syncSubmissions) {
      debugLog('Auto-sync of submissions is disabled');
      return;
    }
    
    // Look for any LeetCode tabs
    const leetCodeTabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
    
    if (leetCodeTabs.length > 0) {
      // Navigate the first LeetCode tab to the submissions page
      const submissionsUrl = `https://leetcode.com/submissions/`;
      chrome.tabs.update(leetCodeTabs[0].id, { url: submissionsUrl });
      debugLog('Navigating to submissions page');
    } else {
      debugLog('No LeetCode tabs open to navigate');
    }
  } catch (error) {
    console.error('Error handling submissions page request:', error);
    throw error;
  }
}

// Function to sync completed problems
async function syncCompletedProblems() {
  console.log('[LeetAnki Background] Syncing completed problems');
  
  try {
    // Find active LeetCode tab
    const tabs = await chrome.tabs.query({ url: "https://leetcode.com/*" });
    
    if (tabs.length === 0) {
      console.log('[LeetAnki Background] No LeetCode tab found');
      return { success: false, error: 'No LeetCode tab open' };
    }
    
    // Check authentication first
    const authResponse = await chrome.tabs.sendMessage(tabs[0].id, { action: 'checkAuthStatus' });
    
    if (!authResponse || !authResponse.isAuthenticated) {
      console.log('[LeetAnki Background] Cannot sync - user not authenticated');
      return { success: false, error: 'User not authenticated' };
    }
    
    // User is authenticated, fetch problems
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSolvedProblems' });
    
    if (response && response.success) {
      // Store the problems data
      await chrome.storage.local.set({ 
        completedProblems: response.problems,
        lastSyncTime: new Date().toISOString()
      });
      
      console.log('[LeetAnki Background] Successfully synced', response.problems.length, 'problems');
      return { success: true, count: response.problems.length };
    } else {
      console.log('[LeetAnki Background] Sync failed:', response?.error || 'Unknown error');
      return { success: false, error: response?.error || 'Unknown error' };
    }
  } catch (error) {
    console.error('[LeetAnki Background] Error syncing problems:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to calculate the next review date
function calculateNextReviewDate(interval) {
  const today = new Date();
  const nextReview = new Date(today);
  nextReview.setDate(today.getDate() + interval);
  return nextReview.toISOString();
} 