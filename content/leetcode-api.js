/**
 * LeetCode API - GraphQL client for LeetAnki
 * 
 * Provides functions to interact with LeetCode's GraphQL API
 * for fetching user data, problem information, and submissions.
 */

window.LeetCodeAPI = (function() {
  // GraphQL API endpoint
  const API_URL = 'https://leetcode.com/graphql';
  
  // Enable debug logging
  const DEBUG = true;
  
  // Helper function for debug logging
  function log(...args) {
    if (DEBUG) console.log('[LeetCode API]', ...args);
  }
  
  // Generic GraphQL request function with retries and backoff
  async function graphqlRequest(query, variables, maxRetries = 3) {
    let retries = 0;
    
    while (retries <= maxRetries) {
      try {
        if (retries > 0) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, retries), 10000);
          log(`Retry ${retries}/${maxRetries} after ${delay}ms delay`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: query,
            variables: variables
          }),
          credentials: 'include' // Include cookies for auth
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.errors && data.errors.length > 0) {
          throw new Error(`GraphQL error: ${data.errors[0].message}`);
        }
        
        return data.data;
      } catch (error) {
        log(`Request failed (attempt ${retries + 1}):`, error);
        retries++;
        
        if (retries > maxRetries) {
          throw error;
        }
      }
    }
  }
  
  // Query to check if user is authenticated
  const AUTH_STATUS_QUERY = `
    query userStatus {
      userStatus {
        userId
        isSignedIn
        username
      }
    }
  `;
  
  // Query to get all tags (for hierarchical knowledge structure)
  const ALL_TAGS_QUERY = `
    query allTopicTags {
      topics: topicTags {
        name
        id
        slug
      }
    }
  `;
  
  // Query to get user's solved problems with their tags
  // This uses known working endpoints from the reference
  const SOLVED_PROBLEMS_QUERY = `
    query userSolvedProblems($username: String!) {
      allQuestionsCount {
        difficulty
        count
      }
      matchedUser(username: $username) {
        submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
        tagProblemCounts {
          advanced {
            tagName
            tagSlug
            problemsSolved
          }
          intermediate {
            tagName
            tagSlug
            problemsSolved
          }
          fundamental {
            tagName
            tagSlug
            problemsSolved
          }
        }
      }
    }
  `;
  
  // Query to get recent accepted submissions (for finding solved problems)
  const RECENT_AC_SUBMISSIONS_QUERY = `
    query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id
        title
        titleSlug
        timestamp
        lang
        memory
        runtime
        url
        __typename
      }
    }
  `;
  
  // Query to get detailed problem information
  const PROBLEM_DETAILS_QUERY = `
    query problemDetails($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        titleSlug
        content
        difficulty
        stats
        similarQuestions
        topicTags {
          name
          slug
          id
        }
        companyTagStats
        hints
      }
    }
  `;
  
  /**
   * Check if the user is authenticated
   * @returns {Promise<Object>} Authentication status
   */
  async function checkAuth() {
    try {
      const data = await graphqlRequest(AUTH_STATUS_QUERY);
      
      const isAuthenticated = !!(data?.userStatus?.isSignedIn);
      const username = data?.userStatus?.username || null;
      const userId = data?.userStatus?.userId || null;
      
      return {
        isAuthenticated,
        username,
        userId
      };
    } catch (error) {
      log('Error checking auth status:', error);
      return { isAuthenticated: false };
    }
  }
  
  /**
   * Fetch all topic tags from LeetCode
   * @returns {Promise<Object>} Map of tag slugs to tag data
   */
  async function fetchAllTags() {
    try {
      const data = await graphqlRequest(ALL_TAGS_QUERY);
      
      if (!data?.topics) {
        throw new Error('Failed to fetch topic tags');
      }
      
      // Create a map of tags by slug
      const tagsMap = {};
      
      // First pass - create all tags
      data.topics.forEach(tag => {
        tagsMap[tag.slug] = {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          parentTags: [],
          childTags: []
        };
      });
      
      // Generate hierarchical relationships based on name prefixes
      // For example, "dynamic-programming" is a parent of "dynamic-programming-2d"
      Object.values(tagsMap).forEach(tag => {
        Object.values(tagsMap).forEach(otherTag => {
          if (tag.slug !== otherTag.slug && 
              otherTag.slug.startsWith(tag.slug + '-')) {
            // tag is a parent of otherTag
            tag.childTags.push(otherTag.slug);
            otherTag.parentTags.push(tag.slug);
          }
        });
      });
      
      return tagsMap;
    } catch (error) {
      log('Error fetching tags:', error);
      throw error;
    }
  }
  
  /**
   * Fetch all solved problems for a user
   * @param {string} username - The username to fetch data for
   * @returns {Promise<Object>} Solved problems and related stats
   */
  async function fetchSolvedProblems(username) {
    try {
      if (!username) {
        throw new Error('Username is required');
      }
      
      log(`Fetching solved problems for ${username}`);
      
      // Step 1: Get user stats and tag information
      const statsData = await graphqlRequest(SOLVED_PROBLEMS_QUERY, { username });
      
      if (!statsData?.matchedUser) {
        throw new Error('Failed to fetch user stats');
      }
      
      // Step 2: Get recent submissions (up to 500 to ensure we get most/all problems)
      const submissionsData = await graphqlRequest(RECENT_AC_SUBMISSIONS_QUERY, { 
        username, 
        limit: 500 
      });
      
      if (!submissionsData?.recentAcSubmissionList) {
        throw new Error('Failed to fetch user submissions');
      }
      
      const submissions = submissionsData.recentAcSubmissionList;
      log(`Retrieved ${submissions.length} recent submissions`);
      
      // Process the data to create problems and tags maps
      const problems = {};
      const tags = {};
      
      // Process tag information from user stats
      const processTagCategory = (category) => {
        if (!statsData.matchedUser.tagProblemCounts?.[category]) return;
        
        statsData.matchedUser.tagProblemCounts[category].forEach(tag => {
          if (tag.problemsSolved > 0) {
            tags[tag.tagSlug] = {
              name: tag.tagName,
              slug: tag.tagSlug,
              count: tag.problemsSolved,
              category: category
            };
          }
        });
      };
      
      // Process each tag category
      processTagCategory('advanced');
      processTagCategory('intermediate');
      processTagCategory('fundamental');
      
      // Process submission data to get problems
      const processedTitleSlugs = new Set();
      
      submissions.forEach(submission => {
        // Skip if we've already processed this problem
        if (processedTitleSlugs.has(submission.titleSlug)) return;
        processedTitleSlugs.add(submission.titleSlug);
        
        const timestamp = submission.timestamp 
          ? new Date(submission.timestamp * 1000).toISOString()
          : new Date().toISOString();
          
        problems[submission.titleSlug] = {
          title: submission.title,
          titleSlug: submission.titleSlug,
          // Initial difficulty (will be updated with problem details fetch)
          difficulty: 'Medium', 
          completedAt: timestamp,
          url: `https://leetcode.com/problems/${submission.titleSlug}/`,
          // Will populate tags later with problem details
          tags: []
        };
      });
      
      // Get total solved counts from stats
      const totalSolved = statsData.matchedUser.submitStatsGlobal.acSubmissionNum.find(
        s => s.difficulty === 'All'
      )?.count || 0;
      
      const easySolved = statsData.matchedUser.submitStatsGlobal.acSubmissionNum.find(
        s => s.difficulty === 'Easy'
      )?.count || 0;
      
      const mediumSolved = statsData.matchedUser.submitStatsGlobal.acSubmissionNum.find(
        s => s.difficulty === 'Medium'
      )?.count || 0;
      
      const hardSolved = statsData.matchedUser.submitStatsGlobal.acSubmissionNum.find(
        s => s.difficulty === 'Hard'
      )?.count || 0;
      
      log(`Found ${Object.keys(problems).length} solved problems out of expected ${totalSolved}`);
      
      // Return stats and problems
      return {
        problems,
        tags,
        stats: {
          total: totalSolved,
          byDifficulty: {
            easy: easySolved,
            medium: mediumSolved,
            hard: hardSolved
          }
        }
      };
    } catch (error) {
      log('Error fetching solved problems:', error);
      throw error;
    }
  }
  
  /**
   * Fetch detailed information about a problem
   * @param {string} titleSlug - The problem's titleSlug
   * @returns {Promise<Object>} Detailed problem data
   */
  async function fetchProblemDetails(titleSlug) {
    try {
      if (!titleSlug) {
        throw new Error('Problem titleSlug is required');
      }
      
      log(`Fetching details for problem: ${titleSlug}`);
      
      const data = await graphqlRequest(PROBLEM_DETAILS_QUERY, { titleSlug });
      
      if (!data?.question) {
        throw new Error(`Failed to fetch details for problem: ${titleSlug}`);
      }
      
      const question = data.question;
      
      // Parse stats if available
      let stats = {};
      try {
        if (question.stats) {
          stats = JSON.parse(question.stats);
        }
      } catch (e) {
        log(`Error parsing stats for ${titleSlug}:`, e);
      }
      
      // Parse similar questions if available
      let similarQuestions = [];
      try {
        if (question.similarQuestions) {
          similarQuestions = JSON.parse(question.similarQuestions);
        }
      } catch (e) {
        log(`Error parsing similar questions for ${titleSlug}:`, e);
      }
      
      return {
        id: question.questionId,
        frontendId: question.questionFrontendId,
        title: question.title,
        titleSlug: question.titleSlug,
        content: question.content,
        difficulty: question.difficulty,
        tags: question.topicTags.map(tag => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug
        })),
        hints: question.hints || [],
        stats: {
          totalAccepted: stats.totalAcceptedRaw,
          totalSubmission: stats.totalSubmissionRaw,
          acceptanceRate: stats.acRate
        },
        similarQuestions: similarQuestions.map(q => ({
          titleSlug: q.titleSlug,
          title: q.title,
          difficulty: q.difficulty
        }))
      };
    } catch (error) {
      log('Error fetching problem details:', error);
      throw error;
    }
  }
  
  /**
   * Fetch details for multiple problems in batches
   * @param {Array<string>} titleSlugs - Array of problem titleSlugs
   * @param {number} batchSize - Number of problems per batch
   * @returns {Promise<Object>} Map of titleSlugs to problem details
   */
  async function fetchProblemsDetails(titleSlugs, batchSize = 5) {
    try {
      if (!titleSlugs || !Array.isArray(titleSlugs) || titleSlugs.length === 0) {
        return {};
      }
      
      log(`Fetching details for ${titleSlugs.length} problems`);
      
      const problemsMap = {};
      const batches = [];
      
      // Split into batches
      for (let i = 0; i < titleSlugs.length; i += batchSize) {
        batches.push(titleSlugs.slice(i, i + batchSize));
      }
      
      log(`Processing ${batches.length} batches of size ${batchSize}`);
      
      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        log(`Processing batch ${i+1}/${batches.length} with ${batch.length} problems`);
        
        // Add a delay between batches to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Process problems in parallel within the batch
        const promises = batch.map(titleSlug => fetchProblemDetails(titleSlug));
        const results = await Promise.all(promises);
        
        // Add to the map
        batch.forEach((titleSlug, index) => {
          problemsMap[titleSlug] = results[index];
        });
      }
      
      return problemsMap;
    } catch (error) {
      log('Error fetching problems details:', error);
      throw error;
    }
  }
  
  // Return the public API
  return {
    checkAuth,
    fetchAllTags,
    fetchSolvedProblems,
    fetchProblemDetails,
    fetchProblemsDetails
  };
})();