// LeetAnki Popup Script

// Define storage keys (should match those in background.js)
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

// Enable debug mode
const debugMode = true;

// Helper function for debug logging
function debugLog(...args) {
  if (debugMode) {
    console.log('[LeetAnki Popup]', ...args);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Elements - Main sections
  const loginMessage = document.getElementById('login-message');
  const mainContent = document.getElementById('main-content');
  const dueProblems = document.getElementById('due-problems');
  const recommendedProblems = document.getElementById('recommended-problems');
  const completedCount = document.getElementById('completed-count');
  const reviewedCount = document.getElementById('reviewed-count');
  const lastSync = document.getElementById('last-sync');
  const syncButton = document.getElementById('sync-button');
  const settingsButton = document.getElementById('settings-button');
  
  // Elements - User info section
  const userAvatarElement = document.getElementById('user-avatar');
  const usernameElement = document.getElementById('username');
  const profileLinkElement = document.getElementById('profile-link');
  const totalSolvedElement = document.getElementById('total-solved');
  const easySolvedElement = document.getElementById('easy-solved');
  const mediumSolvedElement = document.getElementById('medium-solved');
  const hardSolvedElement = document.getElementById('hard-solved');

  // Initialize popup
  await updatePopupContent();
  
  // Set up periodic refresh
  setInterval(updatePopupContent, 5000);

  // Event listeners
  syncButton.addEventListener('click', handleSyncClick);
  settingsButton.addEventListener('click', openSettings);
  
  // Fix: Remove the event listener and use the default anchor tag behavior
  // This prevents duplicate tab opening
  const loginButton = document.querySelector('.login-button');
  if (loginButton) {
    // Remove any default href attribute to prevent automatic navigation
    const leetCodeLoginUrl = loginButton.getAttribute('href');
    loginButton.removeAttribute('href');
    
    loginButton.addEventListener('click', (e) => {
      e.preventDefault();
      debugLog('Login button clicked');
      
      // Open LeetCode in a new tab
      chrome.tabs.create({ url: leetCodeLoginUrl || 'https://leetcode.com/accounts/login/' });
    });
  }

  /**
   * Updates the problem statistics in the popup UI
   * @param {number} problemCount - The number of completed problems
   * @param {Date|null} lastSyncTime - The timestamp of the last sync
   */
  function updateProblemStats(problemCount, lastSyncTime) {
    const completedCountElement = document.getElementById('completed-count');
    const lastSyncElement = document.getElementById('last-sync');
    
    if (completedCountElement) {
      completedCountElement.textContent = problemCount;
    }
    
    if (lastSyncElement) {
      if (lastSyncTime) {
        const formattedDate = lastSyncTime.toLocaleString();
        lastSyncElement.textContent = formattedDate;
      } else {
        lastSyncElement.textContent = 'Never';
      }
    }
  }

  /**
   * Update popup content based on storage data
   */
  async function updatePopupContent() {
    console.log('[LeetAnki Popup] Updating popup content');
    
    try {
      // Check if we have a LeetCode tab open
      const tabs = await chrome.tabs.query({ url: "https://leetcode.com/*" });
      
      if (tabs.length > 0) {
        console.log('[LeetAnki Popup] Found LeetCode tab, checking auth status directly');
        
        try {
          // Send a message to the content script to check auth status
          const authStatus = await chrome.tabs.sendMessage(tabs[0].id, { action: 'checkAuthStatus' });
          console.log('[LeetAnki Popup] Auth status response:', authStatus);
          
          if (authStatus && authStatus.isAuthenticated) {
            console.log('[LeetAnki Popup] User is authenticated according to API');
            showAuthenticatedState(authStatus.username);
            
            // Load completed problems count
            const storageData = await chrome.storage.local.get(['completedProblems', 'lastSyncTime']);
            const problemCount = storageData.completedProblems?.length || 0;
            const lastSync = storageData.lastSyncTime ? new Date(storageData.lastSyncTime) : null;
            
            updateProblemStats(problemCount, lastSync);
            return; // Exit early if authenticated
          }
        } catch (error) {
          console.error('[LeetAnki Popup] Error getting auth status from tab:', error);
          // Fall through to storage check
        }
      }
      
      // Check storage as fallback or if tab communication failed
      console.log('[LeetAnki Popup] Checking auth status from storage');
      const storageData = await chrome.storage.local.get(['authStatus', 'username']);
      console.log('[LeetAnki Popup] Auth status from storage:', storageData.authStatus);
      
      if (storageData.authStatus) {
        console.log('[LeetAnki Popup] User is authenticated according to storage');
        showAuthenticatedState(storageData.username);
        
        const problemData = await chrome.storage.local.get(['completedProblems', 'lastSyncTime']);
        const problemCount = problemData.completedProblems?.length || 0;
        const lastSync = problemData.lastSyncTime ? new Date(problemData.lastSyncTime) : null;
        
        updateProblemStats(problemCount, lastSync);
      } else {
        console.log('[LeetAnki Popup] User is not authenticated according to storage');
        showUnauthenticatedState();
      }
    } catch (error) {
      console.error('[LeetAnki Popup] Error updating popup:', error);
      showErrorState(error.message);
    }
  }
  
  /**
   * Update the user information section
   * @param {Object} userInfo Basic user information
   * @param {Object} userProfile User profile with problem stats
   */
  function updateUserInfo(userInfo, userProfile) {
    // Update username and avatar if available
    if (userInfo) {
      usernameElement.textContent = userInfo.username || 'LeetCode User';
      
      if (userInfo.avatar) {
        userAvatarElement.src = userInfo.avatar;
      } else {
        // Set a default avatar or initial
        userAvatarElement.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23ddd"/><text x="50" y="60" font-size="50" text-anchor="middle" fill="%23666">' + (userInfo.username ? userInfo.username[0].toUpperCase() : 'L') + '</text></svg>';
      }
      
      // Update profile link
      if (userInfo.profileUrl) {
        profileLinkElement.href = 'https://leetcode.com' + userInfo.profileUrl;
      } else if (userInfo.username) {
        profileLinkElement.href = `https://leetcode.com/u/${userInfo.username}/`;
      } else {
        profileLinkElement.href = 'https://leetcode.com/';
      }
    }
    
    // Update problem solving stats if available
    if (userProfile) {
      totalSolvedElement.textContent = userProfile.totalSolved || 0;
      easySolvedElement.textContent = userProfile.easySolved || 0;
      mediumSolvedElement.textContent = userProfile.mediumSolved || 0;
      hardSolvedElement.textContent = userProfile.hardSolved || 0;
    } else {
      // Default values if profile not available
      totalSolvedElement.textContent = 0;
      easySolvedElement.textContent = 0;
      mediumSolvedElement.textContent = 0;
      hardSolvedElement.textContent = 0;
    }
  }

  /**
   * Populate the due problems list
   * @param {Object} data Storage data
   */
  async function populateDueProblems(data) {
    try {
      dueProblems.innerHTML = '<p class="loading">Loading...</p>';
      
      const spacedRepetitionData = data[STORAGE_KEYS.SPACED_REPETITION_DATA] || {};
      const problemMetadata = data[STORAGE_KEYS.PROBLEM_METADATA] || {};
      const now = new Date();
      
      // Find problems that are due for review
      const dueProblemsArray = Object.keys(spacedRepetitionData)
        .filter(slug => {
          const problem = spacedRepetitionData[slug];
          const dueDate = new Date(problem.dueDate);
          return dueDate <= now;
        })
        .map(slug => ({
          slug,
          metadata: problemMetadata[slug] || {},
          srpData: spacedRepetitionData[slug]
        }))
        .sort((a, b) => new Date(a.srpData.dueDate) - new Date(b.srpData.dueDate));
      
      if (dueProblemsArray.length === 0) {
        dueProblems.innerHTML = '<p>No problems due for review</p>';
        return;
      }
      
      // Create HTML for the due problems
      let html = '';
      dueProblemsArray.slice(0, 5).forEach(problem => {
        const difficultyClass = problem.metadata.difficulty ? 
          `difficulty-${problem.metadata.difficulty.toLowerCase()}` : 'difficulty-medium';
        
        html += `
          <div class="problem-item">
            <a href="https://leetcode.com/problems/${problem.slug}/" 
               class="problem-title" target="_blank">
              ${problem.metadata.title || problem.slug}
            </a>
            <span class="problem-difficulty ${difficultyClass}">
              ${problem.metadata.difficulty || 'Medium'}
            </span>
          </div>
        `;
      });
      
      dueProblems.innerHTML = html;
    } catch (error) {
      console.error('Error populating due problems:', error);
      dueProblems.innerHTML = '<p>Error loading problems</p>';
    }
  }

  /**
   * Populate the recommended problems list
   * @param {Object} data Storage data
   */
  async function populateRecommendedProblems(data) {
    try {
      recommendedProblems.innerHTML = '<p class="loading">Loading...</p>';
      
      // For now, just show recently completed problems
      // In Phase 4, we'll implement proper recommendations
      const completedProblemsArray = data[STORAGE_KEYS.COMPLETED_PROBLEMS] || [];
      const problemMetadata = data[STORAGE_KEYS.PROBLEM_METADATA] || {};
      
      if (completedProblemsArray.length === 0) {
        recommendedProblems.innerHTML = '<p>No completed problems yet</p>';
        return;
      }
      
      // Sort by completion date (newest first)
      const sortedProblems = [...completedProblemsArray]
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      
      // Create HTML for recent problems
      let html = '';
      sortedProblems.slice(0, 5).forEach(problem => {
        const metadata = problemMetadata[problem.titleSlug] || {};
        const difficultyClass = metadata.difficulty ? 
          `difficulty-${metadata.difficulty.toLowerCase()}` : 'difficulty-medium';
        
        html += `
          <div class="problem-item">
            <a href="${problem.url}" class="problem-title" target="_blank">
              ${metadata.title || problem.titleSlug}
            </a>
            <span class="problem-difficulty ${difficultyClass}">
              ${metadata.difficulty || 'Medium'}
            </span>
          </div>
        `;
      });
      
      recommendedProblems.innerHTML = html;
    } catch (error) {
      console.error('Error populating recommended problems:', error);
      recommendedProblems.innerHTML = '<p>Error loading recommendations</p>';
    }
  }

  /**
   * Handle sync button click
   */
  async function handleSyncClick() {
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing...';
    
    try {
      // First check if user is authenticated directly from LeetCode tab
      const authResponse = await sendMessageToLeetCodeTab('checkAuthStatus');
      
      if (authResponse && authResponse.isAuthenticated) {
        debugLog('Authentication verified from tab, proceeding with sync');
        
        // Update auth status in storage to ensure consistency
        await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_STATUS]: true });
        
        // Now send the sync message to background
        chrome.runtime.sendMessage({ action: 'syncCompletedProblems' }, (response) => {
          if (response && response.success) {
            debugLog('Sync request acknowledged by background script');
            updatePopupContent();
          } else {
            console.error('Sync request failed:', response?.error);
            // Show error message to user
            alert('Sync failed. Please try again or refresh the LeetCode tab.');
          }
          
          syncButton.disabled = false;
          syncButton.textContent = 'Sync Now';
        });
      } else {
        debugLog('Not authenticated according to tab check');
        
        // Check if we have a LeetCode tab open
        const leetCodeTabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
        
        if (leetCodeTabs.length === 0) {
          alert('No LeetCode tab found. Please open LeetCode and try again.');
        } else {
          alert('Please log in to LeetCode and refresh the page before syncing.');
        }
        
        syncButton.disabled = false;
        syncButton.textContent = 'Sync Now';
      }
    } catch (error) {
      console.error('Error during sync:', error);
      syncButton.disabled = false;
      syncButton.textContent = 'Sync Now';
      alert('Error during sync. Please try again.');
    }
  }

  /**
   * Open settings page
   */
  function openSettings() {
    // This will be implemented later
    console.log('Settings button clicked');
  }

  /**
   * Send a message to a LeetCode tab and handle errors
   * @param {string} action - The action to request
   * @param {Object} params - Additional parameters
   * @returns {Promise<any>} - The response from the tab
   */
  async function sendMessageToLeetCodeTab(action, params = {}) {
    debugLog(`Sending ${action} message to LeetCode tab`);
    
    // Find LeetCode tabs
    const leetCodeTabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
    
    if (leetCodeTabs.length === 0) {
      debugLog('No LeetCode tabs found');
      showErrorState('No LeetCode tabs found. Please open LeetCode.com in a browser tab.');
      return null;
    }
    
    // First check if the content script is ready (unless we're already checking that)
    if (action !== 'isContentScriptReady') {
      try {
        const readyCheck = await new Promise((resolve) => {
          chrome.tabs.sendMessage(
            leetCodeTabs[0].id,
            { action: 'isContentScriptReady' },
            (response) => {
              if (chrome.runtime.lastError) {
                debugLog('Content script not ready:', chrome.runtime.lastError);
                resolve(false);
              } else {
                debugLog('Content script is ready:', response);
                resolve(true);
              }
            }
          );
          
          // If we don't get a response within 1 second, assume the content script is not ready
          setTimeout(() => resolve(false), 1000);
        });
        
        if (!readyCheck) {
          debugLog('Content script is not ready, showing error');
          showErrorState('Extension content script is not ready. Please refresh your LeetCode tab and try again.');
          return null;
        }
      } catch (error) {
        console.error('Error checking if content script is ready:', error);
        showErrorState('Error checking if content script is ready. Please refresh your LeetCode tab and try again.');
        return null;
      }
    }
    
    // Try to send the message to the first tab
    try {
      return await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          leetCodeTabs[0].id,
          { action, ...params },
          (response) => {
            if (chrome.runtime.lastError) {
              debugLog('Error sending message to tab:', chrome.runtime.lastError);
              // Check if this is related to the content script not being injected or ready
              if (chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
                debugLog('Content script may not be ready - tab might need a refresh');
                showErrorState('Extension content script is not ready. Please refresh your LeetCode tab and try again.');
              } else {
                showErrorState(`Error communicating with LeetCode: ${chrome.runtime.lastError.message}`);
              }
              resolve(null);
            } else {
              debugLog(`Received response for ${action}:`, response);
              resolve(response);
            }
          }
        );
      });
    } catch (error) {
      console.error(`Error sending ${action} message:`, error);
      showErrorState(`Error: ${error.message}`);
      return null;
    }
  }

  // Update these functions to match the actual element IDs in your HTML
  function showAuthenticatedState(username) {
    console.log('[LeetAnki Popup] Showing authenticated state for user:', username);
    
    // Hide login message
    const loginMessage = document.getElementById('login-message');
    if (loginMessage) {
      loginMessage.style.display = 'none';
    } else {
      console.warn('[LeetAnki Popup] Could not find login-message element');
    }
    
    // Show main content
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.style.display = 'block';
    } else {
      console.warn('[LeetAnki Popup] Could not find main-content element');
    }
    
    // Update username if we have it
    const usernameElem = document.getElementById('username');
    if (usernameElem && username) {
      usernameElem.textContent = username;
    }
  }

  function showUnauthenticatedState() {
    console.log('[LeetAnki Popup] Showing unauthenticated state');
    
    // Show login message
    const loginMessage = document.getElementById('login-message');
    if (loginMessage) {
      loginMessage.style.display = 'block';
    } else {
      console.warn('[LeetAnki Popup] Could not find login-message element');
    }
    
    // Hide main content
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.style.display = 'none';
    } else {
      console.warn('[LeetAnki Popup] Could not find main-content element');
    }
  }

  // Add the missing showErrorState function
  function showErrorState(errorMessage) {
    console.log('[LeetAnki Popup] Showing error state:', errorMessage);
    
    // Hide login message and main content
    const loginMessage = document.getElementById('login-message');
    if (loginMessage) {
      loginMessage.style.display = 'none';
    } else {
      console.warn('[LeetAnki Popup] Could not find login-message element');
    }
    
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.style.display = 'none';
    } else {
      console.warn('[LeetAnki Popup] Could not find main-content element');
    }
    
    // Show the error message
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
      const errorTextElement = document.getElementById('error-text');
      if (errorTextElement) {
        errorTextElement.textContent = errorMessage || 'An unknown error occurred';
      }
      
      // Add a reload button if this is a connection error
      if (errorMessage && (
          errorMessage.includes('content script is not ready') || 
          errorMessage.includes('Receiving end does not exist')
        )) {
        // Check if we already have a reload button
        let reloadButton = document.getElementById('reload-leetcode-button');
        if (!reloadButton) {
          // Create a reload button
          reloadButton = document.createElement('button');
          reloadButton.id = 'reload-leetcode-button';
          reloadButton.className = 'button';
          reloadButton.textContent = 'Reload LeetCode Tab';
          reloadButton.addEventListener('click', reloadLeetCodeTab);
          errorElement.appendChild(reloadButton);
        }
      }
      
      errorElement.classList.remove('hidden');
    } else {
      console.warn('[LeetAnki Popup] Could not find error-message element');
    }
  }
  
  /**
   * Reload the LeetCode tab
   */
  async function reloadLeetCodeTab() {
    try {
      const leetCodeTabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
      
      if (leetCodeTabs.length === 0) {
        alert('No LeetCode tab found. Please open LeetCode.com first.');
        return;
      }
      
      // Reload the first LeetCode tab found
      chrome.tabs.reload(leetCodeTabs[0].id, {}, () => {
        // Show loading state on button
        const reloadButton = document.getElementById('reload-leetcode-button');
        if (reloadButton) {
          reloadButton.textContent = 'Reloading...';
          reloadButton.disabled = true;
        }
        
        // Give some time for the page to reload and content script to initialize
        setTimeout(() => {
          // Attempt to update popup content again
          updatePopupContent().then(() => {
            console.log('[LeetAnki Popup] Refreshed popup content after tab reload');
          }).catch(error => {
            console.error('[LeetAnki Popup] Error updating popup after reload:', error);
          });
        }, 3000); // Wait 3 seconds
      });
    } catch (error) {
      console.error('[LeetAnki Popup] Error reloading LeetCode tab:', error);
      alert('Error reloading LeetCode tab: ' + error.message);
    }
  }
}); 