/**
 * LeetCode API Interaction Library
 * Handles fetching data from LeetCode's GraphQL API.
 */

// Enable debug mode for development
const DEBUG_API = true; // Use a different flag to avoid conflict with background

// Helper function for debug logging in this module
function logApi(...args) {
  if (DEBUG_API) console.log('[LeetAnki-API]', ...args);
}

// Storage key for sync state (managed by this module)
const SYNC_STATE_KEY = 'submissionSyncState';

// LeetCode GraphQL Endpoint
const GRAPHQL_ENDPOINT = '/graphql';

// --- GraphQL Queries ---

// Query to get user status and basic info
const GET_USER_STATUS_QUERY = `
  query globalData {
    userStatus {
      isSignedIn
      username
      realName
      userSlug
      avatar
      activeSessionId
      isAdmin
      isSuperuser
      isTranslator
      isPremium
      isVerified
      checkedInToday
      notificationStatus {
        lastModified
        numUnread
      }
    }
  }
`;

// Query to get detailed data for a specific question
const GET_QUESTION_DATA_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      # boundTopicId # Often null or not useful
      title
      titleSlug
      # content # Usually too large, avoid unless needed
      # translatedTitle
      # translatedContent
      isPaidOnly
      difficulty
      # likes
      # dislikes
      # isLiked # User specific, might change
      # similarQuestions # Can be large JSON string
      # exampleTestcases
      # contributors
      topicTags {
        name
        slug
        # translatedName
      }
      # companyTagStats # Usually null
      # codeSnippets # Large
      stats # Contains acceptance rate etc. as JSON string
      # hints
      # solution
      status # User's status on this question (AC, Not AC, None)
      # sampleTestCase
      # metaData # Contains info like category slug
      # judgerAvailable
      # judgeType
      # mysqlSchemas
      # enableRunCode
      # enableTestMode
      # enableDebugger
      # envInfo
      # libraryUrl
      # adminUrl
      # challengeQuestion
      # note
    }
  }
`;

// Query to fetch user submissions (paginated)
const GET_SUBMISSIONS_QUERY = `
  query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String) {
    submissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug) {
      lastKey
      hasNext
      submissions {
        # id
        status # Numerical status
        statusDisplay # e.g., "Accepted", "Wrong Answer"
        lang
        runtime
        timestamp # Unix timestamp string
        url
        isPending
        memory
        # submissionComment
        titleSlug # Request titleSlug directly on the submission node
      }
    }
  }
`;

// Query to fetch submission stats (total accepted count)
const GET_SUBMISSION_STATS_QUERY = `
  query userProfileUserQuestionProgressV2($userSlug: String!) {
    userProfileUserQuestionProgressV2(userSlug: $userSlug) {
      numAcceptedQuestions {
        difficulty
        count
      }
      # numFailedQuestions { difficulty count }
      # numUntouchedQuestions { difficulty count }
    }
  }
`;

// --- Helper Functions ---

/**
 * Make a GraphQL request to LeetCode.
 * @param {string} query The GraphQL query string.
 * @param {object} variables The variables for the query.
 * @returns {Promise<object>} The data part of the GraphQL response.
 * @throws {Error} If the request fails or returns errors.
 */
async function makeGraphQLRequest(query, variables = {}) {
  const queryName = query.split(/[{(]/)[1].trim(); // Extract query name for logging
  logApi(`Making GraphQL request: ${queryName}`, variables);

  // Get CSRF token from cookies
  const csrfToken = getCookie('csrftoken');
  if (!csrfToken) {
    throw new Error('CSRF token not found. User might be logged out or cookie is missing.');
  }

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-csrftoken': csrfToken,
        'Referer': window.location.origin + '/', // Often needed for CSRF validation
        // Add other headers if LeetCode requires them (e.g., User-Agent)
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      // Read body for more details if possible, even on error
      let errorBody = '';
      try {
         errorBody = await response.text();
      } catch {}
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}. Body: ${errorBody.substring(0, 100)}`);
    }

    const result = await response.json();

    if (result.errors) {
       const errorMessage = result.errors.map(e => e.message).join(', ');
       logApi(`GraphQL errors for ${queryName}:`, result.errors);
       // Handle specific errors if needed
       if (errorMessage.includes('authenticated') || errorMessage.includes('login')) {
           logApi('Authentication error detected in GraphQL response.');
           // Notify background script about auth change
           chrome.runtime.sendMessage({ action: 'updateAuthStatus', status: false });
           // Throw a specific error type maybe?
           throw new Error('Authentication required'); 
       }
       throw new Error(`GraphQL error: ${errorMessage}`);
    }

    logApi(`GraphQL request ${queryName} successful.`);
    return result.data;
  } catch (error) {
    console.error(`GraphQL request ${queryName} failed:`, error);
    // Add context to the re-thrown error
    error.message = `GraphQL request ${queryName} failed: ${error.message}`;
    throw error; // Re-throw the error to be handled by the caller
    }
  }
  
  /**
 * Get a cookie value by name.
 * @param {string} name The name of the cookie.
 * @returns {string | null} The cookie value or null if not found.
 */
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
     // Decode the cookie value in case it contains special characters
     return decodeURIComponent(parts.pop().split(';').shift());
  }
  return null;
}

// --- Public API Functions ---

/**
 * Fetches the current user's status and basic info.
 * @returns {Promise<object>} User status object (contains isSignedIn, username, userSlug etc.).
 */
async function getUserInfo() {
  logApi('Fetching user info...');
  try {
    const data = await makeGraphQLRequest(GET_USER_STATUS_QUERY);
    if (!data || !data.userStatus) {
        logApi('User status data not found in response.', data);
        return { isSignedIn: false, userSlug: null }; // Add userSlug null
    }
    return data.userStatus;
    } catch (error) {
    console.error('Failed to get user info:', error);
    if (error.message.includes('Authentication required') || error.message.includes('CSRF token')) {
        return { isSignedIn: false, userSlug: null };
    }
    return { isSignedIn: false, userSlug: null }; 
  }
}

/**
 * Fetches submission stats for the current user (e.g., total accepted count).
 * Requires the user's slug.
 * @param {string} userSlug - The user's LeetCode slug.
 * @returns {Promise<number>} The total number of accepted questions, or 0 if error/not found.
 */
async function getUserStats(userSlug) {
  logApi(`Fetching submission stats for user: ${userSlug}`);
  if (!userSlug) {
    logApi('Cannot fetch stats: userSlug is missing.');
    return 0;
  }
  try {
    const data = await makeGraphQLRequest(GET_SUBMISSION_STATS_QUERY, { userSlug });
    const acceptedStats = data?.userProfileUserQuestionProgressV2?.numAcceptedQuestions;
    if (acceptedStats && Array.isArray(acceptedStats)) {
        const totalAccepted = acceptedStats.find(item => item.difficulty === 'All');
        if (totalAccepted && typeof totalAccepted.count === 'number') {
            logApi(`Total accepted problems count: ${totalAccepted.count}`);
            return totalAccepted.count;
        } else {
             logApi('Could not find \'All\' difficulty count in accepted questions stats.', acceptedStats);
        }
    } else {
        logApi('Accepted questions stats not found or invalid format.', data);
    }
    return 0; // Return 0 if data is missing or malformed
  } catch (error) {
    console.error(`Failed to get submission stats for ${userSlug}:`, error);
    return 0; // Return 0 on error
  }
}

/**
 * Fetches detailed data for a specific question by its title slug.
 * @param {string} titleSlug The title slug of the question.
 * @returns {Promise<object | null>} Question data object or null if not found/error.
 */
async function getProblemData(titleSlug) {
  logApi(`Fetching problem data for: ${titleSlug}`);
  try {
    const data = await makeGraphQLRequest(GET_QUESTION_DATA_QUERY, { titleSlug });
    if (!data || !data.question) {
       logApi(`Problem data not found for slug: ${titleSlug}`);
       return null;
    }
    // Add the URL here for convenience
    data.question.url = `https://leetcode.com/problems/${data.question.titleSlug}/`;
    return data.question;
  } catch (error) {
    console.error(`Failed to get problem data for ${titleSlug}:`, error);
    return null; // Return null on error to allow sync to potentially continue
  }
}


/**
 * Fetches all user submissions incrementally.
 * Uses pagination and stores state to resume.
 * Calls progressCallback with batches of processed *accepted* problems.
 *
 * @param {Function} progressCallback - Called with Array<{ problemData: object, acceptedTimestamp: number }>
 * @param {Function} completionCallback - Called when sync finishes successfully.
 * @param {Function} errorCallback - Called on fatal error during sync.
 */
async function syncAllSubmissions(progressCallback, completionCallback, errorCallback) {
  logApi('Starting full submission sync...');
  const BATCH_SIZE = 20; // How many submissions to fetch per request
  const PROBLEM_FETCH_DELAY_MS = 50; // Delay between getProblemData calls
  const PAGE_FETCH_DELAY_MS = 250; // Delay between submission page requests

  let syncState = {
    offset: 0,
    lastKey: null,
    completed: false,
    processedSlugs: {} // Track slugs processed in *this* sync session
  };

  try {
    // Load previous sync state if exists
    const storedStateResult = await chrome.storage.local.get(SYNC_STATE_KEY);
    const storedState = storedStateResult[SYNC_STATE_KEY];
    if (storedState && typeof storedState === 'object' && !storedState.completed) {
      logApi('Resuming previous sync state:', storedState);
      // Only restore offset and lastKey, reset processedSlugs for new session
      syncState.offset = storedState.offset ?? 0;
      syncState.lastKey = storedState.lastKey ?? null;
      syncState.completed = storedState.completed ?? false;
      syncState.processedSlugs = {}; // Reset for this run
    } else {
       logApi('Starting fresh sync or previous was completed.');
       // Clear any potentially invalid old state
       await chrome.storage.local.remove(SYNC_STATE_KEY);
    }

    if (syncState.completed) {
       logApi('Sync already marked as completed.');
       completionCallback();
       return;
    }

    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    // --- Main Sync Loop ---
    while (!syncState.completed) {
      logApi(`Fetching submissions page: offset=${syncState.offset}, lastKey=${syncState.lastKey}`);

      let submissionListData;
      try {
         submissionListData = await makeGraphQLRequest(GET_SUBMISSIONS_QUERY, {
             offset: syncState.offset,
             limit: BATCH_SIZE,
             lastKey: syncState.lastKey,
             questionSlug: "" // Fetch across all questions
         });
         consecutiveErrors = 0; // Reset error count on success
      } catch(fetchError) {
          consecutiveErrors++;
          logApi(`Error fetching submission page (Attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, fetchError);
          
          // Check if it's an auth error - these are fatal for the sync
          if (fetchError.message.includes('Authentication required') || fetchError.message.includes('CSRF token')) {
              logApi('Authentication error during sync. Stopping sync permanently.');
              // Mark as completed to avoid retrying, or create a specific error state?
              syncState.completed = true; // Mark done to stop retrying on auth fail
              await chrome.storage.local.set({ [SYNC_STATE_KEY]: syncState });
              errorCallback('Authentication required');
              return; // Stop the sync process
          }

          // If too many consecutive errors, stop the sync
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              logApi('Reached max consecutive errors fetching submissions. Stopping sync.');
              errorCallback(`Failed to fetch submissions after ${MAX_CONSECUTIVE_ERRORS} attempts: ${fetchError.message}`);
              // Save current state so it *might* resume later if the issue is temporary
              await chrome.storage.local.set({ [SYNC_STATE_KEY]: syncState });
              return;
          }

          // Wait before retrying the same page fetch
          const retryDelay = PAGE_FETCH_DELAY_MS * consecutiveErrors;
          logApi(`Waiting ${retryDelay}ms before retrying submission fetch...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue; // Retry fetching the same page
      }

      // Validate response structure
      if (!submissionListData?.submissionList?.submissions) {
        logApi('Error: Invalid submission list data structure received.', submissionListData);
        consecutiveErrors++; // Count this as an error too
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            logApi('Stopping sync due to invalid submission data structure.');
            errorCallback('Invalid submission list data received from API.');
            await chrome.storage.local.set({ [SYNC_STATE_KEY]: syncState });
            return;
        }
         const retryDelay = PAGE_FETCH_DELAY_MS * consecutiveErrors;
         logApi(`Waiting ${retryDelay}ms before retrying invalid data structure...`);
         await new Promise(resolve => setTimeout(resolve, retryDelay));
         continue; // Retry
      }

      const { submissions, lastKey, hasNext } = submissionListData.submissionList;
      logApi(`Received ${submissions.length} submissions. HasNext: ${hasNext}`);

      if (submissions.length === 0 && !hasNext) {
          logApi('Received 0 submissions and hasNext is false. Assuming end of list.');
          syncState.completed = true;
          // Continue to save state and call completion callback below
      } else {
          // --- Process Accepted Submissions in Batch ---
          const batchProblemDetails = new Map(); // Map<slug, { problemData: object, acceptedTimestamp: number }>
          const acceptedSubmissions = submissions.filter(sub => sub.statusDisplay === 'Accepted');
          logApi(`Found ${acceptedSubmissions.length} accepted submissions in this batch.`);

          for (const sub of acceptedSubmissions) {
            const slug = sub.titleSlug;
            const timestamp = parseInt(sub.timestamp, 10) * 1000; // Convert to milliseconds

            if (!slug || isNaN(timestamp)) {
               logApi('Skipping submission with missing slug or invalid timestamp:', sub);
               continue;
            }

            // If we haven't processed this slug yet OR this submission is earlier than the one we stored
            if (!syncState.processedSlugs[slug] || timestamp < syncState.processedSlugs[slug].acceptedTimestamp) {
                 logApi(`Accepted submission found for slug: ${slug}, timestamp: ${new Date(timestamp).toISOString()}`);
                // Store/update the earliest accepted timestamp found *in this session*
                syncState.processedSlugs[slug] = { acceptedTimestamp: timestamp }; 
                // Mark that we need to fetch details (or update existing details if we already fetched it this session)
                batchProblemDetails.set(slug, { problemData: null, acceptedTimestamp: timestamp });
            } else {
                 logApi(`Slug ${slug} already processed with earlier/same timestamp in this session.`);
            }
          }

          logApi(`Need to fetch/update details for ${batchProblemDetails.size} unique accepted problems from this batch.`);

          // --- Fetch Problem Details for New/Updated Slugs ---
          const finalBatchResults = [];
          for (const [slugToFetch, data] of batchProblemDetails.entries()) {
              try {
                  logApi(`Fetching details for: ${slugToFetch}`);
                  const problemData = await getProblemData(slugToFetch);
                  if (problemData) {
                      // Add the fetched data to the map entry
                      data.problemData = problemData;
                      finalBatchResults.push(data); // Add the complete data to the results array
                  } else {
                      logApi(`Warning: Failed to get problem details for slug: ${slugToFetch}. Skipping this problem.`);
                  }
                  // Small delay between problem detail fetches to be considerate
                  await new Promise(resolve => setTimeout(resolve, PROBLEM_FETCH_DELAY_MS));
              } catch (detailError) {
                  // Log error but continue processing other problems in the batch
                  logApi(`Error fetching details for slug ${slugToFetch}:`, detailError);
                  // Decide whether to retry this specific problem? For now, just skip.
              }
          }

          // --- Send Batch to Background ---
          if (finalBatchResults.length > 0) {
            logApi(`Sending batch of ${finalBatchResults.length} processed problems to background.`);
            // Send asynchronously, don't wait for response here
            chrome.runtime.sendMessage({ action: 'syncProgress', data: finalBatchResults }).catch(err => {
                 logApi('Error sending syncProgress message to background:', err);
            });
          }

          // --- Update State for Next Iteration ---
          syncState.offset += submissions.length; // Always advance offset by the number received
          syncState.lastKey = lastKey;
          syncState.completed = !hasNext;
      } // End of processing batch

      // --- Save State and Delay ---
      logApi('Saving sync state:', { offset: syncState.offset, lastKey: syncState.lastKey, completed: syncState.completed });
      // Persist only the necessary state parts
      await chrome.storage.local.set({ 
          [SYNC_STATE_KEY]: { 
              offset: syncState.offset,
              lastKey: syncState.lastKey,
              completed: syncState.completed
          }
      });

      // If not completed, wait before fetching the next page
      if (!syncState.completed && submissions.length > 0) { // Add submissions.length check to prevent delay if last page was empty
        logApi(`Waiting ${PAGE_FETCH_DELAY_MS}ms before fetching next page...`);
        await new Promise(resolve => setTimeout(resolve, PAGE_FETCH_DELAY_MS));
      }
    } // --- End of Main Sync Loop ---

    // Sync finished successfully
    logApi('Submission sync process completed successfully.');
    completionCallback();

    } catch (error) {
    // Catch unexpected errors in the main try block
    console.error('Fatal error during submission sync process:', error);
    errorCallback(`Fatal sync error: ${error.message}`);
    // Attempt to save state even on fatal error?
     try {
         // Save last known state (offset, lastKey, completed might be inaccurate)
         const stateToSave = { offset: syncState.offset, lastKey: syncState.lastKey, completed: false }; // Mark as not completed on error
         await chrome.storage.local.set({ [SYNC_STATE_KEY]: stateToSave }); 
         logApi('Saved partial state on fatal error.', stateToSave);
     } catch (saveError) {
         console.error('Failed to save sync state during error handling:', saveError);
     }
  }
}


// Expose public functions under a namespace
window.leetcodeApi = {
  getUserInfo,
  getUserStats,
  getProblemData,
  syncAllSubmissions,
};

logApi('LeetCode API module loaded and initialized.');