import { state } from './state.js';
import Logger from './logger.js';
import { formatDateForE621 } from './time-utils.js';

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

// Analyze tags from favorites and return weighted tag list
export function analyzeTagsFromFavorites(favoritesPosts) {
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
    
    // Calculate TF-IDF-inspired scores
    const weightedTags = [];
    
    for (const [tag, frequency] of tagFrequency.entries()) {
        // Calculate document frequency (what % of posts contain this tag)
        const documentFrequency = frequency / totalPosts;
        
        // Skip tags that appear in too many posts (>70% = too generic)
        if (documentFrequency > 0.3) {
            Logger.log(`[analyzeTagsFromFavorites] Skipping over-represented tag: ${tag} (${Math.round(documentFrequency * 100)}%)`);
            continue;
        }
        
        // Skip tags that appear in too few posts (<2% unless high total)
        // This helps filter out noise from posts with many unique tags
        const minFrequency = totalPosts > 50 ? 0.02 : 0.01;
        if (documentFrequency < minFrequency) {
            continue;
        }
        
        // Enhanced TF-IDF-inspired score with heavy uniqueness weighting
        // Base score: frequency × (1 - documentFrequency²)
        let score = frequency * (1 - Math.pow(documentFrequency, 2));
        
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
            uniquenessMultiplier: uniquenessMultiplier
        });
    }
    
    // Sort by score (descending)
    weightedTags.sort((a, b) => b.score - a.score);
    
    Logger.log(`[analyzeTagsFromFavorites] Top 10 weighted tags:`);
    for (let i = 0; i < Math.min(10, weightedTags.length); i++) {
        const t = weightedTags[i];
        const boostLabel = t.uniquenessMultiplier > 1.0 ? ` [×${t.uniquenessMultiplier.toFixed(1)} boost]` : '';
        Logger.log(`  ${i + 1}. ${t.tag} (score: ${t.score.toFixed(2)}, freq: ${t.frequency}, df: ${(t.documentFrequency * 100).toFixed(1)}%)${boostLabel}`);
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
    Logger.log(`[buildRecommendationQuery] Top 5 tags (OR'd): ${topTags.slice(0, 5).join(', ')}`);
    
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
