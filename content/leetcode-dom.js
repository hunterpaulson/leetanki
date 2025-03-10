/**
 * LeetCode DOM Scraping Utilities
 * 
 * This module provides functions to extract LeetCode data via DOM scraping
 * as a fallback when API access is restricted.
 */

// Create a namespace for LeetCode DOM functions
window.LeetCodeDOM = (function() {
  // Debug flag
  const debugMode = true;
  
  // Helper function for debug logging
  function debugLog(...args) {
    if (debugMode) {
      console.log('[LeetCode DOM]', ...args);
    }
  }
  
  /**
   * Extract problem metadata from the problem page
   * @returns {Object|null} Problem metadata or null if not on a problem page
   */
  function extractProblemMetadata() {
    try {
      // Check if we're on a problem page
      if (!window.location.pathname.includes('/problems/')) {
        return null;
      }
      
      debugLog('Extracting problem metadata');
      
      // Extract problem slug from URL
      const pathParts = window.location.pathname.split('/');
      const problemSlug = pathParts[pathParts.indexOf('problems') + 1];
      
      // Alternative methods to extract problem details
      
      // Method 1: Extract from page title
      const pageTitle = document.title;
      let title = '';
      if (pageTitle) {
        // Usually format is "Problem Name - LeetCode"
        const titleMatch = pageTitle.match(/(.*?)\s-\sLeetCode/);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        }
      }
      
      // Method 2: Extract from question title element
      if (!title) {
        const titleSelectors = [
          'div[data-cy="question-title"]',
          '.question-title',
          'h4.question-title',
          '.css-v3d350',
          '.title-container'
        ];
        
        for (const selector of titleSelectors) {
          const titleElement = document.querySelector(selector);
          if (titleElement) {
            title = titleElement.textContent.trim();
            break;
          }
        }
      }
      
      // Extract difficulty - using multiple possible selectors
      const difficultySelectors = [
        '.css-10o4wqw',
        '.difficulty-label',
        '.question-difficulty',
        '.diff-level'
      ];
      
      let difficulty = 'Medium'; // Default
      let difficultyElement = null;
      
      for (const selector of difficultySelectors) {
        difficultyElement = document.querySelector(selector);
        if (difficultyElement) break;
      }
      
      if (difficultyElement) {
        const difficultyText = difficultyElement.textContent.trim().toLowerCase();
        if (difficultyText.includes('easy')) {
          difficulty = 'Easy';
        } else if (difficultyText.includes('medium')) {
          difficulty = 'Medium';
        } else if (difficultyText.includes('hard')) {
          difficulty = 'Hard';
        }
      }
      
      // Extract problem ID using multiple possible selectors
      const idSelectors = [
        '.mr-2.text-lg',
        '.question-id',
        '.question-index',
        'span[data-cy="question-number"]'
      ];
      
      let problemId = '';
      for (const selector of idSelectors) {
        const idElement = document.querySelector(selector);
        if (idElement) {
          problemId = idElement.textContent.trim().replace(/\D/g, ''); // Keep only digits
          break;
        }
      }
      
      // If we still don't have an ID, try to extract from the page
      if (!problemId) {
        // Look for patterns like "#123" or "Problem 123" in the page
        const idRegex = /#(\d+)|Problem\s+(\d+)/;
        const pageText = document.body.textContent;
        const match = pageText.match(idRegex);
        if (match) {
          problemId = match[1] || match[2];
        }
      }
      
      // Extract topics/tags with multiple selectors
      const tagSelectors = [
        'a.inline-block.mr-2.mb-2',
        '.topic-tag',
        '.tag-label',
        '.css-k7s5ux'
      ];
      
      let topicElements = [];
      for (const selector of tagSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          topicElements = Array.from(elements);
          break;
        }
      }
      
      const topics = topicElements.map(el => ({
        name: el.textContent.trim(),
        slug: el.getAttribute('href')?.split('/').pop() || ''
      }));
      
      const result = {
        id: problemId,
        title: title,
        titleSlug: problemSlug,
        difficulty: difficulty,
        topics: topics,
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      
      debugLog('Extracted problem metadata:', result);
      return result;
    } catch (error) {
      console.error('Error extracting problem metadata:', error);
      return null;
    }
  }

  /**
   * Extract user's solved problems from the profile page
   * @returns {Object|null} User's solved problems stats or null if not on profile page
   */
  function extractProfileSolvedProblems() {
    try {
      // Check if we're on a profile page
      if (!window.location.pathname.includes('/u/')) {
        return null;
      }
      
      debugLog('Extracting profile solved problems');
      
      // Extract username from URL
      const pathParts = window.location.pathname.split('/');
      const username = pathParts[pathParts.indexOf('u') + 1];
      
      // Different selectors to try for extraction
      const statSelectors = [
        // New LeetCode UI
        '.items-start.pt-4',
        '.profile-content',
        // Old LeetCode UI
        '.profile-statistics',
        '.list-group'
      ];
      
      let statsContainer = null;
      for (const selector of statSelectors) {
        statsContainer = document.querySelector(selector);
        if (statsContainer) break;
      }
      
      if (!statsContainer) {
        debugLog('Could not find stats container');
        return null;
      }
      
      // Try different selectors for total solved problems
      const totalSolvedSelectors = [
        'div.text-[24px]',
        '.total-solved',
        '.total-solved-container',
        '.progress-bar-success'
      ];
      
      let totalSolvedElement = null;
      for (const selector of totalSolvedSelectors) {
        totalSolvedElement = statsContainer.querySelector(selector);
        if (totalSolvedElement) break;
      }
      
      // Extract total solved
      const totalSolved = totalSolvedElement ? 
        parseInt(totalSolvedElement.textContent.match(/\d+/) ? totalSolvedElement.textContent.match(/\d+/)[0] : '0', 10) : 0;
      
      // Fallback: scan for numbers next to difficulty labels
      let easySolved = 0;
      let mediumSolved = 0;
      let hardSolved = 0;
      
      // First method: Look for elements with specific classes
      const difficultySelectors = [
        // Try to match elements that contain difficulty text
        '.flex.items-center.space-x-2',
        '.difficulty-breakup',
        '.difficulty-level'
      ];
      
      let difficultyElements = [];
      for (const selector of difficultySelectors) {
        difficultyElements = document.querySelectorAll(selector);
        if (difficultyElements.length > 0) break;
      }
      
      if (difficultyElements.length > 0) {
        Array.from(difficultyElements).forEach(element => {
          const text = element.textContent.trim().toLowerCase();
          const match = text.match(/\d+/);
          const number = match ? parseInt(match[0], 10) : 0;
          
          if (text.includes('easy')) {
            easySolved = number;
          } else if (text.includes('medium')) {
            mediumSolved = number;
          } else if (text.includes('hard')) {
            hardSolved = number;
          }
        });
      } else {
        // Second method: look for specific difficulty labels and adjacent numbers
        const allElements = document.querySelectorAll('*');
        for (const element of allElements) {
          const text = element.textContent.trim().toLowerCase();
          
          if (text.includes('easy') && !easySolved) {
            const match = text.match(/\d+/);
            if (match) easySolved = parseInt(match[0], 10);
          } else if (text.includes('medium') && !mediumSolved) {
            const match = text.match(/\d+/);
            if (match) mediumSolved = parseInt(match[0], 10);
          } else if (text.includes('hard') && !hardSolved) {
            const match = text.match(/\d+/);
            if (match) hardSolved = parseInt(match[0], 10);
          }
        }
      }
      
      // Sanity check: total should be close to sum of parts
      const sumOfParts = easySolved + mediumSolved + hardSolved;
      if (Math.abs(totalSolved - sumOfParts) > 10 && sumOfParts > 0) {
        debugLog('Warning: Total solved does not match sum of difficulties');
      }
      
      const result = {
        username: username,
        totalSolved: totalSolved,
        easySolved: easySolved,
        mediumSolved: mediumSolved,
        hardSolved: hardSolved,
        timestamp: new Date().toISOString()
      };
      
      debugLog('Extracted profile data:', result);
      return result;
    } catch (error) {
      console.error('Error extracting profile solved problems:', error);
      return null;
    }
  }

  /**
   * Extract problem completion status from the problem page
   * @returns {Object|null} Problem completion status or null if not available
   */
  function extractProblemCompletionStatus() {
    try {
      // Check if we're on a problem page
      if (!window.location.pathname.includes('/problems/')) {
        return null;
      }
      
      debugLog('Extracting problem completion status');
      
      // Multiple selectors to check for success indicators
      const successSelectors = [
        '.text-green-s',
        '[data-e2e-locator="submission-result-status"]',
        '.text-success',
        '.success-icon',
        '.success-container',
        '.result-container .success',
        '.submission-result .success'
      ];
      
      let isCompleted = false;
      for (const selector of successSelectors) {
        const element = document.querySelector(selector);
        if (element && (
          element.textContent.includes('Accepted') || 
          element.textContent.includes('Success') ||
          element.classList.contains('text-success')
        )) {
          isCompleted = true;
          break;
        }
      }
      
      // Alternative method: check if the page contains success indicators
      if (!isCompleted) {
        const resultContainer = document.querySelector('.result-container, .submission-result');
        if (resultContainer) {
          const resultText = resultContainer.textContent.toLowerCase();
          if (resultText.includes('accepted') || resultText.includes('success')) {
            isCompleted = true;
          }
        }
      }
      
      // Get problem metadata
      const metadata = extractProblemMetadata();
      if (!metadata) {
        debugLog('Could not extract problem metadata');
        return null;
      }
      
      const result = {
        ...metadata,
        status: isCompleted ? 'AC' : 'TRIED',
        completedAt: isCompleted ? new Date().toISOString() : null
      };
      
      debugLog('Problem completion status:', result.status);
      return result;
    } catch (error) {
      console.error('Error extracting problem completion status:', error);
      return null;
    }
  }

  /**
   * Observe problem completion events
   * @param {Function} callback - Function to call when a problem is completed
   * @returns {MutationObserver} The observer instance
   */
  function observeProblemCompletion(callback) {
    debugLog('Setting up problem completion observer');
    
    // Possible targets where success notifications appear
    const possibleTargets = [
      document.querySelector('#app'),
      document.querySelector('#result-container'),
      document.querySelector('.submission-result'),
      document.querySelector('.result-container'),
      document.querySelector('.react-container'),
      document.body
    ].filter(el => el !== null);
    
    const observer = new MutationObserver((mutations) => {
      // Only check after significant DOM changes
      let shouldCheck = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldCheck = true;
          break;
        }
      }
      
      if (shouldCheck) {
        const completionStatus = extractProblemCompletionStatus();
        if (completionStatus && completionStatus.status === 'AC') {
          debugLog('Problem completion detected via observer');
          callback(completionStatus);
        }
      }
    });
    
    // Observe all possible targets
    const config = { childList: true, subtree: true };
    possibleTargets.forEach(target => observer.observe(target, config));
    
    debugLog('Problem completion observer set up on', possibleTargets.length, 'targets');
    return observer;
  }

  /**
   * Extract recent submissions from the submissions page
   * @returns {Array|null} Array of recent submissions or null if not on submissions page
   */
  function extractRecentSubmissions() {
    try {
      // Check if we're on a submissions page
      if (!window.location.pathname.includes('/submissions/')) {
        return null;
      }
      
      debugLog('Extracting recent submissions');
      
      // Multiple approaches to find submission data
      
      // Method 1: Table-based layout
      const submissionRows = document.querySelectorAll('table tbody tr');
      if (submissionRows.length > 0) {
        debugLog('Found submission table with', submissionRows.length, 'rows');
        
        const submissions = [];
        submissionRows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const titleElement = cells[1].querySelector('a');
            const statusElement = cells[2];
            const timeElement = cells[3];
            
            if (titleElement && statusElement) {
              const title = titleElement.textContent.trim();
              const href = titleElement.getAttribute('href') || '';
              const titleSlug = href.split('/').filter(Boolean).pop();
              const status = statusElement.textContent.includes('Accepted') ? 'AC' : 'FAILED';
              const timestamp = timeElement ? timeElement.textContent.trim() : '';
              
              submissions.push({
                title: title,
                titleSlug: titleSlug,
                status: status,
                timestamp: timestamp,
                url: `https://leetcode.com/problems/${titleSlug}/`
              });
            }
          }
        });
        
        debugLog('Extracted', submissions.length, 'submissions from table');
        return submissions;
      }
      
      // Method 2: Card-based layout
      const submissionCards = document.querySelectorAll('.submission, .submission-card');
      if (submissionCards.length > 0) {
        debugLog('Found', submissionCards.length, 'submission cards');
        
        const submissions = [];
        submissionCards.forEach(card => {
          const titleElement = card.querySelector('.title a, .problem-title a');
          const statusElement = card.querySelector('.status, .result-status');
          
          if (titleElement && statusElement) {
            const title = titleElement.textContent.trim();
            const href = titleElement.getAttribute('href') || '';
            const titleSlug = href.split('/').filter(Boolean).pop();
            const status = statusElement.textContent.toLowerCase().includes('accepted') ? 'AC' : 'FAILED';
            
            // Try to find timestamp
            const timeElement = card.querySelector('.time, .date');
            const timestamp = timeElement ? timeElement.textContent.trim() : '';
            
            submissions.push({
              title: title,
              titleSlug: titleSlug,
              status: status,
              timestamp: timestamp,
              url: `https://leetcode.com/problems/${titleSlug}/`
            });
          }
        });
        
        debugLog('Extracted', submissions.length, 'submissions from cards');
        return submissions;
      }
      
      // Method 3: List-based layout
      const submissionItems = document.querySelectorAll('.submissions-list .list-item, .submission-list .item');
      if (submissionItems.length > 0) {
        debugLog('Found', submissionItems.length, 'submission list items');
        
        const submissions = [];
        submissionItems.forEach(item => {
          const titleElement = item.querySelector('.title a, .problem-title a');
          const statusElement = item.querySelector('.status, .result');
          
          if (titleElement && statusElement) {
            const title = titleElement.textContent.trim();
            const href = titleElement.getAttribute('href') || '';
            const titleSlug = href.split('/').filter(Boolean).pop();
            const status = statusElement.textContent.toLowerCase().includes('accepted') ? 'AC' : 'FAILED';
            
            submissions.push({
              title: title,
              titleSlug: titleSlug,
              status: status,
              timestamp: new Date().toISOString(), // Use current time as fallback
              url: `https://leetcode.com/problems/${titleSlug}/`
            });
          }
        });
        
        debugLog('Extracted', submissions.length, 'submissions from list items');
        return submissions;
      }
      
      // No submissions found with any method
      debugLog('No submissions found on page');
      return [];
    } catch (error) {
      console.error('Error extracting recent submissions:', error);
      return null;
    }
  }

  // Return the public API
  return {
    extractProblemMetadata,
    extractProfileSolvedProblems,
    extractProblemCompletionStatus,
    observeProblemCompletion,
    extractRecentSubmissions
  };
})(); 