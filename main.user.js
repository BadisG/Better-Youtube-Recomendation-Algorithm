// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @author       BadisG
// @version      8.3
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails.
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // ===== CONFIGURATION SECTION =====
    // All selectors and settings in one place for easy updates
    const CONFIG = {
        
        // ===== USER CONFIG =====
        DEBUG: false,
        THRESHOLD: 10,
        MINIMUM_VIEWS: 0, // Add a minimum views threshold here

        // Date filtering (optional: leave empty/null to disable)
        BEFORE_DATE: null, // exemple: "2024-04-16"
        AFTER_DATE: null, // exemple: "2006-05-20"

        // Filter terms
        FILTERED_TITLE_TERMS: ['aaaa', 'bbbb'],
        FILTERED_CHANNEL_TERMS: ['cccc', 'dddd'],
        // ===== USER CONFIG (END) =====

        // Main container selectors
        VIDEO_CONTAINER_SELECTORS: 'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-compact-playlist-renderer, ytd-item-section-renderer, yt-lockup-view-model',

        // Video information selectors
        SELECTORS: {
            // Video title
            VIDEO_TITLE: 'h3.yt-lockup-metadata-view-model__heading-reset span.yt-core-attributed-string',
            VIDEO_TITLE_FALLBACK: 'h3 a span.yt-core-attributed-string',

            // Video link for ID extraction
            VIDEO_LINK: 'a[href*="/watch?v="]',

            // Metadata rows containing channel, views, date
            METADATA_ROWS: '.yt-content-metadata-view-model__metadata-row',
            METADATA_SPANS: 'span.yt-core-attributed-string',

            // Channel name selectors (multiple fallbacks)
            CHANNEL_NAME_PRIMARY: 'ytd-channel-name yt-formatted-string#text',
            CHANNEL_NAME_METADATA: '.yt-content-metadata-view-model-wiz__metadata-row span.yt-core-attributed-string',
            CHANNEL_NAME_LINK: 'a[href^="/@"]',

            // Subscription page selectors
            SUBSCRIPTION_GRID: 'ytd-expanded-shelf-contents-renderer #contents',
            SUBSCRIPTION_LIST: 'ytd-section-list-renderer #items',
            SUBSCRIPTION_CHANNELS: 'ytd-channel-renderer',
            SUBSCRIPTION_NAMES: 'ytd-channel-name yt-formatted-string#text',

            // Video type detection
            PLAYLIST_INDICATORS: 'ytd-compact-playlist-renderer, ytd-item-section-renderer',
            LIVE_BADGES: '[aria-label="LIVE"], .badge-style-type-live-now-alternate, badge-shape.badge-shape-wiz--live, .yt-badge-shape-wiz__text[aria-label="LIVE"]',
            PROGRESS_BARS: '#progress, [class*="progress" i]',

            // Watch page specific
            WATCH_CONTAINER: 'ytd-watch-flexy',
            SIDEBAR_RECOMMENDATIONS: 'ytd-compact-video-renderer',

            // New layout elements
            YT_LOCKUP_CONTENT_TYPE: '[ytb-content-type]',
        }
    };

    // ===== SCRIPT VARIABLES =====
    const DEBUG = CONFIG.DEBUG;
    let Threshold = CONFIG.THRESHOLD;
    const MINIMUM_VIEWS = CONFIG.MINIMUM_VIEWS;
    let subscribedChannels = new Set();
    let currentObserver = null;
    const FILTERED_TITLE_TERMS = CONFIG.FILTERED_TITLE_TERMS;
    const FILTERED_CHANNEL_TERMS = CONFIG.FILTERED_CHANNEL_TERMS;
    const VIDEO_CONTAINER_SELECTORS = CONFIG.VIDEO_CONTAINER_SELECTORS;

    // ===== UTILITY FUNCTIONS =====
    function debugLog(...args) {
        if (DEBUG) {
            console.log(...args);
        }
    }

    function logHiding(reason, title) {
        debugLog(`%c❌ HIDING - ${reason}: "${title}"`, 'color: #C03030; font-weight: bold;');
    }

    function logShowing(reason, title) {
        debugLog(`%c✅ SHOWING - ${reason}: "${title}"`, 'color: #30C030; font-weight: bold;');
    }

    // ===== MAIN FUNCTIONS =====

    function shouldRunOnCurrentPage() {
        const pathname = window.location.pathname;
        return pathname === '/' ||
            pathname === '/watch' ||
            pathname === '/feed/channels';
    }

    function fetchSubscribedChannels() {
        function updateSubscribedChannels() {
            debugLog('Starting to fetch subscribed channels by scrolling...');
            let lastHeight = 0;
            let newSubscribedNames = new Set();
            let consecutiveStops = 0;
            let scrollCount = 0;
            const maxStops = 5;
            const maxScrolls = 50;

            const scrollInterval = setInterval(() => {
                scrollCount++;
                window.scrollTo(0, document.documentElement.scrollHeight);
                const currentHeight = document.documentElement.scrollHeight;

                // Use CONFIG selector
                const channelNameElements = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_NAMES);
                debugLog(`Scroll ${scrollCount}: Found ${channelNameElements.length} channel names, height: ${currentHeight}`);

                channelNameElements.forEach(nameElement => {
                    const channelName = nameElement.textContent.trim();
                    if (channelName && channelName.length > 0) {
                        const normalizedName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (!newSubscribedNames.has(normalizedName)) {
                            newSubscribedNames.add(normalizedName);
                            debugLog(`Added channel name: ${channelName} (normalized: ${normalizedName})`);
                        }
                    }
                });

                if (currentHeight === lastHeight) {
                    consecutiveStops++;
                    if (consecutiveStops >= maxStops || scrollCount >= maxScrolls) {
                        clearInterval(scrollInterval);
                        debugLog('Finished scrolling. Final collection...');

                        setTimeout(() => {
                            const finalChannelNameElements = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_NAMES);
                            finalChannelNameElements.forEach(nameElement => {
                                const channelName = nameElement.textContent.trim();
                                if (channelName && channelName.length > 0) {
                                    const normalizedName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                    newSubscribedNames.add(normalizedName);
                                }
                            });

                            if (newSubscribedNames.size > 0) {
                                GM_setValue('subscribedChannelNames', JSON.stringify(Array.from(newSubscribedNames)));
                                subscribedChannels = newSubscribedNames;
                                debugLog('Successfully saved subscribed channel names:', Array.from(newSubscribedNames));
                                debugLog('Total subscribed channel names found:', subscribedChannels.size);

                                GM_setValue('subscribedChannelHandles', JSON.stringify([]));
                                GM_setValue('subscribedChannels', JSON.stringify([]));
                            } else {
                                debugLog('Could not find any channel names after scrolling.');
                            }
                        }, 1000);
                    }
                } else {
                    lastHeight = currentHeight;
                    consecutiveStops = 0;
                }

                if (scrollCount >= maxScrolls) {
                    clearInterval(scrollInterval);
                    debugLog('Reached maximum scroll limit');
                }
            }, 2000);
        }

        const observer = new MutationObserver((mutations, obs) => {
            const gridContainer = document.querySelector(CONFIG.SELECTORS.SUBSCRIPTION_GRID);
            const listContainer = document.querySelector(CONFIG.SELECTORS.SUBSCRIPTION_LIST);
            const channelRenderers = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_CHANNELS);

            if ((gridContainer || listContainer) && channelRenderers.length > 0) {
                debugLog('Subscription page content detected with channels. Starting fetch...');
                obs.disconnect();
                setTimeout(updateSubscribedChannels, 2000);
            } else if (channelRenderers.length > 5) {
                debugLog('Multiple channel renderers detected. Starting fetch...');
                obs.disconnect();
                setTimeout(updateSubscribedChannels, 1000);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            const channelRenderers = document.querySelectorAll(CONFIG.SELECTORS.SUBSCRIPTION_CHANNELS);
            if (channelRenderers.length > 0) {
                debugLog('Timeout reached, but found channels. Starting fetch anyway...');
                updateSubscribedChannels();
            } else {
                debugLog('Timeout reached and no channels found. Make sure you are on the subscriptions page.');
            }
        }, 10000);
    }

    function getChannelName(thumbnailElement) {
        // Try multiple selectors in order of preference
        const selectors = [
            CONFIG.SELECTORS.CHANNEL_NAME_PRIMARY,
            CONFIG.SELECTORS.CHANNEL_NAME_METADATA,
            CONFIG.SELECTORS.CHANNEL_NAME_LINK
        ];

        for (const selector of selectors) {
            const element = thumbnailElement.querySelector(selector);
            if (element && element.textContent && element.textContent.trim().length > 0) {
                return element.textContent.trim();
            }
        }
        return null;
    }

    function isNormalVideo(element) {
        // Check for new layout element
        if (element.tagName.toUpperCase() === 'YT-LOCKUP-VIEW-MODEL') {
            const contentType = element.getAttribute('ytb-content-type');
            if (contentType === 'playlist' || contentType === 'channel') {
                return { isNormal: false, reason: `yt-lockup-view-model is a ${contentType}` };
            }
        }

        // Check for playlist indicators
        if (element.matches(CONFIG.SELECTORS.PLAYLIST_INDICATORS)) {
            return { isNormal: false, reason: 'Playlist element detected' };
        }

        // Check for live streams
        const hasLiveBadge = element.querySelector(CONFIG.SELECTORS.LIVE_BADGES);
        if (hasLiveBadge) {
            return { isNormal: false, reason: 'Live stream detected' };
        }

        // Check for watched videos
        const hasProgressBar = element.querySelector(CONFIG.SELECTORS.PROGRESS_BARS);
        if (hasProgressBar) {
            return { isNormal: false, reason: 'Already watched' };
        }

        return { isNormal: true, reason: 'Normal video' };
    }

    function hideElement(element, reason) {
        if (element) {
            element.setAttribute('data-hide-reason', reason);
            element.setAttribute('data-processed', 'hide');
            element.style.display = 'none !important';
        }
    }

    function showElement(element) {
        if (element) {
            // Remove the hide attribute and mark as processed/shown
            element.removeAttribute('data-hide-reason');
            element.setAttribute('data-processed', 'show');
            element.style.display = '';
        }
    }

    function shouldProcessElement(element) {
        const isHomePage = window.location.pathname === '/';
        const isWatchPage = window.location.pathname === '/watch';

        if (isHomePage) {
            // On homepage, process rich items, compact videos, and the new yt-lockup-view-model
            return element.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                element.tagName === 'YTD-COMPACT-VIDEO-RENDERER' ||
                element.tagName === 'YT-LOCKUP-VIEW-MODEL';
        } else if (isWatchPage) {
            // On watch pages, only process compact video renderers (sidebar recommendations)
            const tagName = element.tagName.toUpperCase(); // Normalize to uppercase
            return tagName === 'YTD-COMPACT-VIDEO-RENDERER' || // Sidebar videos
                tagName === 'YT-LOCKUP-VIEW-MODEL';
        }

        return false;
    }

    function getVideoId(element) {
        if (!element) return null;

        const link = element.querySelector(CONFIG.SELECTORS.VIDEO_LINK);
        if (link && link.href) {
            try {
                const url = new URL(link.href);
                return url.searchParams.get('v');
            } catch (e) {
                const match = link.href.match(/[?&]v=([^&]+)/);
                if (match && match[1]) {
                    return match[1];
                }
            }
        }
        return null;
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    function processThumbnail(thumbnailElement) {
        if (!shouldRunOnCurrentPage() || !shouldProcessElement(thumbnailElement)) {
            return;
        }

        let parentElement = thumbnailElement.matches(VIDEO_CONTAINER_SELECTORS) ?
            thumbnailElement :
            thumbnailElement.closest(VIDEO_CONTAINER_SELECTORS);

        if (!parentElement) return;

        if (parentElement.hasAttribute('data-hide-reason')) {
            return;
        }

        const videoId = getVideoId(parentElement);

        // Try primary selector first, then fallback
        let videoTitleElement = parentElement.querySelector(CONFIG.SELECTORS.VIDEO_TITLE);
        if (!videoTitleElement) {
            videoTitleElement = parentElement.querySelector(CONFIG.SELECTORS.VIDEO_TITLE_FALLBACK);
        }

        const videoTitle = videoTitleElement ? videoTitleElement.textContent.trim() : 'Unknown Title';

        if (videoTitle === 'Unknown Title') {
            hideElement(parentElement, 'Is an Ad or placeholder element');
            return;
        }

        debugLog(`%cProcessing: "${videoTitle}"`, 'font-weight: bold');

        const normalVideoCheck = isNormalVideo(parentElement);
        if (!normalVideoCheck.isNormal) {
            logHiding(normalVideoCheck.reason, videoTitle);
            hideElement(parentElement, `Not a normal video: ${normalVideoCheck.reason}`);
            return;
        }

        // Check filtered terms
        for (const term of FILTERED_TITLE_TERMS) {
            const escapedTerm = escapeRegExp(term);
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedTerm}(?![\\p{L}\\p{N}_])`, 'iu');

            if (regex.test(videoTitle)) {
                logHiding(`Found "${term}" in title`, videoTitle);
                hideElement(parentElement, `Filtered title term: ${term}`);
                return;
            }
        }

        // Get channel name using updated selectors
        let channelName = null;
        const metadataRows = parentElement.querySelectorAll(CONFIG.SELECTORS.METADATA_ROWS);

        for (const row of metadataRows) {
            const channelSpan = row.querySelector(CONFIG.SELECTORS.METADATA_SPANS);
            if (channelSpan) {
                const text = channelSpan.textContent.trim();
                if (!text.includes('view') && !text.includes('ago') && !text.includes('•') && text.length > 0) {
                    channelName = text;
                    break;
                }
            }
        }

        if (!channelName) {
            channelName = getChannelName(parentElement);
        }

        if (!videoId || !channelName) {
            logHiding('Missing video ID or channel name', videoTitle);
            hideElement(parentElement, 'Missing video ID or channel name');
            return;
        }

        debugLog(`   Found - Channel: "${channelName}", Video ID: "${videoId}"`);

        // Check filtered channel terms
        for (const term of FILTERED_CHANNEL_TERMS) {
            const escapedTerm = escapeRegExp(term);
            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedTerm}(?![\\p{L}\\p{N}_])`, 'iu');
            if (regex.test(channelName)) {
                logHiding(`Found "${term}" in channel name: "${channelName}"`, videoTitle);
                hideElement(parentElement, `Filtered channel term: ${term}`);
                return;
            }
        }

        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isSubscribed = subscribedChannels.has(normalizedChannelName);

        if (isSubscribed) {
            logHiding(`Subscribed channel: "${channelName}"`, videoTitle);
            hideElement(parentElement, `Subscribed channel: ${channelName}`);
            return;
        }

        let viewCountText = null;
        let metadataDate = null;

        for (const row of metadataRows) {
            const spans = row.querySelectorAll(CONFIG.SELECTORS.METADATA_SPANS);
            for (const span of spans) {
                const text = span.textContent.trim().toLowerCase();
                if (text.includes('view') && !viewCountText) {
                    viewCountText = text;
                } else if (text.match(/^(streamed\s+)?\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i) && !metadataDate) {
                    metadataDate = text;
                }
            }
        }

        if (!viewCountText || !metadataDate) {
            logHiding('No view count or date metadata found', videoTitle);
            hideElement(parentElement, 'No view count or date metadata found');
            return;
        }

        const numericViews = parseViewCount(viewCountText);
        debugLog(`   Channel: ${channelName}, Views: ${viewCountText} (${numericViews.toLocaleString()}), Date: ${metadataDate}`);

        const videoDate = parseDateFromMetadata(metadataDate);
        if (videoDate) {
            let afterDate = CONFIG.AFTER_DATE ? new Date(CONFIG.AFTER_DATE) : null;
            let beforeDate = CONFIG.BEFORE_DATE ? new Date(CONFIG.BEFORE_DATE) : null;

            if (afterDate && videoDate < afterDate) {
                logHiding(`Video before AFTER_DATE (${metadataDate})`, videoTitle);
                hideElement(parentElement, `Before AFTER_DATE`);
                return;
            }
            if (beforeDate && videoDate > beforeDate) {
                logHiding(`Video after BEFORE_DATE (${metadataDate})`, videoTitle);
                hideElement(parentElement, `After BEFORE_DATE`);
                return;
            }
        }

        if (numericViews < MINIMUM_VIEWS) {
            logHiding(`Below minimum views: ${viewCountText}`, videoTitle);
            hideElement(parentElement, `Below minimum views: ${viewCountText}`);
            return;
        }

        let viewCount = GM_getValue(videoId, 0) + 1;
        GM_setValue(videoId, viewCount);
        debugLog(`View count: ${viewCount}/${Threshold}`);

        if (viewCount > Threshold) {
            logHiding(`Over threshold (${viewCount}/${Threshold})`, videoTitle);
            hideElement(parentElement, 'Over threshold');
        } else {
            logShowing(`Below threshold (${viewCount}/${Threshold})`, videoTitle);
            showElement(parentElement);
        }
    }

    function observeDOMChanges() {
        // Disconnect existing observer if any
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }

        currentObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches(VIDEO_CONTAINER_SELECTORS)) {
                                processThumbnail(node);
                            } else {
                                node.querySelectorAll(VIDEO_CONTAINER_SELECTORS).forEach(processThumbnail);
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.target.id === 'progress') {
                    const thumbnailElement = mutation.target.closest(VIDEO_CONTAINER_SELECTORS);
                    if (thumbnailElement) {
                        processThumbnail(thumbnailElement);
                    }
                }
            });
        });

        currentObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true
        });
    }

    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll(VIDEO_CONTAINER_SELECTORS);
        debugLog('Processing existing thumbnails:', thumbnails.length);
        thumbnails.forEach(processThumbnail);
    }

    // Enhanced processing function with retry mechanism
    function processPageWithRetry(maxRetries = 3, delay = 500) {
        let retryCount = 0;

        function attemptProcess() {
            const thumbnails = document.querySelectorAll(VIDEO_CONTAINER_SELECTORS);
            debugLog(`Attempt ${retryCount + 1}: Found ${thumbnails.length} thumbnails`);

            if (thumbnails.length > 0 || retryCount >= maxRetries) {
                processExistingThumbnails();
                observeDOMChanges(); // Re-establish observer
            } else {
                retryCount++;
                setTimeout(attemptProcess, delay);
            }
        }

        attemptProcess();
    }

    function loadStoredSubscribedChannels() {
        const storedNames = GM_getValue('subscribedChannelNames');
        if (storedNames && storedNames.length > 2) {
            subscribedChannels = new Set(JSON.parse(storedNames));
            debugLog('Loaded stored subscribed channel names:', Array.from(subscribedChannels));
        } else {
            debugLog('No stored subscribed channel names found. Please visit your subscriptions page (youtube.com/feed/channels) to generate the list.');
        }
    }

    function parseDateFromMetadata(metadataText) {
        const now = new Date();
        // MODIFIED: Made "Streamed " optional at the beginning of the regex
        const match = metadataText.match(/^(Streamed\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);

        if (match) {
            const value = parseInt(match[2], 10); // The numeric value is now in the 2nd capture group
            const unit = match[3]; // The time unit is now in the 3rd capture group

            switch (unit) {
                case 'second':
                    return new Date(now - value * 1000);
                case 'minute':
                    return new Date(now - value * 60000);
                case 'hour':
                    return new Date(now - value * 3600000);
                case 'day':
                    return new Date(now - value * 86400000);
                case 'week':
                    return new Date(now - value * 7 * 86400000);
                case 'month':
                    // Note: setMonth can have edge cases, but is generally fine for this purpose
                    return new Date(now.setMonth(now.getMonth() - value));
                case 'year':
                    return new Date(now.setFullYear(now.getFullYear() - value));
            }
        }
        console.error('Unrecognized date format (not a date):', metadataText);
        return null;
    }

    function isWithinDateRange(videoDate, startDate, endDate) {
        return videoDate >= startDate && videoDate <= endDate;
    }

    function parseViewCount(viewText) {
        const lowerViewText = viewText.toLowerCase();
        // First, try to match with k, m, b units
        let match = lowerViewText.match(/([\d,.]+)\s*([kmb])/);
        if (match) {
            const num = parseFloat(match[1].replace(/,/g, ''));
            const unit = match[2];
            let multiplier = 1;
            switch (unit) {
                case 'k': multiplier = 1_000; break;
                case 'm': multiplier = 1_000_000; break;
                case 'b': multiplier = 1_000_000_000; break;
            }
            return isNaN(num) ? 0 : num * multiplier;
        } else {
            // If no k, m, b unit, try to parse directly as a number
            // Remove "view", "views", and commas, then parse
            const numericValueMatch = lowerViewText.match(/(\d[\d,.]*)/); // Capture sequence of digits and commas/dots
            if (numericValueMatch && numericValueMatch[1]) {
                const num = parseFloat(numericValueMatch[1].replace(/,/g, ''));
                return isNaN(num) ? 0 : num;
            }
        }
        return 0; // Default if no match found
    }

    function injectCSS() {
        const style = document.createElement('style');
        style.textContent = `
    /* Hide all video containers by default until processed */
    ${VIDEO_CONTAINER_SELECTORS} {
        visibility: hidden !important;
        opacity: 0 !important;
    }

    /* Show processed videos that passed the filter */
    ${VIDEO_CONTAINER_SELECTORS}[data-processed="show"] {
        visibility: visible !important;
        opacity: 1 !important;
    }

    /* Keep hidden videos hidden */
    [data-hide-reason] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        max-height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        overflow: hidden !important;
        position: absolute !important;
        left: -9999px !important;
        top: -9999px !important;
        pointer-events: none !important;
    }

    /* Specific targeting for yt-lockup-view-model elements */
    yt-lockup-view-model[data-hide-reason] {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
    }
`;
        document.head.appendChild(style);
    }

    function monitorHiddenElements() {
        setInterval(() => {
            const hiddenElements = document.querySelectorAll('[data-hide-reason]');
            hiddenElements.forEach(element => {
                // CORRECTED: Use getComputedStyle to check the final, actual display property.
                // This will correctly see that the element is hidden by our CSS rule.
                if (window.getComputedStyle(element).display !== 'none') {
                    const reason = element.getAttribute('data-hide-reason');
                    // The element has reappeared despite the attribute. Log it and re-hide.
                    // We don't need to call hideElement again since the attribute is already there.
                    // The browser should re-apply the CSS rule.
                    debugLog(`Force re-hiding element that reappeared: ${reason}`);
                }
            });
        }, 1000); // Check every second
    }

    function observeFirstVideo() {
        const observer = new MutationObserver((mutations, obs) => {
            // Use CONFIG selectors
            const primaryVideo = document.querySelector(CONFIG.SELECTORS.WATCH_CONTAINER);
            const sidebarRecommendations = document.querySelectorAll(CONFIG.SELECTORS.SIDEBAR_RECOMMENDATIONS);

            if (primaryVideo && sidebarRecommendations.length > 0) {
                debugLog('Main video container and recommendations detected, processing...');
                setTimeout(() => {
                    processExistingThumbnails();
                    observeDOMChanges();
                }, 500);
                obs.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            if (shouldRunOnCurrentPage()) {
                debugLog('Fallback processing after observer timeout');
                processExistingThumbnails();
                observeDOMChanges();
            }
        }, 10000);
    }

    function convertLiveUrlToWatchUrl(url) {
        // Convert /live/VIDEO_ID to /watch?v=VIDEO_ID
        const liveMatch = url.match(/\/live\/([^?]+)/);
        if (liveMatch) {
            const videoId = liveMatch[1];
            let newUrl = `https://www.youtube.com/watch?v=${videoId}`;

            // Extract timestamp if present
            const timeMatch = url.match(/[?&]t=(\d+)/);
            if (timeMatch) {
                newUrl += `&t=${timeMatch[1]}s`;
            }

            return newUrl;
        }
        return url;
    }

    function convertCurrentUrl() {
        const currentUrl = window.location.href;
        if (currentUrl.includes('/live/')) {
            const newUrl = convertLiveUrlToWatchUrl(currentUrl);
            if (newUrl !== currentUrl) {
                debugLog('Converting live URL to watch URL:', newUrl);
                window.history.replaceState({}, '', newUrl);
            }
        }
    }

    function init() {
        injectCSS();
        loadStoredSubscribedChannels();
        monitorHiddenElements(); // Add this line
        convertCurrentUrl(); // Add this line
        if (window.location.pathname === '/feed/channels') {
            debugLog('On channels page, fetching subscribed channels');
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            debugLog('Processing thumbnails');
            processPageWithRetry();
        } else {
            debugLog('Not on a target page, script inactive');
        }
    }

    // REPLACE your existing 'yt-navigate-finish' listener with this one
    document.addEventListener('yt-navigate-finish', (event) => {
        const currentUrl = event.detail?.url || window.location.href;
        debugLog('Navigation finished, URL:', currentUrl);

        convertCurrentUrl();
        // The processingQueue.clear() line has been removed.

        if (currentUrl.includes('/feed/channels')) {
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            // Use a more robust approach with multiple retry attempts
            setTimeout(() => {
                debugLog('Starting post-navigation processing...');
                processPageWithRetry(8, 500); // Increased retries and delay
            }, 1000); // Wait longer before starting
        } else {
            debugLog('Navigated to a non-target page, script inactive');
            if (currentObserver) {
                currentObserver.disconnect();
                currentObserver = null;
            }
        }
    });

    // Also listen for the start of navigation to prepare
    document.addEventListener('yt-navigate-start', () => {
        debugLog('Navigation starting...');
        // Disconnect observer during navigation
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }
    });

    // Additional observer for specific YouTube content updates
    const ytAppObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' &&
                (mutation.attributeName === 'video-id' || mutation.attributeName === 'active')) {
                debugLog('YouTube app state changed');
                if (shouldRunOnCurrentPage()) {
                    setTimeout(() => processExistingThumbnails(), 100);
                }
            }
        }
    });

    // Observe the YouTube app element for changes
    const ytApp = document.querySelector('ytd-app');
    if (ytApp) {
        ytAppObserver.observe(ytApp, {
            attributes: true,
            attributeFilter: ['video-id', 'active']
        });
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    debugLog('Script initialized');
})();
