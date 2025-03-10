// LeetAnki Content Script
// This script runs on LeetCode pages to detect user status and completed problems

// Initialize variables
let isAuthenticated = false;
let currentUser = null;
let userProfile = null;
let completionObserver = null;
let apiAccessible = false;
let LeetCodeAPI = null;
let LeetCodeDOM = null;
let debugMode = true; // Enable debug logging
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;

// Helper function for debug logging
function debugLog(...args) {
  if (debugMode) {
    console.log('[LeetAnki Debug]', ...args);
  }
}

// Main initialization function
function initialize() {
  debugLog('Initializing content script on LeetCode');
  
  try {
    // Access the API and DOM utilities from the global scope
    // These will be set by the scripts loaded in the manifest
    LeetCodeAPI = window.LeetCodeAPI;
    LeetCodeDOM = window.LeetCodeDOM;
    
    if (!LeetCodeAPI || !LeetCodeDOM) {
      debugLog('Failed to load utilities, will retry');
      initializationAttempts++;
      
      if (initializationAttempts < MAX_INIT_ATTEMPTS) {
        // Retry after a short delay
        setTimeout(initialize, 200);
      } else {
        console.error('LeetAnki: Failed to load utilities after max attempts');
      }
      return;
    }
    
    // Check API accessibility
    checkApiAccessibility().catch(err => {
      console.error('Error checking API accessibility:', err);
      apiAccessible = false;
    });
    
    // Check authentication status immediately
    checkAuthenticationStatus();
    
    // Set up a periodic check (every 10 seconds)
    setInterval(checkAuthenticationStatus, 10000);
    
    // Listen for page URL changes (for single-page applications)
    observeUrlChanges();
    
    // Setup problem completion observer if we're on a problem page
    if (isProblemPage()) {
      debugLog('On problem page, setting up completion observer');
      setupProblemCompletionObserver();
      // Also observe code submissions
      observeCodeSubmissions();
    }
    
    // Sync with background script
    syncAuthStateWithBackground();
    
    // Notify that content script is fully initialized and ready
    chrome.runtime.sendMessage({ 
      action: 'contentScriptReady',
      pageUrl: window.location.href
    });
    
    debugLog('Initialization complete');
    
  } catch (error) {
    console.error('LeetAnki: Error during initialization:', error);
  }
}

/**
 * Sync authentication state with background script
 */
function syncAuthStateWithBackground() {
  try {
    // First, check current auth status
    const currentAuthStatus = checkAuthenticationStatusSync();
    
    // Then, get the stored auth status from background
    chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting auth status from background:', chrome.runtime.lastError);
        return;
      }
      
      debugLog('Auth status from background:', response?.isAuthenticated);
      debugLog('Current detected auth status:', currentAuthStatus);
      
      // If there's a mismatch, update the background
      if (response && response.isAuthenticated !== currentAuthStatus) {
        debugLog('Auth status mismatch, updating background');
        
        let userInfo = null;
        if (currentAuthStatus) {
          userInfo = extractUserInfo();
        }
        
        chrome.runtime.sendMessage({ 
          action: 'authStatusChanged', 
          status: currentAuthStatus,
          userInfo: userInfo
        }, (updateResponse) => {
          debugLog('Auth status update response:', updateResponse);
        });
      }
    });
  } catch (error) {
    console.error('Error syncing auth state:', error);
  }
}

/**
 * Check if the LeetCode API is accessible
 */
async function checkApiAccessibility() {
  try {
    apiAccessible = await LeetCodeAPI.isApiAccessible();
    debugLog('API accessible:', apiAccessible);
  } catch (error) {
    console.error('LeetAnki: Error checking API accessibility:', error);
    apiAccessible = false;
  }
}

/**
 * Synchronous version of auth status check that returns the result
 * @returns {boolean} Whether the user is authenticated
 */
function checkAuthenticationStatusSync() {
  try {
    // Multiple methods to detect authentication for reliability
    
    // Method 1: Check for user avatar in the header
    const userAvatar = document.querySelector('img[alt="avatar"]');
    debugLog('User avatar element:', userAvatar);
    
    // Method 2: Check for specific elements only visible to logged-in users
    const userDropdown = document.querySelector('[data-cy="navbar-user-menu"]');
    debugLog('User dropdown element:', userDropdown);
    
    // Method 3: Check for profile links with username
    const profileLink = document.querySelector('a[href^="/u/"]');
    debugLog('Profile link element:', profileLink);
    
    // Method 4: Check for elements in the navbar that only appear when logged in
    const premiumLink = document.querySelector('a[href="/premium/"]');
    const notificationIcon = document.querySelector('[data-cy="notification-icon"]');
    
    // Method 5: Check for user-specific elements
    const userMenu = document.querySelector('.user-avatar-container');
    const userAvatar2 = document.querySelector('.user-avatar');
    const userDropdown2 = document.querySelector('.ant-dropdown-trigger');
    
    // Method 6: Check for logout button
    const logoutButton = Array.from(document.querySelectorAll('a')).find(
      el => el.textContent.includes('Sign Out') || el.textContent.includes('Log Out')
    );
    
    // Method 7: Check via the LeetCode header user dropdown
    const userNavItems = document.querySelectorAll('.navbar-right-container .nav-item');
    const hasUserNavItems = userNavItems.length > 0;
    
    // Method 8: Check if there's a "Sign In" button (if it exists, user is not logged in)
    const signInButton = Array.from(document.querySelectorAll('a')).find(
      el => el.textContent.includes('Sign In')
    );
    
    // Combine all methods
    const isLoggedIn = !!(
      userAvatar || 
      userDropdown || 
      profileLink || 
      premiumLink || 
      notificationIcon ||
      userMenu ||
      userAvatar2 ||
      userDropdown2 ||
      logoutButton ||
      hasUserNavItems
    ) && !signInButton;
    
    debugLog('Authentication check result:', isLoggedIn);
    return isLoggedIn;
  } catch (error) {
    console.error('Error in checkAuthenticationStatusSync:', error);
    return false;
  }
}

/**
 * Check if the user is authenticated on LeetCode
 */
function checkAuthenticationStatus() {
  try {
    const newAuthStatus = checkAuthenticationStatusSync();
    
    // If auth status changed, notify background script
    if (newAuthStatus !== isAuthenticated) {
      debugLog('Authentication status changed:', newAuthStatus);
      isAuthenticated = newAuthStatus;
      
      // If now authenticated, try to extract username and profile info
      let userInfo = null;
      if (isAuthenticated) {
        userInfo = extractUserInfo();
      } else {
        // Reset user data if logged out
        currentUser = null;
        userProfile = null;
      }
      
      // Send updated auth status to background script
      chrome.runtime.sendMessage({ 
        action: 'authStatusChanged', 
        status: isAuthenticated,
        userInfo: userInfo
      }, (response) => {
        debugLog('Auth status update response:', response);
      });
    }
  } catch (error) {
    console.error('LeetAnki: Error checking authentication status:', error);
  }
}

/**
 * Extract user information from the page
 * @returns {Object|null} User information object or null if not found
 */
function extractUserInfo() {
  try {
    let username = null;
    let profileUrl = null;
    let avatar = null;
    
    // Method 1: Extract from profile link
    const profileLink = document.querySelector('a[href^="/u/"]');
    if (profileLink) {
      profileUrl = profileLink.getAttribute('href');
      // Extract username from the URL pattern /u/username
      username = profileUrl.split('/u/')[1];
      debugLog('Username from profile link:', username);
    }
    
    // Method 2: Extract from other navbar elements if Method 1 fails
    if (!username) {
      const userMenu = document.querySelector('[data-cy="navbar-user-menu"]');
      if (userMenu) {
        const userText = userMenu.textContent.trim();
        // The user menu typically shows the username
        if (userText && userText !== '') {
          username = userText;
          debugLog('Username from user menu:', username);
        }
      }
    }
    
    // Method 3: Try to find from dropdown
    if (!username) {
      // Look for any element that might contain the username
      const possibleUsernameElements = document.querySelectorAll('.ant-dropdown-trigger, .user-avatar-container');
      for (const element of possibleUsernameElements) {
        const text = element.textContent.trim();
        if (text && text.length > 0 && text.length < 30) { // Reasonable username length
          username = text;
          debugLog('Username from dropdown:', username);
          break;
        }
      }
    }
    
    // Method 4: Try to find avatar URL
    const avatarImg = document.querySelector('img[alt="avatar"]') || document.querySelector('.user-avatar img');
    if (avatarImg) {
      avatar = avatarImg.src;
      debugLog('Avatar URL:', avatar);
    }
    
    // Only update if we found a username
    if (username) {
      currentUser = username;
      
      // Attempt to fetch additional profile data
      fetchUserProfile(username).catch(err => {
        console.error('Error fetching user profile:', err);
      });
      
      debugLog('Extracted user info:', username);
      
      return {
        username: username,
        profileUrl: profileUrl,
        avatar: avatar
      };
    }
    
    return null;
  } catch (error) {
    console.error('LeetAnki: Error extracting user info:', error);
    return null;
  }
}

/**
 * Fetch additional user profile information
 * @param {string} username The username to fetch profile for
 */
async function fetchUserProfile(username) {
  try {
    // Only attempt to fetch if we have a username and we're on the LeetCode site
    if (!username || !window.location.href.includes('leetcode.com')) {
      return;
    }
    
    let profileData = null;
    
    // Approach 1: Try using the API if accessible
    if (apiAccessible) {
      try {
        const data = await LeetCodeAPI.fetchUserSolvedProblems(username);
        if (data && data.matchedUser) {
          const stats = data.matchedUser.submitStats.acSubmissionNum;
          const totalSolved = stats.find(item => item.difficulty === 'All')?.count || 0;
          const easySolved = stats.find(item => item.difficulty === 'Easy')?.count || 0;
          const mediumSolved = stats.find(item => item.difficulty === 'Medium')?.count || 0;
          const hardSolved = stats.find(item => item.difficulty === 'Hard')?.count || 0;
          
          profileData = {
            totalSolved,
            easySolved,
            mediumSolved,
            hardSolved,
            lastUpdated: new Date().toISOString(),
            source: 'api'
          };
          
          debugLog('Profile data from API:', profileData);
        }
      } catch (error) {
        console.error('LeetAnki: Error fetching profile with API:', error);
        // If API fails, we'll fall back to DOM scraping
      }
    }
    
    // Approach 2: If API approach failed or not accessible, try DOM scraping
    if (!profileData) {
      // Check if we're on the profile page
      if (window.location.href.includes(`/u/${username}`)) {
        profileData = LeetCodeDOM.extractProfileSolvedProblems();
        if (profileData) {
          profileData.source = 'dom';
          debugLog('Profile data from DOM:', profileData);
        }
      } else {
        debugLog('Not on profile page, will sync profile later');
      }
    }
    
    // Save profile data if found
    if (profileData) {
      userProfile = profileData;
      
      // Send profile data to background script
      chrome.runtime.sendMessage({
        action: 'userProfileUpdated',
        profile: profileData
      }, (response) => {
        debugLog('Profile update response:', response);
      });
      
      debugLog('Updated user profile:', profileData);
    }
  } catch (error) {
    console.error('LeetAnki: Error fetching user profile:', error);
  }
}

/**
 * Observe code submissions directly
 */
function observeCodeSubmissions() {
  try {
    debugLog('Setting up code submission observer');
    
    // The submit button has different selectors depending on the LeetCode version
    const possibleSubmitButtonSelectors = [
      'button[data-cy="submit-code-btn"]',
      'button.submit__2ISl',
      '.submit-button',
      'button[type="submit"]',
      'button.ant-btn-primary',
      // Find buttons with text "Submit" using a more reliable approach
      'button'
    ];
    
    // Find the submit button if it exists
    let submitButton = null;
    for (const selector of possibleSubmitButtonSelectors) {
      const buttons = document.querySelectorAll(selector);
      for (const btn of buttons) {
        // Check if the button text contains "Submit"
        if (btn.textContent.includes('Submit')) {
          submitButton = btn;
          break;
        }
      }
      if (submitButton) break;
    }
    
    if (submitButton) {
      debugLog('Found submit button:', submitButton);
      
      // Listen for clicks on the submit button
      submitButton.addEventListener('click', () => {
        debugLog('Submit button clicked, starting result observation');
        
        // The results usually appear a few seconds after submission
        // We'll check for results periodically
        const resultCheckInterval = setInterval(() => {
          // Look for success indicators in the result area
          const successIndicators = [
            document.querySelector('.success-icon'),
            document.querySelector('[data-e2e-locator="submission-result-status"]'),
            document.querySelector('.text-success'),
            document.querySelector('.text-green-s')
          ];
          
          // Check if any success indicator is present and contains "Accepted"
          const isAccepted = successIndicators.some(el => 
            el && el.textContent.includes('Accepted')
          );
          
          if (isAccepted) {
            debugLog('Submission accepted! Extracting problem data');
            clearInterval(resultCheckInterval);
            
            // Extract problem data and send to background
            const problemData = LeetCodeDOM.extractProblemCompletionStatus();
            if (problemData) {
              chrome.runtime.sendMessage({
                action: 'problemCompleted',
                problem: problemData
              }, (response) => {
                debugLog('Problem completion notification response:', response);
              });
            }
          }
        }, 1000); // Check every second
        
        // Stop checking after 15 seconds to prevent memory leaks
        setTimeout(() => {
          clearInterval(resultCheckInterval);
        }, 15000);
      });
    } else {
      debugLog('Could not find submit button');
    }
  } catch (error) {
    console.error('Error setting up code submission observer:', error);
  }
}

/**
 * Fetch all solved problems for the current user
 */
async function fetchSolvedProblems() {
  try {
    if (!isAuthenticated || !currentUser) {
      debugLog('Cannot fetch solved problems - user not authenticated');
      return;
    }
    
    let solvedProblems = [];
    let source = '';
    
    // Approach 1: Try using the API if accessible
    if (apiAccessible) {
      try {
        solvedProblems = await LeetCodeAPI.fetchAllSolvedProblems(currentUser);
        source = 'api';
        debugLog('Fetched solved problems via API:', solvedProblems.length);
      } catch (error) {
        console.error('LeetAnki: Error fetching solved problems with API:', error);
        // If API fails, we'll try the alternative approach
      }
    }
    
    // Approach 2: If API failed or not accessible, try to go to the submissions page
    if (solvedProblems.length === 0) {
      // If we're on the submissions page, extract data
      if (window.location.href.includes('/submissions/')) {
        const submissions = LeetCodeDOM.extractRecentSubmissions();
        if (submissions && submissions.length > 0) {
          solvedProblems = submissions.filter(s => s.status === 'AC');
          source = 'dom-submissions';
          debugLog('Fetched solved problems via DOM:', solvedProblems.length);
        }
      } else {
        // We're not on the right page to extract data
        debugLog('Not on submissions page, cannot scrape completion data');
        
        // Notify background script that we need to navigate to submissions page
        chrome.runtime.sendMessage({ 
          action: 'needSubmissionsPage', 
          username: currentUser 
        }, (response) => {
          debugLog('Navigation request response:', response);
        });
        
        return;
      }
    }
    
    // Send solved problems to background script
    if (solvedProblems.length > 0) {
      const submitData = {
        action: 'updateSolvedProblems',
        solvedProblems: solvedProblems,
        source: source,
        timestamp: new Date().toISOString()
      };
      
      chrome.runtime.sendMessage(submitData, (response) => {
        if (response && response.success) {
          debugLog(`Successfully synced ${solvedProblems.length} solved problems`);
        } else {
          console.error('LeetAnki: Error syncing solved problems:', response?.error);
        }
      });
    } else {
      debugLog('No solved problems found to sync');
    }
  } catch (error) {
    console.error('LeetAnki: Error in fetchSolvedProblems:', error);
  }
}

/**
 * Setup problem completion observer
 */
function setupProblemCompletionObserver() {
  try {
    // Clear any existing observer
    if (completionObserver) {
      completionObserver.disconnect();
    }
    
    // Set up new observer
    completionObserver = LeetCodeDOM.observeProblemCompletion(problemData => {
      // When a problem is completed, send it to the background script
      if (problemData) {
        chrome.runtime.sendMessage({ 
          action: 'problemCompleted', 
          problem: problemData 
        }, (response) => {
          debugLog('Problem completion notification response:', response);
        });
        
        debugLog('Problem completion detected:', problemData.title);
      }
    });
    
    debugLog('Problem completion observer set up');
  } catch (error) {
    console.error('Error setting up problem completion observer:', error);
  }
}

/**
 * Observe URL changes to detect navigation on LeetCode
 */
function observeUrlChanges() {
  try {
    let lastUrl = location.href;
    
    // Create a new observer for body changes
    const observer = new MutationObserver(() => {
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        debugLog('URL changed to', lastUrl);
        
        // Re-check auth status on URL change
        checkAuthenticationStatus();
        
        // Check if we're on a problem page
        if (isProblemPage()) {
          debugLog('On a problem page');
          // Refresh the completion observer
          setupProblemCompletionObserver();
          // Re-observe code submissions
          observeCodeSubmissions();
        }
        
        // Check if we're on the profile page
        if (currentUser && lastUrl.includes(`/u/${currentUser}`)) {
          debugLog('On user profile page');
          // Fetch profile data
          fetchUserProfile(currentUser).catch(err => {
            console.error('Error fetching user profile:', err);
          });
        }
        
        // Check if we're on the submissions page
        if (lastUrl.includes('/submissions/')) {
          debugLog('On submissions page');
          // This is a good time to fetch solved problems
          fetchSolvedProblems().catch(err => {
            console.error('Error fetching solved problems:', err);
          });
        }
      }
    });
    
    // Start observing
    observer.observe(document.body, { childList: true, subtree: true });
    debugLog('URL change observer set up');
  } catch (error) {
    console.error('Error setting up URL change observer:', error);
  }
}

/**
 * Check if the current page is a problem page
 */
function isProblemPage() {
  // LeetCode problem URLs typically have patterns like:
  // https://leetcode.com/problems/problem-name/
  const url = window.location.href;
  return url.includes('leetcode.com/problems/');
}

// GraphQL API functions
async function isUserAuthenticated() {
  try {
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query getUserProfile {
            userStatus {
              userId
              username
              isSignedIn
            }
          }
        `
      })
    });
    
    const data = await response.json();
    console.log('[LeetAnki Debug] Authentication API response:', data);
    
    // Check if user is signed in
    if (data.data && data.data.userStatus && data.data.userStatus.isSignedIn) {
      const authInfo = {
        isAuthenticated: true,
        username: data.data.userStatus.username,
        userId: data.data.userStatus.userId
      };
      
      // Store the auth status in local storage
      chrome.storage.local.set({ 
        authStatus: authInfo.isAuthenticated,
        username: authInfo.username || null,
        userId: authInfo.userId || null
      }, () => {
        console.log('[LeetAnki Debug] Updated auth status in storage:', authInfo.isAuthenticated);
      });
      
      return authInfo;
    }
    
    // User is not authenticated
    chrome.storage.local.set({
      authStatus: false,
      username: null,
      userId: null
    }, () => {
      console.log('[LeetAnki Debug] Updated auth status in storage: false');
    });
    
    return { isAuthenticated: false };
  } catch (error) {
    console.error('[LeetAnki Debug] Error checking authentication via API:', error);
    return { isAuthenticated: false };
  }
}

async function fetchCompletedProblems() {
  try {
    console.log('[LeetAnki Debug] Fetching completed problems via API');
    
    // Get the current user (this should be available from the page context)
    const username = currentUser || "";
    console.log('[LeetAnki Debug] Current username value:', username);
    
    if (!username) {
      console.log('[LeetAnki Debug] No username available, cannot fetch problems');
      return [];
    }
    
    console.log('[LeetAnki Debug] Fetching problems for user:', username);
    
    // Create or update sync status UI
    showSyncStatus("Starting sync...");
    
    // Get problems from submissions
    const submissionProblems = await fetchSubmissionProblems(username);
    console.log(`[LeetAnki Debug] Fetched ${submissionProblems.length} problems from submissions`);
    
    // Get any previously stored problems
    let storedProblems = [];
    try {
      const stored = await chrome.storage.local.get('completedProblems');
      if (stored && stored.completedProblems) {
        storedProblems = stored.completedProblems;
        console.log(`[LeetAnki Debug] Found ${storedProblems.length} previously stored problems`);
      }
    } catch (error) {
      console.error('[LeetAnki Debug] Error retrieving stored problems:', error);
    }
    
    // Merge with previously stored problems
    const mergedProblems = mergeCompletedProblems(storedProblems, submissionProblems);
    console.log(`[LeetAnki Debug] Total unique problems after merge: ${mergedProblems.length}`);
    
    // Store the updated list
    try {
      await chrome.storage.local.set({ 
        'completedProblems': mergedProblems,
        'lastSyncTime': new Date().toISOString()
      });
      showSyncStatus(`Sync complete. Found ${mergedProblems.length} problems.`, true);
      
      // Hide the sync status after a delay
      setTimeout(() => {
        hideSyncStatus();
      }, 5000);
    } catch (error) {
      console.error('[LeetAnki Debug] Error storing problems:', error);
      showSyncStatus("Error during sync. Please try again.", true);
    }
    
    return mergedProblems;
  } catch (error) {
    console.error('[LeetAnki Debug] Error fetching completed problems:', error);
    showSyncStatus("Error during sync. Please try again.", true);
    return [];
  }
}

// Functions to show and hide sync status
function showSyncStatus(message, isComplete = false) {
  // First check if the status element already exists
  let statusElement = document.getElementById('leetanki-sync-status');
  
  if (!statusElement) {
    // Create the status element if it doesn't exist
    statusElement = document.createElement('div');
    statusElement.id = 'leetanki-sync-status';
    statusElement.style.position = 'fixed';
    statusElement.style.bottom = '20px';
    statusElement.style.right = '20px';
    statusElement.style.padding = '12px 16px';
    statusElement.style.borderRadius = '8px';
    statusElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    statusElement.style.color = 'white';
    statusElement.style.fontSize = '14px';
    statusElement.style.fontWeight = '500';
    statusElement.style.zIndex = '10000';
    statusElement.style.display = 'flex';
    statusElement.style.alignItems = 'center';
    statusElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    statusElement.style.transition = 'opacity 0.3s ease';
    
    document.body.appendChild(statusElement);
  }
  
  // Add a spinner if not complete, otherwise add a checkmark
  if (!isComplete) {
    statusElement.innerHTML = `
      <div style="display: inline-block; margin-right: 10px; width: 18px; height: 18px; border: 2px solid #f3f3f3; 
      border-top: 2px solid #3498db; border-radius: 50%; animation: leetankiSpinner 1s linear infinite;"></div>
      <span>${message}</span>
    `;
    // Add the animation
    const style = document.createElement('style');
    style.id = 'leetanki-spinner-style';
    style.textContent = `
      @keyframes leetankiSpinner {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    if (!document.getElementById('leetanki-spinner-style')) {
      document.head.appendChild(style);
    }
  } else {
    statusElement.innerHTML = `
      <div style="display: inline-block; margin-right: 10px; color: #2ecc71;">✓</div>
      <span>${message}</span>
    `;
  }
  
  // Make sure it's visible
  statusElement.style.opacity = '1';
}

function hideSyncStatus() {
  const statusElement = document.getElementById('leetanki-sync-status');
  if (statusElement) {
    statusElement.style.opacity = '0';
    setTimeout(() => {
      statusElement.remove();
    }, 300);
  }
}

async function fetchSubmissionProblems(username) {
  try {
    // First get the user profile to know how many problems they've solved
    const apiUrl = `https://leetcode.com/graphql`;
    const userStatsQuery = {
      query: `
        query userPublicProfile($username: String!) {
          matchedUser(username: $username) {
            submitStats {
              acSubmissionNum {
                difficulty
                count
              }
            }
          }
        }
      `,
      variables: {
        username: username
      }
    };

    const statsResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userStatsQuery)
    });

    const statsData = await statsResponse.json();
    const totalSolved = statsData?.data?.matchedUser?.submitStats?.acSubmissionNum?.reduce((total, item) => total + item.count, 0) || 0;
    console.log(`[LeetAnki Debug] User has solved ${totalSolved} problems in total`);
    
    // Update sync status with total problems
    showSyncStatus(`Found that you've solved ${totalSolved} problems. Starting sync...`);

    // Initialize variables for fetching submissions
    const allSubmissions = [];
    let hasMoreSubmissions = true;
    let offset = 0;
    let lastKey = '';
    const batchSize = 20; // LeetCode returns 20 regardless of what we request
    let attemptCount = 0;
    const maxAttempts = 25; // Reasonable limit to avoid infinite loops
    let consecutiveErrorCount = 0;
    const maxConsecutiveErrors = 3; // Stop after 3 consecutive errors
    const maxSubmissions = 400; // LeetCode seems to have a hard limit at 400

    // Fetch submissions in batches with a delay between requests
    while (hasMoreSubmissions && 
           attemptCount < maxAttempts && 
           consecutiveErrorCount < maxConsecutiveErrors &&
           allSubmissions.length < maxSubmissions) {
      attemptCount++;
      
      try {
        // Update sync status with current progress
        showSyncStatus(`Syncing submissions... ${allSubmissions.length}/${Math.min(totalSolved, maxSubmissions)}`);
        
        console.log(`[LeetAnki Debug] Fetching submissions batch with offset ${offset}`);
        
        // Build the URL with appropriate parameters
        let submissionsUrl = `https://leetcode.com/api/submissions/?offset=${offset}&limit=${batchSize}`;
        if (lastKey) {
          submissionsUrl += `&lastkey=${encodeURIComponent(lastKey)}`;
        }
        
        console.log(`[LeetAnki Debug] API URL: ${submissionsUrl}`);
        
        // Add a small delay to avoid rate limiting
        if (attemptCount > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        const response = await fetch(submissionsUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include' // Important for authenticated requests
        });
        
        if (!response.ok) {
          console.log(`[LeetAnki Debug] API returned status ${response.status}`);
          consecutiveErrorCount++;
          
          if (response.status === 403) {
            console.log(`[LeetAnki Debug] Received 403 Forbidden - this may be a rate limit or API restriction`);
            // If we've already got some submissions, continue processing what we have
            if (allSubmissions.length > 0) {
              hasMoreSubmissions = false;
              break;
            }
          }
          
          // For 403 errors, we'll stop after the current batch
          if (response.status === 403) {
            hasMoreSubmissions = false;
          }
          
          // For other errors, we'll try the next batch
          offset += batchSize;
          continue;
        }
        
        // Reset consecutive error count on success
        consecutiveErrorCount = 0;
        
        const data = await response.json();
        const submissions = data.submissions_dump || [];
        
        console.log(`[LeetAnki Debug] Fetched ${submissions.length} submissions from offset ${offset}`);
        
        if (submissions.length === 0) {
          hasMoreSubmissions = false;
          break;
        }
        
        // Add the submissions to our collection
        allSubmissions.push(...submissions);
        
        // Update for next iteration
        offset += submissions.length;
        
        // If there's a last_key in the response, use it for the next request
        if (data.last_key) {
          lastKey = data.last_key;
        }
      } catch (error) {
        console.error(`[LeetAnki Debug] Error fetching submissions batch:`, error);
        consecutiveErrorCount++;
        
        // Show error in status, but continue trying
        showSyncStatus(`Error fetching batch. Retrying... (${consecutiveErrorCount}/${maxConsecutiveErrors})`);
      }
    }

    console.log(`[LeetAnki Debug] Fetched a total of ${allSubmissions.length} submissions from API`);
    showSyncStatus(`Processing ${allSubmissions.length} submissions...`);

    // Process the submissions to extract unique problems with timestamps
    const submissionMap = new Map();
    
    // Process each submission and normalize format
    allSubmissions.forEach(submission => {
      const titleSlug = submission.title_slug || submission.titleSlug;
      
      // Skip if no title slug (this should not happen normally)
      if (!titleSlug) return;
      
      const timestamp = submission.timestamp || new Date(submission.time || Date.now()).getTime() / 1000;
      const status = submission.status_display || submission.statusDisplay;
      const isAccepted = status === 'Accepted';
      
      // If we don't already have this problem, or if this submission is newer, update
      if (!submissionMap.has(titleSlug) || submissionMap.get(titleSlug).timestamp < timestamp) {
        submissionMap.set(titleSlug, {
          titleSlug,
          title: submission.title || formatTitleFromSlug(titleSlug),
          timestamp,
          status,
          isAccepted
        });
      }
    });
    
    // Convert the map to an array of problems
    let uniqueProblems = Array.from(submissionMap.values());
    console.log(`[LeetAnki Debug] Got ${uniqueProblems.length} unique problems after deduplication`);
    
    // Filter to accepted submissions only
    const acceptedProblems = uniqueProblems.filter(problem => problem.isAccepted);
    console.log(`[LeetAnki Debug] Found ${acceptedProblems.length} accepted submissions`);
    
    // Update status with the number of problems found
    showSyncStatus(`Found ${acceptedProblems.length} unique solved problems!`);
    
    // Format the problems for storage
    return acceptedProblems.map(problem => ({
      titleSlug: problem.titleSlug,
      title: problem.title,
      timestamp: problem.timestamp
    }));
  } catch (error) {
    console.error(`[LeetAnki Debug] Error in fetchSubmissionProblems:`, error);
    showSyncStatus(`Error retrieving submissions: ${error.message}`, true);
    return [];
  }
}

/**
 * Format a readable title from a title slug
 * @param {string} slug - The title slug
 * @returns {string} Formatted title
 */
function formatTitleFromSlug(slug) {
  return slug.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

/**
 * Merge two arrays of completed problems, keeping the most recent submission for each problem
 * @param {Array} existingProblems - Previously stored completed problems
 * @param {Array} newProblems - Newly fetched completed problems
 * @returns {Array} Merged array of unique problems with most recent submissions
 */
function mergeCompletedProblems(existingProblems, newProblems) {
  // Create a map from existing problems
  const problemsMap = {};
  
  // Add existing problems to the map
  existingProblems.forEach(problem => {
    problemsMap[problem.titleSlug] = problem;
  });
  
  // Add or update with new problems
  newProblems.forEach(problem => {
    if (!problemsMap[problem.titleSlug] || 
        new Date(problem.timestamp) > new Date(problemsMap[problem.titleSlug].timestamp)) {
      problemsMap[problem.titleSlug] = problem;
    }
  });
  
  // Convert map back to array
  return Object.values(problemsMap);
}

// Update the message handler to use the new GraphQL functions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[LeetAnki Debug] Received message:', message);
  
  if (message.action === 'isContentScriptReady') {
    // Immediately respond that the content script is ready
    sendResponse({ ready: true, pageUrl: window.location.href });
    return false; // No async response needed
  }
  
  if (message.action === 'checkAuthStatus') {
    isUserAuthenticated()
      .then(authInfo => {
        console.log('[LeetAnki Debug] Auth status API result:', authInfo);
        sendResponse(authInfo);
      })
      .catch(error => {
        console.error('[LeetAnki Debug] Auth check error:', error);
        sendResponse({ isAuthenticated: false });
      });
    return true; // Indicates async response
  }
  
  if (message.action === 'fetchSolvedProblems') {
    isUserAuthenticated()
      .then(authInfo => {
        if (authInfo.isAuthenticated) {
          // Store username in the global variable and pass it to the function
          currentUser = authInfo.username;
          return fetchCompletedProblems();
        } else {
          console.log('[LeetAnki Debug] Cannot fetch solved problems - user not authenticated');
          return [];
        }
      })
      .then(problems => {
        console.log('[LeetAnki Debug] Fetched solved problems:', problems.length);
        sendResponse({ success: true, problems });
      })
      .catch(error => {
        console.error('[LeetAnki Debug] Error in fetchSolvedProblems:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates async response
  }
  
  if (message.action === 'checkProblemStatus') {
    const status = LeetCodeDOM.extractProblemCompletionStatus();
    sendResponse({ status: status });
    return false;
  }
  
  return false;
});

// Wait for utility scripts to load, then start the script
window.addEventListener('DOMContentLoaded', () => {
  debugLog('DOMContentLoaded event fired');
  
  // Check if utilities are loaded every 100ms until they're available
  const checkInterval = setInterval(() => {
    if (window.LeetCodeAPI && window.LeetCodeDOM) {
      clearInterval(checkInterval);
      debugLog('Utilities loaded, initializing');
      initialize();
    } else {
      debugLog('Waiting for utilities to load...');
    }
  }, 100);
  
  // Timeout after 5 seconds to avoid infinite checking
  setTimeout(() => {
    clearInterval(checkInterval);
    if (!window.LeetCodeAPI || !window.LeetCodeDOM) {
      console.error('LeetAnki: Failed to load utilities after timeout');
    }
  }, 5000);
});

// Also try to initialize on load event as a fallback
window.addEventListener('load', () => {
  debugLog('Window load event fired');
  if (!LeetCodeAPI || !LeetCodeDOM) {
    debugLog('Trying to initialize on window load');
    // Check if utilities are loaded every 100ms until they're available
    const checkInterval = setInterval(() => {
      if (window.LeetCodeAPI && window.LeetCodeDOM) {
        clearInterval(checkInterval);
        debugLog('Utilities loaded on window load, initializing');
        initialize();
      }
    }, 100);
    
    // Timeout after 5 seconds to avoid infinite checking
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 5000);
  }
});

// After successful authentication check
async function checkAndUpdateAuthStatus() {
  const authInfo = await isUserAuthenticated();
  console.log('[LeetAnki Debug] Authentication check result:', authInfo.isAuthenticated);
  
  // Store the auth status in local storage
  chrome.storage.local.set({ 
    authStatus: authInfo.isAuthenticated,
    username: authInfo.username || null,
    userId: authInfo.userId || null
  }, () => {
    console.log('[LeetAnki Debug] Updated auth status in storage:', authInfo.isAuthenticated);
  });
  
  return authInfo;
} 