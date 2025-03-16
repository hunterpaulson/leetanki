/**
 * LeetAnki Popup Script
 * 
 * Handles the popup UI interactions and displays user data,
 * problem lists, and review options.
 */

// Constants for storage keys (keep in sync with background.js)
const STORAGE_KEYS = {
  AUTH_STATUS: 'authStatus',
  USER_INFO: 'userInfo',
  PROBLEMS: 'problems',
  TAGS: 'tags', 
  REVIEW_DATA: 'reviewData',
  LAST_SYNC: 'lastSync',
  SETTINGS: 'settings'
};

// Elements
const loginMessage = document.getElementById('login-message');
const mainContent = document.getElementById('main-content');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const dueProblems = document.getElementById('due-problems');
const recommendedProblems = document.getElementById('recommended-problems');
const syncButton = document.getElementById('sync-button');
const settingsButton = document.getElementById('settings-button');

// User info elements
const username = document.getElementById('username');
const userAvatar = document.getElementById('user-avatar');
const profileLink = document.getElementById('profile-link');
const totalSolved = document.getElementById('total-solved');
const easySolved = document.getElementById('easy-solved');
const mediumSolved = document.getElementById('medium-solved');
const hardSolved = document.getElementById('hard-solved');

// Stats elements
const completedCount = document.getElementById('completed-count');
const reviewedCount = document.getElementById('reviewed-count');
const lastSync = document.getElementById('last-sync');

// Initialize the popup
async function initialize() {
  try {
    // Get authentication status
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.AUTH_STATUS,
      STORAGE_KEYS.USER_INFO
    ]);
    
    const isAuthenticated = data[STORAGE_KEYS.AUTH_STATUS];
    
    if (isAuthenticated) {
      // Show main content
      loginMessage.style.display = 'none';
      mainContent.style.display = 'block';
      
      // Update user info
      updateUserInfo(data[STORAGE_KEYS.USER_INFO]);
      
      // Load problems and stats
      await loadProblems();
      await updateStats();
      
      // Get due reviews
      await loadDueReviews();
      
      // Load recommended problems
      await loadRecommendedProblems();
    } else {
      // Show login message
      loginMessage.style.display = 'block';
      mainContent.style.display = 'none';
    }
  } catch (error) {
    showError('Error initializing popup: ' + error.message);
    console.error('Error initializing popup:', error);
  }
}

// Update user information display
function updateUserInfo(userInfo) {
  if (!userInfo) return;
  
  username.textContent = userInfo.username;
  profileLink.href = `https://leetcode.com/${userInfo.username}/`;
  
  // Set default avatar (can be customized later)
  userAvatar.src = `https://leetcode.com/avatar/${userInfo.username}.png` || 
                   'https://leetcode.com/static/images/avatar-default.png';
}

// Load problems from storage
async function loadProblems() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROBLEMS
    ]);
    
    const problems = data[STORAGE_KEYS.PROBLEMS] || {};
    
    // Count problems by difficulty
    let easy = 0, medium = 0, hard = 0;
    
    Object.values(problems).forEach(problem => {
      switch (problem.difficulty.toLowerCase()) {
        case 'easy':
          easy++;
          break;
        case 'medium':
          medium++;
          break;
        case 'hard':
          hard++;
          break;
      }
    });
    
    // Update UI
    totalSolved.textContent = Object.keys(problems).length;
    easySolved.textContent = easy;
    mediumSolved.textContent = medium;
    hardSolved.textContent = hard;
    
    return problems;
  } catch (error) {
    showError('Error loading problems: ' + error.message);
    console.error('Error loading problems:', error);
    return {};
  }
}

// Load due reviews
async function loadDueReviews() {
  try {
    // Request due reviews from the background script
    const response = await chrome.runtime.sendMessage({ action: 'getDueReviews' });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to load due reviews');
    }
    
    const reviews = response.reviews || [];
    
    // Update UI
    dueProblems.innerHTML = '';
    
    if (reviews.length === 0) {
      dueProblems.innerHTML = '<p class="no-items">No problems due for review</p>';
      return;
    }
    
    // Create a problem item for each review
    reviews.forEach(problem => {
      const problemEl = createProblemElement(problem);
      
      // Add review buttons
      const reviewButtons = document.createElement('div');
      reviewButtons.className = 'review-buttons';
      
      const buttons = [
        { text: 'Again', class: 'btn-again', result: 'again' },
        { text: 'Hard', class: 'btn-hard', result: 'hard' },
        { text: 'Good', class: 'btn-good', result: 'good' },
        { text: 'Easy', class: 'btn-easy', result: 'easy' }
      ];
      
      buttons.forEach(button => {
        const btnEl = document.createElement('button');
        btnEl.className = `review-btn ${button.class}`;
        btnEl.textContent = button.text;
        btnEl.addEventListener('click', () => recordReview(problem.titleSlug, button.result));
        reviewButtons.appendChild(btnEl);
      });
      
      problemEl.appendChild(reviewButtons);
      dueProblems.appendChild(problemEl);
    });
  } catch (error) {
    dueProblems.innerHTML = `<p class="error">Error loading reviews: ${error.message}</p>`;
    console.error('Error loading due reviews:', error);
  }
}

// Record a review result
async function recordReview(problemId, result) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'recordReview',
      problemId,
      result
    });
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to record review');
    }
    
    // Reload due reviews
    await loadDueReviews();
    await updateStats();
  } catch (error) {
    showError('Error recording review: ' + error.message);
    console.error('Error recording review:', error);
  }
}

// Load recommended problems
async function loadRecommendedProblems() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROBLEMS,
      STORAGE_KEYS.REVIEW_DATA,
      STORAGE_KEYS.TAGS
    ]);
    
    const problems = data[STORAGE_KEYS.PROBLEMS] || {};
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    const tags = data[STORAGE_KEYS.TAGS] || {};
    
    // Find problems that haven't been reviewed yet
    const unreviewed = Object.entries(problems)
      .filter(([titleSlug]) => !reviewData[titleSlug])
      .map(([_, problem]) => problem);
    
    // Select up to 5 random problems
    const recommended = unreviewed
      .sort(() => 0.5 - Math.random())
      .slice(0, 5);
    
    // Update UI
    recommendedProblems.innerHTML = '';
    
    if (recommended.length === 0) {
      recommendedProblems.innerHTML = '<p class="no-items">No recommendations available</p>';
      return;
    }
    
    // Create a problem item for each recommended problem
    recommended.forEach(problem => {
      const problemEl = createProblemElement(problem);
      recommendedProblems.appendChild(problemEl);
    });
  } catch (error) {
    recommendedProblems.innerHTML = `<p class="error">Error loading recommendations: ${error.message}</p>`;
    console.error('Error loading recommended problems:', error);
  }
}

// Create a problem element
function createProblemElement(problem) {
  const problemEl = document.createElement('div');
  problemEl.className = 'problem-item';
  
  const link = document.createElement('a');
  link.href = problem.url;
  link.className = 'problem-title';
  link.textContent = problem.title;
  link.target = '_blank';
  problemEl.appendChild(link);
  
  const difficulty = document.createElement('span');
  difficulty.className = `problem-difficulty difficulty-${problem.difficulty.toLowerCase()}`;
  difficulty.textContent = problem.difficulty;
  problemEl.appendChild(difficulty);
  
  return problemEl;
}

// Update statistics display
async function updateStats() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.PROBLEMS,
      STORAGE_KEYS.REVIEW_DATA,
      STORAGE_KEYS.LAST_SYNC
    ]);
    
    const problems = data[STORAGE_KEYS.PROBLEMS] || {};
    const reviewData = data[STORAGE_KEYS.REVIEW_DATA] || {};
    const lastSyncTime = data[STORAGE_KEYS.LAST_SYNC];
    
    // Update UI
    completedCount.textContent = Object.keys(problems).length;
    reviewedCount.textContent = Object.keys(reviewData).length;
    
    if (lastSyncTime) {
      const lastSyncDate = new Date(lastSyncTime);
      lastSync.textContent = lastSyncDate.toLocaleString();
    } else {
      lastSync.textContent = 'Never';
    }
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Show error message
function showError(message) {
  errorText.textContent = message;
  errorMessage.classList.remove('hidden');
  
  // Hide after 5 seconds
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);
}

// Add event listeners
syncButton.addEventListener('click', async () => {
  try {
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing...';
    
    // Find an active LeetCode tab
    const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
    
    if (tabs.length === 0) {
      // No LeetCode tab found, open one
      chrome.tabs.create({ url: 'https://leetcode.com/' });
      syncButton.disabled = false;
      syncButton.textContent = 'Sync Now';
      showError('Please sync again after LeetCode loads');
      return;
    }
    
    // Send sync message to content script
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'sync' });
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Sync failed');
    }
    
    // Reload data
    await loadProblems();
    await updateStats();
    await loadDueReviews();
    await loadRecommendedProblems();
    
    syncButton.textContent = 'Sync Complete!';
    setTimeout(() => {
      syncButton.disabled = false;
      syncButton.textContent = 'Sync Now';
    }, 2000);
  } catch (error) {
    syncButton.disabled = false;
    syncButton.textContent = 'Sync Now';
    showError('Error syncing: ' + error.message);
    console.error('Error syncing:', error);
  }
});

settingsButton.addEventListener('click', () => {
  // Placeholder for settings functionality
  alert('Settings feature coming soon!');
});

// Initialize the popup when the DOM is loaded
document.addEventListener('DOMContentLoaded', initialize);