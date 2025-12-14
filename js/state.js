// Global application state
export const state = {
    adultMode: false,
    config: null,
    timeoutId: null,
    paused: false,
    urlHistory: [], // Array in Array. Element 0 is the direct fileName, Element 1 is the fileId
    urlHistorySet: new Set(), // Set for O(1) history lookups by fileId
    currentHistoryPos: 0,
    pageIsHidden: false,
    hideTimeout: null,
    cursorHidden: false,
    mouseMoveTimeout: null,
    isSearchingForNewImage: false,
    firstImageLoaded: false,
    settingsPanelOpen: false,
    presetsData: [],
    globalSettings: null,
    selectedPreset: 0,
    presetSettings: null,
    temporarySearchActive: false,
    savedPresetSettings: null,
    // Batch caching for efficient API usage
    currentPostBatch: [],
    currentBatchIndex: 0,
    currentBatchPage: 1,
    currentBatchQuery: "", // Track query to detect when tags change
    // Prefetching state variables
    prefetchPromise: null, // Promise for ongoing prefetch operation
    prefetchedBatch: [], // Array to store prefetched posts
    prefetchedPage: null, // Page number of prefetched batch
    // Query string caching
    cachedQueryString: null, // Cached query string to avoid redundant building
    // Favorites state
    credentialsValid: false, // Whether username/API key are valid
    currentPostId: null, // Current post ID being displayed
    currentPostIsFavorited: false, // Whether current post is favorited
    favoritesCache: new Set(), // Cache of favorited post IDs for quick lookup
    // Recommendation mode state
    favoritesCachedData: null, // Cached favorites data from localStorage
    recommendationMode: false, // Whether recommendation mode is active
    recommendationTimePeriod: 'month', // 'week', 'month', '6months', 'year'
    analyzedTags: null, // Cached tag analysis results
    fetchingFavorites: false, // Whether favorites are currently being fetched
    // Image preloading state
    preloadedImages: [], // Array of preloaded Image objects with metadata {image, url, fileId, post}
    preloadingPromises: [], // Track ongoing preload operations
    maxPreloadCount: 2 // Maximum number of images to preload ahead
};
