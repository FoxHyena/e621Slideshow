import { state } from './state.js';
import Logger from './logger.js';
import { formatDateForE621 } from './time-utils.js';
import { getApiBaseUrl } from './api-client.js';

// Generic tags to exclude from recommendations (too common/uninformative)
const GENERIC_TAG_BLACKLIST = new Set([
    'solo', 'hi_res', 'digital_media_(artwork)', 'absurd_res',
    'simple_background', 'white_background', 'looking_at_viewer',
    'smile', 'open_mouth', 'standing', 'sitting', 'lying',
    'clothed', 'nude', 'mostly_nude', 'topless', 'bottomless',
    'fur', 'hair', 'eyes', 'teeth', 'claws',
    'fingers', 'toes', 'tail', 'ears', 'breasts',
    'detailed_background', 'outside', 'inside', 'day', 'night',
    'text', 'english_text', 'dialogue', 'watermark', 'signature',
    'clothing', 'topwear', 'bottomwear', 'footwear', 'headwear',
    'eyewear', 'jewelry', 'accessory'
]);

// Tag categories that should be given lower weight (less distinctive)
const LOW_PRIORITY_PATTERNS = [
    /_\(disambiguation\)$/,
    /^color_/,
    /^number_/,
    /^\d+_/,
    /_count$/,
    /_only$/
];

// Cache for tag metadata to avoid repeated API calls
const tagMetadataCache = new Map(); // tagName -> { post_count, fetchedAt }
const TAG_METADATA_CACHE_DURATION = 72 * 60 * 60 * 1000; // 72 hours
const TAG_METADATA_CACHE_KEY = 'tagMetadataCache';

// Load tag metadata cache from localStorage
function loadTagMetadataCache() {
    try {
        const cacheData = localStorage.getItem(TAG_METADATA_CACHE_KEY);
        if (!cacheData) {
            Logger.log('[loadTagMetadataCache] No cache found in localStorage');
            return;
        }
        
        const cache = JSON.parse(cacheData);
        
        // Validate cache structure
        if (!cache.tagMetadata || !Array.isArray(cache.tagMetadata)) {
            Logger.log('[loadTagMetadataCache] Invalid cache structure, clearing');
            localStorage.removeItem(TAG_METADATA_CACHE_KEY);
            return;
        }
        
        // Check if cache is expired
        const now = Date.now();
        if (cache.lastFetched && (now - cache.lastFetched) > TAG_METADATA_CACHE_DURATION) {
            const ageMinutes = Math.round((now - cache.lastFetched) / 1000 / 60);
            Logger.log(`[loadTagMetadataCache] Cache expired (age: ${ageMinutes} minutes), clearing`);
            localStorage.removeItem(TAG_METADATA_CACHE_KEY);
            return;
        }
        
        // Restore cache entries
        for (const entry of cache.tagMetadata) {
            if (entry.tagName && entry.post_count !== undefined && entry.fetchedAt) {
                tagMetadataCache.set(entry.tagName, {
                    post_count: entry.post_count,
                    fetchedAt: entry.fetchedAt
                });
            }
        }
        
        const ageMinutes = cache.lastFetched ? Math.round((now - cache.lastFetched) / 1000 / 60) : 'unknown';
        Logger.log(`[loadTagMetadataCache] Loaded ${tagMetadataCache.size} tag metadata entries from cache (age: ${ageMinutes} minutes)`);
    } catch (error) {
        Logger.error('[loadTagMetadataCache] Error loading cache:', error);
        // Clear corrupted cache
        try {
            localStorage.removeItem(TAG_METADATA_CACHE_KEY);
        } catch (e) {
            // Ignore errors when clearing
        }
    }
}

// Save tag metadata cache to localStorage
function saveTagMetadataCache() {
    try {
        // Convert Map to array for JSON serialization
        const cacheArray = Array.from(tagMetadataCache.entries()).map(([tagName, data]) => ({
            tagName,
            post_count: data.post_count,
            fetchedAt: data.fetchedAt
        }));
        
        const cacheData = {
            tagMetadata: cacheArray,
            lastFetched: Date.now()
        };
        
        localStorage.setItem(TAG_METADATA_CACHE_KEY, JSON.stringify(cacheData));
        Logger.log(`[saveTagMetadataCache] Saved ${tagMetadataCache.size} tag metadata entries to localStorage`);
    } catch (error) {
        Logger.error('[saveTagMetadataCache] Error saving cache:', error);
        // Continue anyway - cache is still in memory
    }
}

// Clear tag metadata cache
export function clearTagMetadataCache() {
    try {
        tagMetadataCache.clear();
        localStorage.removeItem(TAG_METADATA_CACHE_KEY);
        Logger.log('[clearTagMetadataCache] Cache cleared');
    } catch (error) {
        Logger.error('[clearTagMetadataCache] Error clearing cache:', error);
    }
}

// Initialize: load cache from localStorage on module load
loadTagMetadataCache();

// Rate limiting for tag metadata requests
// e621 API rate limit: max 2 requests per second (hard limit)
// We'll use 1 request per second to be safe
const TAG_METADATA_RATE_LIMIT_DELAY = 1000; // 1 second between requests (e621 rate limit: 2/sec)
const TAG_METADATA_FETCH_TIMEOUT = 30000; // 30 second timeout per request
const TAG_METADATA_BULK_BATCH_SIZE = 200; // Tags per bulk request (using search[name] with comma-separated values)
const TAG_METADATA_LIMIT = 320; // Max limit per request (API max is 320)

// Sleep utility for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw error;
    }
}

// Format large numbers for display (e.g., 367900 -> "367.9k")
function formatPostCount(count) {
    if (count === null || count === undefined) return 'N/A';
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'm';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
    return count.toString();
}

// Helper function to fetch tags individually as fallback when bulk fetch fails
async function fetchBatchIndividually(batch, batchNumber, tagMetadata, now, baseUrl, headers) {
    for (const tagName of batch) {
        // Skip if already fetched
        if (tagMetadata.has(tagName)) {
            continue;
        }
        
        try {
            const url = `${baseUrl}/tags.json?search[name_matches]=${encodeURIComponent(tagName)}&limit=${TAG_METADATA_LIMIT}`;
            const response = await fetchWithTimeout(url, { headers }, TAG_METADATA_FETCH_TIMEOUT);
            
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    const tagData = data.find(t => t.name === tagName) || data[0];
                    if (tagData.name && tagData.post_count !== undefined) {
                        tagMetadata.set(tagData.name, tagData.post_count);
                        tagMetadataCache.set(tagData.name, {
                            post_count: tagData.post_count,
                            fetchedAt: now
                        });
                    }
                }
            }
            // Small delay between individual requests
            await sleep(500);
        } catch (e) {
            Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: Individual fetch failed for "${tagName}": ${e.message}`);
        }
    }
}

// Fetch tag metadata (post_count) from e621 API
// Returns a Map of tagName -> post_count
async function fetchTagMetadata(tagNames) {
    Logger.log(`[fetchTagMetadata] Starting - ${tagNames ? tagNames.length : 0} tags requested`);
    
    if (!tagNames || tagNames.length === 0) {
        Logger.log(`[fetchTagMetadata] No tags provided, returning empty map`);
        return new Map();
    }

    const baseUrl = getApiBaseUrl();
    Logger.log(`[fetchTagMetadata] Using API base URL: ${baseUrl}`);
    
    const tagMetadata = new Map();
    const tagsToFetch = [];

    // Check cache first
    const now = Date.now();
    let cacheHits = 0;
    let cacheMisses = 0;
    
    Logger.log(`[fetchTagMetadata] Checking cache for ${tagNames.length} tags...`);
    for (const tagName of tagNames) {
        const cached = tagMetadataCache.get(tagName);
        if (cached && (now - cached.fetchedAt) < TAG_METADATA_CACHE_DURATION) {
            tagMetadata.set(tagName, cached.post_count);
            cacheHits++;
        } else {
            tagsToFetch.push(tagName);
            cacheMisses++;
        }
    }

    Logger.log(`[fetchTagMetadata] Cache check complete: ${cacheHits} hits, ${cacheMisses} misses`);

    if (tagsToFetch.length === 0) {
        Logger.log(`[fetchTagMetadata] All ${tagNames.length} tags found in cache, returning immediately`);
        return tagMetadata;
    }

    // Fetch all tags - bulk fetching makes this practical even for thousands of tags
    const tagsToFetchLimited = tagsToFetch;
    
    // Calculate batches for bulk fetching
    const totalBatches = Math.ceil(tagsToFetchLimited.length / TAG_METADATA_BULK_BATCH_SIZE);
    const estimatedTimeSeconds = Math.ceil((totalBatches * TAG_METADATA_RATE_LIMIT_DELAY) / 1000);
    Logger.log(`[fetchTagMetadata] Fetching metadata for ${tagsToFetchLimited.length} tags in ${totalBatches} bulk batch(es) (${TAG_METADATA_BULK_BATCH_SIZE} tags per batch)`);
    Logger.log(`[fetchTagMetadata] Estimated time: ~${Math.floor(estimatedTimeSeconds / 60)}m ${estimatedTimeSeconds % 60}s (at ${TAG_METADATA_RATE_LIMIT_DELAY}ms delay between batches)`);

    // Fetch tags in bulk batches using search[name] with comma-separated tag names
    // API format: /tags.json?search[name]=tag1,tag2,tag3&limit=320
    for (let i = 0; i < tagsToFetchLimited.length; i += TAG_METADATA_BULK_BATCH_SIZE) {
        const batchNumber = Math.floor(i / TAG_METADATA_BULK_BATCH_SIZE) + 1;
        const batch = tagsToFetchLimited.slice(i, i + TAG_METADATA_BULK_BATCH_SIZE);
        
        Logger.log(`[fetchTagMetadata] Batch ${batchNumber}/${totalBatches}: Fetching ${batch.length} tags`);
        Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Sample tags: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? '...' : ''}`);
        
        try {
            // Build URL with comma-separated tag names using search[name] parameter
            const tagNamesCommaSeparated = batch.map(tag => encodeURIComponent(tag)).join(',');
            const url = `${baseUrl}/tags.json?search[name]=${tagNamesCommaSeparated}&limit=${TAG_METADATA_LIMIT}`;
            
            const headers = {
                'User-Agent': 'e621AutoViewer (by Leithey)'
            };

            const fetchStartTime = Date.now();
            Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Starting bulk fetch request`);
            
            let response;
            try {
                response = await fetchWithTimeout(url, { headers }, TAG_METADATA_FETCH_TIMEOUT);
            } catch (fetchError) {
                const fetchDuration = Date.now() - fetchStartTime;
                Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: Fetch failed after ${fetchDuration}ms: ${fetchError.message}`);
            // Fall back to individual requests for this batch
            Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Falling back to individual tag fetches...`);
            await fetchBatchIndividually(batch, batchNumber, tagMetadata, now, baseUrl, headers);
            // Save cache after fallback completes
            saveTagMetadataCache();
            await sleep(TAG_METADATA_RATE_LIMIT_DELAY);
            continue;
            }
            
            const fetchDuration = Date.now() - fetchStartTime;
            Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Fetch completed in ${fetchDuration}ms, status: ${response.status}`);
            
            if (!response.ok) {
                Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: HTTP error ${response.status} ${response.statusText}`);
                // Try to get error details
                try {
                    const errorText = await response.text();
                    Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: Error response body: ${errorText.substring(0, 200)}`);
                } catch (e) {
                    Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: Could not read error response: ${e.message}`);
                }
            // Fall back to individual requests for this batch
            Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Falling back to individual tag fetches...`);
            await fetchBatchIndividually(batch, batchNumber, tagMetadata, now, baseUrl, headers);
            // Save cache after fallback completes
            saveTagMetadataCache();
            await sleep(TAG_METADATA_RATE_LIMIT_DELAY);
            continue;
            }

            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: JSON parse failed: ${parseError.message}`);
            // Fall back to individual requests for this batch
            Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Falling back to individual tag fetches...`);
            await fetchBatchIndividually(batch, batchNumber, tagMetadata, now, baseUrl, headers);
            // Save cache after fallback completes
            saveTagMetadataCache();
            await sleep(TAG_METADATA_RATE_LIMIT_DELAY);
            continue;
            }
            
            // Process response - e621 returns array of tag objects
            if (Array.isArray(data)) {
                Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Received ${data.length} tag objects`);
                
                // Create a map of returned tags for quick lookup
                const returnedTagsMap = new Map();
                for (const tagData of data) {
                    if (tagData.name && tagData.post_count !== undefined) {
                        returnedTagsMap.set(tagData.name, tagData.post_count);
                    }
                }
                
                // Process each tag in the batch
                let processedCount = 0;
                let missingCount = 0;
                for (const requestedTag of batch) {
                    const postCount = returnedTagsMap.get(requestedTag);
                    if (postCount !== undefined) {
                        tagMetadata.set(requestedTag, postCount);
                        tagMetadataCache.set(requestedTag, {
                            post_count: postCount,
                            fetchedAt: now
                        });
                        processedCount++;
                    } else {
                        missingCount++;
                        Logger.warn(`[fetchTagMetadata] Batch ${batchNumber}: Tag "${requestedTag}" not found in response`);
                    }
                }
                
                Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Processed ${processedCount} tags, ${missingCount} missing`);
                
                // If many tags are missing, try individual fetches for the missing ones
                if (missingCount > 0 && missingCount <= batch.length / 2) {
                    Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Fetching ${missingCount} missing tags individually...`);
                    const missingTags = batch.filter(tag => !returnedTagsMap.has(tag));
                    await fetchBatchIndividually(missingTags, batchNumber, tagMetadata, now, baseUrl, headers);
                }
                
                // Save cache after batch completes
                saveTagMetadataCache();
            } else {
                Logger.warn(`[fetchTagMetadata] Batch ${batchNumber}: Response is not an array, type: ${typeof data}`);
                // Fall back to individual requests for this batch
                Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Falling back to individual tag fetches...`);
                await fetchBatchIndividually(batch, batchNumber, tagMetadata, now, baseUrl, headers);
                // Save cache after fallback completes
                saveTagMetadataCache();
            }

            // Rate limiting: wait between batches
            if (i + TAG_METADATA_BULK_BATCH_SIZE < tagsToFetchLimited.length) {
                await sleep(TAG_METADATA_RATE_LIMIT_DELAY);
            }
        } catch (error) {
            Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: Error fetching batch:`, error);
            Logger.error(`[fetchTagMetadata] Batch ${batchNumber}: Error name: ${error.name}, message: ${error.message}`);
            // Fall back to individual requests for this batch
            Logger.log(`[fetchTagMetadata] Batch ${batchNumber}: Falling back to individual tag fetches...`);
            await fetchBatchIndividually(batch, batchNumber, tagMetadata, now, baseUrl, headers);
            // Save cache after fallback completes
            saveTagMetadataCache();
            await sleep(TAG_METADATA_RATE_LIMIT_DELAY);
        }
        
        // Progress update every batch or every 5 batches
        if (batchNumber % 5 === 0 || batchNumber === totalBatches) {
            const progressPercent = Math.round((batchNumber / totalBatches) * 100);
            const elapsedTime = Date.now() - now;
            const avgTimePerBatch = elapsedTime / batchNumber;
            const remainingBatches = totalBatches - batchNumber;
            const estimatedRemainingMs = remainingBatches * avgTimePerBatch;
            Logger.log(`[fetchTagMetadata] Progress: ${batchNumber}/${totalBatches} batches (${progressPercent}%) | Tags fetched: ${tagMetadata.size} | Estimated remaining: ~${Math.floor(estimatedRemainingMs / 1000)}s`);
        }
    }

    Logger.log(`[fetchTagMetadata] All batches complete. Fetched metadata for ${tagMetadata.size} tags out of ${tagNames.length} requested`);
    Logger.log(`[fetchTagMetadata] Cache now contains ${tagMetadataCache.size} entries`);
    
    // Final save to ensure all cache entries are persisted
    saveTagMetadataCache();
    
    return tagMetadata;
}

// Calculate global popularity penalty multiplier based on post_count
function getGlobalPopularityMultiplier(postCount) {
    if (postCount === null || postCount === undefined) {
        // If we don't have global data, don't penalize
        return 1.0;
    }

    if (postCount > 1000000) {
        // Very common tags (>1M posts): 0.5x multiplier
        return 0.5;
    } else if (postCount > 500000) {
        // Common tags (500k-1M): 0.7x multiplier
        return 0.7;
    } else if (postCount > 100000) {
        // Moderately common (100k-500k): 0.85x multiplier
        return 0.8;
    } else if (postCount > 50000) {
        // Moderately common (50k-100k): 0.9x multiplier
        return 0.9;
    } else {
        // Less common (<100k): 1.0x (no penalty)
        return 1.0;
    }
}

// Analyze tags from favorites and return weighted tag list
export async function analyzeTagsFromFavorites(favoritesPosts) {
    if (!favoritesPosts || favoritesPosts.length === 0) {
        Logger.error('[analyzeTagsFromFavorites] No favorites to analyze');
        return [];
    }
    
    Logger.log(`[analyzeTagsFromFavorites] Analyzing ${favoritesPosts.length} favorites...`);
    
    const totalPosts = favoritesPosts.length;
    const tagFrequency = new Map(); // tag -> count of posts containing it
    
    // Count tag frequencies
    for (const post of favoritesPosts) {
        const uniqueTags = new Set(post.tags); // Use Set to count each tag once per post
        
        for (const tag of uniqueTags) {
            // Skip blacklisted generic tags
            if (GENERIC_TAG_BLACKLIST.has(tag)) {
                continue;
            }
            
            // Skip empty tags
            if (!tag || tag.trim() === '') {
                continue;
            }
            
            tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
        }
    }
    
    Logger.log(`[analyzeTagsFromFavorites] Found ${tagFrequency.size} unique tags`);
    
    // Fetch global tag metadata (post counts from e621)
    const tagNames = Array.from(tagFrequency.keys());
    Logger.log(`[analyzeTagsFromFavorites] About to fetch global metadata for ${tagNames.length} tags...`);
    
    let globalTagMetadata = new Map();
    const metadataFetchStartTime = Date.now();
    try {
        Logger.log(`[analyzeTagsFromFavorites] Calling fetchTagMetadata at ${new Date().toISOString()}`);
        globalTagMetadata = await fetchTagMetadata(tagNames);
        const metadataFetchDuration = Date.now() - metadataFetchStartTime;
        Logger.log(`[analyzeTagsFromFavorites] Metadata fetch completed in ${metadataFetchDuration}ms, got ${globalTagMetadata.size} tag metadata entries`);
    } catch (error) {
        const metadataFetchDuration = Date.now() - metadataFetchStartTime;
        Logger.error(`[analyzeTagsFromFavorites] Error fetching global tag metadata after ${metadataFetchDuration}ms, continuing without global popularity penalty:`, error);
        Logger.error(`[analyzeTagsFromFavorites] Error details - name: ${error.name}, message: ${error.message}`);
        // Continue with analysis even if metadata fetch fails
    }
    
    // Calculate TF-IDF-inspired scores
    const weightedTags = [];
    
    for (const [tag, frequency] of tagFrequency.entries()) {
        // Calculate document frequency (what % of posts contain this tag)
        const documentFrequency = frequency / totalPosts;
        
        // Skip tags that appear in too many posts (>70% = too generic)
        // if (documentFrequency > 0.35) {
        //     Logger.log(`[analyzeTagsFromFavorites] Skipping over-represented tag: ${tag} (${Math.round(documentFrequency * 100)}%)`);
        //     continue;
        // }
        
        // Skip tags that appear in too few posts (<2% unless high total)
        // This helps filter out noise from posts with many unique tags
        const minFrequency = totalPosts > 50 ? 0.02 : 0.01;
        if (documentFrequency < minFrequency) {
            continue;
        }
        
        // Enhanced TF-IDF-inspired score with heavy uniqueness weighting
        // Base score: frequency × (1 - documentFrequency²)
        let score = frequency * (1 - Math.pow(documentFrequency, 2));
        
        // Get global post count for this tag
        const globalPostCount = globalTagMetadata.get(tag) || null;
        
        // Apply global popularity penalty - reduce weight for very common tags
        const globalPopularityMultiplier = getGlobalPopularityMultiplier(globalPostCount);
        score *= globalPopularityMultiplier;
        
        // Apply uniqueness boost - heavily reward distinctive tags
        // Tags appearing in 5-25% of posts are your most distinctive preferences
        let uniquenessMultiplier = 1.0;
        
        if (documentFrequency <= 0.10) {
            // Very rare tags (≤10%) - massive boost
            uniquenessMultiplier = 3.0;
        } else if (documentFrequency <= 0.15) {
            // Rare tags (10-15%) - large boost
            uniquenessMultiplier = 2.5;
        } else if (documentFrequency <= 0.20) {
            // Distinctive tags (15-20%) - good boost
            uniquenessMultiplier = 2.0;
        } else if (documentFrequency <= 0.25) {
            // Somewhat distinctive (20-25%) - moderate boost
            uniquenessMultiplier = 1.5;
        }
        // Tags >25% get no boost (multiplier stays 1.0)
        
        score *= uniquenessMultiplier;
        
        // Apply penalties for low-priority patterns
        for (const pattern of LOW_PRIORITY_PATTERNS) {
            if (pattern.test(tag)) {
                score *= 0.5; // Reduce score by 50%
                break;
            }
        }
        
        weightedTags.push({
            tag: tag,
            frequency: frequency,
            documentFrequency: documentFrequency,
            score: score,
            uniquenessMultiplier: uniquenessMultiplier,
            globalPostCount: globalPostCount,
            globalPopularityMultiplier: globalPopularityMultiplier
        });
    }
    
    // Sort by score (descending)
    weightedTags.sort((a, b) => b.score - a.score);
    
    Logger.log(`[analyzeTagsFromFavorites] Top 25 weighted tags:`);
    for (let i = 0; i < Math.min(25, weightedTags.length); i++) {
        const t = weightedTags[i];
        const boostLabel = t.uniquenessMultiplier > 1.0 ? ` [×${t.uniquenessMultiplier.toFixed(1)} boost]` : '';
        const globalLabel = t.globalPostCount !== null ? ` [global: ${formatPostCount(t.globalPostCount)}]` : ' [global: N/A]';
        const penaltyLabel = t.globalPopularityMultiplier < 1.0 ? ` [×${t.globalPopularityMultiplier.toFixed(2)} global penalty]` : '';
        Logger.log(`  ${i + 1}. ${t.tag} (score: ${t.score.toFixed(2)}, freq: ${t.frequency}, df: ${(t.documentFrequency * 100).toFixed(1)}%)${globalLabel}${boostLabel}${penaltyLabel}`);
    }
    
    // Cache in state
    state.analyzedTags = weightedTags;
    
    return weightedTags;
}

// Build recommendation query from weighted tags
export function buildRecommendationQuery(weightedTags, timeframe, userBlacklist = [], topN = 25) {
    if (!weightedTags || weightedTags.length === 0) {
        Logger.error('[buildRecommendationQuery] No tags to build query from');
        return '';
    }
    
    Logger.log(`[buildRecommendationQuery] Building query with timeframe: ${timeframe}, topN: ${topN}`);
    
    const queryParts = [];
    
    // Add top N weighted tags with OR logic using ~ prefix
    const topTags = weightedTags.slice(0, topN).map(t => t.tag);
    
    // Use ~ (tilde) prefix for OR logic in e621 API
    // This means posts matching ANY of these tags will be returned
    const orTags = topTags.map(tag => `~${tag}`);
    queryParts.push(...orTags);
    
    // Add time range filter
    if (timeframe) {
        const dateFilter = getDateFilterForTimeframe(timeframe);
        if (dateFilter) {
            queryParts.push(dateFilter);
        }
    }
    
    // Add score filter to get quality posts
    queryParts.push('score:>50');
    
    // Add order:score to get highest rated posts
    queryParts.push('order:score');
    
    // Add user blacklist (already prefixed with - in api-client.js)
    // We don't add them here to avoid duplication
    
    const query = queryParts.join(' ');
    
    Logger.log(`[buildRecommendationQuery] Generated query (${queryParts.length} parts)`);
    Logger.log(`[buildRecommendationQuery] Top ${topN} tags (OR'd): ${topTags.slice(0, topN).join(', ')}`);
    
    return query;
}

// Get date filter string for e621 API based on timeframe
function getDateFilterForTimeframe(timeframe) {
    const now = new Date();
    let startDate;
    
    switch (timeframe) {
        case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case '6months':
            startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
            break;
        case 'year':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
        default:
            Logger.error(`[getDateFilterForTimeframe] Unknown timeframe: ${timeframe}`);
            return null;
    }
    
    const dateStr = formatDateForE621(startDate);
    return `date:>=${dateStr}`;
}

// Get user-friendly label for timeframe
export function getTimeframeLabel(timeframe) {
    const labels = {
        'week': 'Last Week',
        'month': 'Last Month',
        '6months': 'Last 6 Months',
        'year': 'Last Year'
    };
    return labels[timeframe] || timeframe;
}

// Validate that we have enough data to make recommendations
export function canMakeRecommendations(favoritesPosts) {
    if (!favoritesPosts || favoritesPosts.length === 0) {
        return { valid: false, reason: 'No favorites found' };
    }
    
    if (favoritesPosts.length < 5) {
        return { valid: false, reason: 'Need at least 5 favorites to generate recommendations' };
    }
    
    return { valid: true };
}

// Get recommendation statistics for display
export function getRecommendationStats() {
    if (!state.favoritesCachedData || !state.analyzedTags) {
        return null;
    }
    
    return {
        totalFavorites: state.favoritesCachedData.favoritesPosts.length,
        analyzedTags: state.analyzedTags.length,
        topTags: state.analyzedTags.slice(0, 10).map(t => ({
            tag: t.tag,
            frequency: t.frequency,
            score: Math.round(t.score * 100) / 100
        })),
        lastUpdated: state.favoritesCachedData.favoritesLastFetched
    };
}
