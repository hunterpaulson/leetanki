/**
 * LeetCode API Integration
 * 
 * This module provides functions to interact with LeetCode's GraphQL API
 * to fetch user problem data and other information.
 */

// Create a namespace for LeetCode API functions
window.LeetCodeAPI = (function() {
  /**
   * LeetCode GraphQL API endpoint
   */
  const LEETCODE_API_ENDPOINT = 'https://leetcode.com/graphql';

  /**
   * GraphQL query to fetch all problems with their metadata
   */
  const ALL_PROBLEMS_QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total
    questions {
      acRate
      difficulty
      freqBar
      frontendQuestionId
      isFavor
      paidOnly
      status
      title
      titleSlug
      topicTags {
        name
        id
        slug
      }
      hasSolution
      hasVideoSolution
    }
  }
}
`;

  /**
   * GraphQL query to fetch a user's solved problems
   */
  const USER_SOLVED_PROBLEMS_QUERY = `
query userProblemsSolved($username: String!) {
  allQuestionsCount {
    difficulty
    count
  }
  matchedUser(username: $username) {
    submitStats {
      acSubmissionNum {
        difficulty
        count
        submissions
      }
    }
    problemsSolvedBeatsStats {
      difficulty
      percentage
    }
    submitStatsGlobal {
      acSubmissionNum {
        difficulty
        count
      }
    }
  }
  userProfileUserQuestionProgress(username: $username) {
    numAcceptedQuestions {
      difficulty
      count
    }
    numFailedQuestions {
      difficulty
      count
    }
    numUntouchedQuestions {
      difficulty
      count
    }
  }
}
`;

  /**
   * GraphQL query to fetch details about a user's solved problems
   */
  const USER_PROBLEM_DETAILS_QUERY = `
query userProfileQuestions($username: String!, $limit: Int, $skip: Int, $status: StatusFilterEnum!) {
  userProfileQuestions(username: $username, limit: $limit, skip: $skip, status: $status) {
    total
    questions {
      difficulty
      title
      titleSlug
      frontendQuestionId
      status
      lastSubmittedAt
      lastSubmissionSrc
      topicTags {
        name
        slug
      }
    }
  }
}
`;

  /**
   * Fetch all problems available on LeetCode with their metadata
   * @returns {Promise<Array>} Array of problem objects
   */
  async function fetchAllProblems() {
    try {
      const response = await fetch(LEETCODE_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: ALL_PROBLEMS_QUERY,
          variables: {
            categorySlug: "",
            skip: 0,
            limit: 2000, // Fetch a large number to get all problems
            filters: {}
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      return data.data.problemsetQuestionList.questions;
    } catch (error) {
      console.error('Error fetching all problems:', error);
      throw error;
    }
  }

  /**
   * Fetch solved problems for a specific user
   * @param {string} username - The LeetCode username
   * @returns {Promise<Object>} Object with user's problem-solving statistics
   */
  async function fetchUserSolvedProblems(username) {
    try {
      const response = await fetch(LEETCODE_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: USER_SOLVED_PROBLEMS_QUERY,
          variables: {
            username: username
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error(`Error fetching solved problems for user ${username}:`, error);
      throw error;
    }
  }

  /**
   * Fetch detailed information about problems a user has solved
   * @param {string} username - The LeetCode username
   * @param {string} status - Problem status ('AC', 'TRIED', 'NOT_STARTED')
   * @param {number} limit - Number of problems to fetch
   * @param {number} skip - Number of problems to skip
   * @returns {Promise<Object>} Object with detailed problem information
   */
  async function fetchUserProblemDetails(username, status = 'AC', limit = 100, skip = 0) {
    try {
      const response = await fetch(LEETCODE_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: USER_PROBLEM_DETAILS_QUERY,
          variables: {
            username: username,
            limit: limit,
            skip: skip,
            status: status
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      return data.data.userProfileQuestions;
    } catch (error) {
      console.error(`Error fetching problem details for user ${username}:`, error);
      throw error;
    }
  }

  /**
   * Fetch all solved problems for a user (handles pagination)
   * @param {string} username - The LeetCode username
   * @returns {Promise<Array>} Array of solved problem objects
   */
  async function fetchAllSolvedProblems(username) {
    try {
      // First, get the total number of solved problems
      const initialData = await fetchUserProblemDetails(username, 'AC', 1, 0);
      const totalSolved = initialData.total;
      
      // Then fetch all solved problems in batches
      let allSolvedProblems = [];
      const batchSize = 100;
      const batches = Math.ceil(totalSolved / batchSize);
      
      for (let i = 0; i < batches; i++) {
        const skip = i * batchSize;
        const data = await fetchUserProblemDetails(username, 'AC', batchSize, skip);
        allSolvedProblems = allSolvedProblems.concat(data.questions);
      }
      
      return allSolvedProblems;
    } catch (error) {
      console.error(`Error fetching all solved problems for user ${username}:`, error);
      throw error;
    }
  }

  /**
   * Check if the API calls are accessible from the current page
   * (LeetCode might block API calls from extension contexts)
   * @returns {Promise<boolean>} Whether the API is accessible
   */
  async function isApiAccessible() {
    try {
      // Make a simple query to see if the API is accessible
      const response = await fetch(LEETCODE_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `{ allQuestionsCount { count } }`
        })
      });
      
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json();
      return !!data.data;
    } catch (error) {
      console.error('Error checking API accessibility:', error);
      return false;
    }
  }

  // Return the public API
  return {
    fetchAllProblems,
    fetchUserSolvedProblems,
    fetchUserProblemDetails,
    fetchAllSolvedProblems,
    isApiAccessible
  };
})(); 