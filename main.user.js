// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @author       BadisG
// @version      8.0
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails.
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false; // Set to true to enable debug logging, false to disable
    let Threshold = 10;
    const MINIMUM_VIEWS = 0; // Add a minimum views threshold here
    let subscribedChannels = new Set();
    let currentObserver = null; // Track the current observer
    const FILTERED_TITLE_TERMS = ['fsfzzerz', 'sdfzertzerzer']; // Add words to filter titles that have those
    const FILTERED_CHANNEL_TERMS = ['qfrtzeerezt', 'truytuhfhgr']; // Add words to filter channel names that have those

    // Define a constant for all target video/playlist container selectors
    const VIDEO_CONTAINER_SELECTORS = 'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-compact-playlist-renderer, ytd-item-section-renderer, yt-lockup-view-model';

    // Debug logging function
    function debugLog(...args) {
        if (DEBUG) {
            console.log(...args);
        }
    }

    // Colored logging functions
    function logHiding(reason, title) {
        // This function is now more accurate, as we are always hiding, not deleting.
        debugLog(`%c❌ HIDING - ${reason}: "${title}"`, 'color: #C03030; font-weight: bold;');
    }

    function logShowing(reason, title) {
            debugLog(`%c✅ SHOWING - ${reason}: "${title}"`, 'color: #30C030; font-weight: bold;');
    }

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

                // Updated selector to get channel names from ytd-channel-name elements
                const channelNameElements = document.querySelectorAll('ytd-channel-name yt-formatted-string#text');
                debugLog(`Scroll ${scrollCount}: Found ${channelNameElements.length} channel names, height: ${currentHeight}`);

                channelNameElements.forEach(nameElement => {
                    const channelName = nameElement.textContent.trim();
                    if (channelName && channelName.length > 0) {
                        // Normalize the name for consistent storage
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
                            const finalChannelNameElements = document.querySelectorAll('ytd-channel-name yt-formatted-string#text');
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

                                // Clean up old storage
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

        // Rest of the observer code remains the same...
        const observer = new MutationObserver((mutations, obs) => {
            const gridContainer = document.querySelector('ytd-expanded-shelf-contents-renderer #contents');
            const listContainer = document.querySelector('ytd-section-list-renderer #items');
            const channelRenderers = document.querySelectorAll('ytd-channel-renderer');

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
            const channelRenderers = document.querySelectorAll('ytd-channel-renderer');
            if (channelRenderers.length > 0) {
                debugLog('Timeout reached, but found channels. Starting fetch anyway...');
                updateSubscribedChannels();
            } else {
                debugLog('Timeout reached and no channels found. Make sure you are on the subscriptions page.');
            }
        }, 10000);
    }

    function getChannelName(thumbnailElement) {
        if (window.location.href.includes("watch?v=")) {
            // On an individual video page - try multiple selectors

            // First try: look for channel name in metadata
            const channelNameSpan = thumbnailElement.querySelector('.yt-content-metadata-view-model-wiz__metadata-row span.yt-core-attributed-string');
            if (channelNameSpan && channelNameSpan.textContent && channelNameSpan.textContent.trim().length > 0) {
                return channelNameSpan.textContent.trim();
            }

            // Fallback: try other possible selectors
            const channelNameElement = thumbnailElement.querySelector('ytd-channel-name yt-formatted-string#text');
            return channelNameElement ? channelNameElement.textContent.trim() : null;

        } else if (window.location.href === "https://www.youtube.com/" || window.location.pathname === '/') {
            // On the youtube home page - updated for new layout

            // First try the new layout structure
            const newLayoutChannelLink = thumbnailElement.querySelector('a[href^="/@"]');
            if (newLayoutChannelLink && newLayoutChannelLink.textContent && newLayoutChannelLink.textContent.trim().length > 0) {
                return newLayoutChannelLink.textContent.trim();
            }

            // Fallback to old layout
            const possibleChannelLinks = thumbnailElement.querySelectorAll('a[href^="/@"]');
            for (const link of possibleChannelLinks) {
                if (link.textContent && link.textContent.trim().length > 0) {
                    return link.textContent.trim();
                }
            }
            return null;
        }
    }

    function isNormalVideo(element) {
        // New check for the new layout element <yt-lockup-view-model>
        if (element.tagName.toUpperCase() === 'YT-LOCKUP-VIEW-MODEL') {
            const contentType = element.getAttribute('ytb-content-type');
            // This element is used for regular videos on the watch page sidebar
            // and for mixes/playlists on the homepage. We only want to hide the playlists.
            if (contentType === 'playlist' || contentType === 'channel') {
                return { isNormal: false, reason: `yt-lockup-view-model is a ${contentType}` };
            }
            // If it's a 'video', let it pass for further checks.
        }

        // Your existing checks are still valuable for other element types
        if (element.tagName.toUpperCase() === 'YTD-COMPACT-PLAYLIST-RENDERER' ||
            element.tagName.toUpperCase() === 'YTD-ITEM-SECTION-RENDERER') {
            return { isNormal: false, reason: 'Playlist element detected' };
        }

        // Check for live streams
        const hasLiveBadge = element.querySelector('[aria-label="LIVE"], .badge-style-type-live-now-alternate, badge-shape.badge-shape-wiz--live');
        const isLiveText = element.querySelector('.yt-badge-shape-wiz__text[aria-label="LIVE"]');
        if (hasLiveBadge || isLiveText) {
            return { isNormal: false, reason: 'Live stream detected' };
        }

        // Check for watched videos (progress bar)
        const hasProgressBar = element.querySelector('#progress, [class*="progress" i]');
        if (hasProgressBar) {
            return { isNormal: false, reason: 'Already watched' };
        }

        return { isNormal: true, reason: 'Normal video' };
    }

    function hideElement(element, reason) {
        if (element) {
            // Set the attribute so our CSS rule and monitor can find it.
            element.setAttribute('data-hide-reason', reason);

            // Also apply a direct, forceful inline style to win potential race conditions.
            // Using !important here makes it very difficult for other scripts to override.
            element.style.display = 'none !important';
        }
    }

    function showElement(element) {
        if (element) {
            // Remove the attribute that our CSS rule targets.
            element.removeAttribute('data-hide-reason');

            // Remove the inline style to allow the element to return to its default display state.
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

    /**
     * Extracts the YouTube video ID from a link within the given element.
     * @param {HTMLElement} element The container element for a video.
     * @returns {string|null} The video ID or null if not found.
     */
    function getVideoId(element) {
        if (!element) return null;

        const link = element.querySelector('a[href*="/watch?v="]');
        if (link && link.href) {
            try {
                const url = new URL(link.href);
                return url.searchParams.get('v');
            } catch (e) {
                // Fallback for relative URLs like /watch?v=...
                const match = link.href.match(/[?&]v=([^&]+)/);
                if (match && match[1]) {
                    return match[1];
                }
            }
        }
        return null;
    }

    // REPLACE your existing processThumbnail function with this one
    function processThumbnail(thumbnailElement) {
        if (!shouldRunOnCurrentPage() || !shouldProcessElement(thumbnailElement)) {
            return;
        }

        let parentElement = thumbnailElement.matches(VIDEO_CONTAINER_SELECTORS) ?
            thumbnailElement :
        thumbnailElement.closest(VIDEO_CONTAINER_SELECTORS);

        if (!parentElement) return;

        // --- KEY CHANGE START ---
        // If the element already has our hide attribute, it has been successfully
        // processed. We can safely ignore it to prevent redundant checks and solve
        // the re-rendering issue.
        if (parentElement.hasAttribute('data-hide-reason')) {
            return;
        }
        // --- KEY CHANGE END ---

        const videoId = getVideoId(parentElement);

        // Updated selector for video title in yt-lockup-view-model
        const videoTitleElement = parentElement.querySelector('h3.yt-lockup-metadata-view-model-wiz__heading-reset span.yt-core-attributed-string');
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

        const normalizedTitle = videoTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        for (const term of FILTERED_TITLE_TERMS) {
            const normalizedTerm = term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (new RegExp(`\\b${normalizedTerm}(?:'s|s)?\\b`, 'i').test(normalizedTitle)) {
                logHiding(`Found "${term}" in title`, videoTitle);
                hideElement(parentElement, `Filtered title term: ${term}`);
                return;
            }
        }

        // Simplified channel name extraction - names only
        let channelName = null;

        // For yt-lockup-view-model elements
        const metadataRows = parentElement.querySelectorAll('.yt-content-metadata-view-model-wiz__metadata-row');
        for (const row of metadataRows) {
            const channelSpan = row.querySelector('span.yt-core-attributed-string');
            if (channelSpan) {
                const text = channelSpan.textContent.trim();
                // Check if this looks like a channel name (not views or time)
                if (!text.includes('view') && !text.includes('ago') && !text.includes('•') && text.length > 0) {
                    channelName = text;
                    break;
                }
            }
        }

        // Fallback for other video container types
        if (!channelName) {
            channelName = getChannelName(parentElement);
        }

        if (!videoId || !channelName) {
            logHiding('Missing video ID or channel name', videoTitle);
            hideElement(parentElement, 'Missing video ID or channel name');
            return;
        }

        // Log what we found for debugging
        debugLog(`   Found - Channel: "${channelName}", Video ID: "${videoId}"`);

        for (const term of FILTERED_CHANNEL_TERMS) {
            if (new RegExp(`\\b${term}(?:'s|s)?\\b`, 'i').test(channelName)) {
                logHiding(`Found "${term}" in channel name: "${channelName}"`, videoTitle);
                hideElement(parentElement, `Filtered channel term: ${term}`);
                return;
            }
        }

        // Check against subscribed channels (names only)
        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isSubscribed = subscribedChannels.has(normalizedChannelName);

        if (isSubscribed) {
            logHiding(`Subscribed channel: "${channelName}"`, videoTitle);
            hideElement(parentElement, `Subscribed channel: ${channelName}`);
            return;
        }

        // Extract view count and date metadata
        let viewCountText = null;
        let metadataDate = null;

        for (const row of metadataRows) {
            const spans = row.querySelectorAll('span.yt-core-attributed-string');
            for (const span of spans) {
                const text = span.textContent.trim().toLowerCase();
                if (text.includes('view') && !viewCountText) {
                    viewCountText = text;
                } else if (text.match(/\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/) && !metadataDate) {
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
        const match = metadataText.match(/^(Streamed\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
        if (match) {
            const value = parseInt(match[2], 10); // The numeric value
            const unit = match[3]; // The time unit
            switch (unit) {
                case 'second': return new Date(now - value * 1000);
                case 'minute': return new Date(now - value * 60000);
                case 'hour': return new Date(now - value * 3600000);
                case 'day': return new Date(now - value * 86400000);
                case 'week': return new Date(now - value * 7 * 86400000);
                case 'month': return new Date(now.setMonth(now.getMonth() - value));
                case 'year': return new Date(now.setFullYear(now.getFullYear() - value));
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
        // Specifically watch for the main video content to load
        const observer = new MutationObserver((mutations, obs) => {
            // Check for both the main video container and sidebar recommendations
            const primaryVideo = document.querySelector('ytd-watch-flexy');
            const sidebarRecommendations = document.querySelectorAll('ytd-compact-video-renderer');

            if (primaryVideo && sidebarRecommendations.length > 0) {
                debugLog('Main video container and recommendations detected, processing...');
                setTimeout(() => {
                    processExistingThumbnails();
                    observeDOMChanges();
                }, 500); // Slightly longer delay
                obs.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Disconnect after 10 seconds to prevent infinite observation
        setTimeout(() => {
            observer.disconnect();
            // Fallback: if observer didn't catch it, try processing anyway
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
