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
    let processingQueue = new Set(); // Prevent duplicate processing
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
        const isHomePage = window.location.pathname === '/';
        const action = isHomePage ? 'HIDING' : 'DELETING';
        debugLog(`%c❌ ${action} - ${reason}: "${title}"`, 'color: #C03030; font-weight: bold;');
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
            const channelElements = document.querySelectorAll('yt-formatted-string#text.style-scope.ytd-channel-name');
            let newSubscribedChannels = [];
            channelElements.forEach(element => {
                const channelName = element.textContent.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (!newSubscribedChannels.includes(channelName)) {
                    newSubscribedChannels.push(channelName);
                }
            });
            GM_setValue('subscribedChannels', JSON.stringify(newSubscribedChannels));
            subscribedChannels = new Set(newSubscribedChannels);
            debugLog('Fetched subscribed channels:', Array.from(subscribedChannels));
        }

        function waitForChannels() {
            const observer = new MutationObserver((mutations, obs) => {
                const channelList = document.querySelector('#items.style-scope.ytd-section-list-renderer');
                if (channelList) {
                    updateSubscribedChannels();
                    obs.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        waitForChannels();
        setInterval(updateSubscribedChannels, 6000);
    }

    function getVideoId(thumbnailElement) {
        // Try the original selector first
        let videoLink = thumbnailElement.querySelector('a[href^="/watch?v="]');

        // If not found, try the new layout structure
        if (!videoLink) {
            videoLink = thumbnailElement.querySelector('a[href*="/watch?v="]');
        }

        if (videoLink) {
            const href = videoLink.getAttribute('href');
            const match = href.match(/[?&]v=([^&]+)/);
            return match ? match[1] : null;
        }
        return null;
    }

    function getChannelName(thumbnailElement) {
        if (window.location.href.includes("watch?v=")) {
            // On an individual video page
            const channelNameElement = thumbnailElement.querySelector('ytd-channel-name yt-formatted-string#text');
            return channelNameElement ? channelNameElement.textContent.trim() : null;
        } else if (window.location.href === "https://www.youtube.com/") {
            // On the youtube home page
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
            const isHomePage = window.location.pathname === '/';

            if (isHomePage) {
                // On homepage, hide instead of delete
                element.style.display = 'none';
                element.setAttribute('data-hide-reason', reason);
            } else {
                // On other pages, try multiple approaches
                element.style.display = 'none';
                element.style.visibility = 'hidden';
                element.style.opacity = '0';
                element.style.height = '0';
                element.style.overflow = 'hidden';
                element.setAttribute('data-hide-reason', reason);

                // Try to remove after a short delay
                setTimeout(() => {
                    if (element.parentNode) {
                        element.remove();
                    }
                }, 100);
            }
        }
    }

    function showElement(element) {
        if (element) {
            element.style.display = '';
            element.removeAttribute('data-hide-reason');
        }
    }

    function shouldProcessElement(element) {
        const isHomePage = window.location.pathname === '/';
        const isWatchPage = window.location.pathname === '/watch';

        if (isHomePage) {
            // On homepage, process rich items and some compact videos
            return element.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                element.tagName === 'YTD-COMPACT-VIDEO-RENDERER';
        } else if (isWatchPage) {
            // On watch pages, only process compact video renderers (sidebar recommendations)
            const tagName = element.tagName.toUpperCase(); // Normalize to uppercase
            return tagName === 'YTD-COMPACT-VIDEO-RENDERER' || // Sidebar videos
                tagName === 'YT-LOCKUP-VIEW-MODEL';
        }

        return false;
    }

    function processThumbnail(thumbnailElement) {
        if (!shouldRunOnCurrentPage() || !shouldProcessElement(thumbnailElement)) {
            return;
        }

        let parentElement = thumbnailElement.matches(VIDEO_CONTAINER_SELECTORS) ?
            thumbnailElement :
        thumbnailElement.closest(VIDEO_CONTAINER_SELECTORS);

        if (!parentElement) return;

        // --- NEW SELECTORS FOR NEW LAYOUT ---
        const isNewLayout = parentElement.matches('yt-lockup-view-model');
        const oldLayoutTitleEl = parentElement.querySelector('#video-title, yt-formatted-string#video-title');
        const newLayoutTitleEl = parentElement.querySelector('h3.yt-lockup-metadata-view-model-wiz__heading-reset span.yt-core-attributed-string');

        const videoTitleElement = newLayoutTitleEl || oldLayoutTitleEl;
        const videoTitle = videoTitleElement ? videoTitleElement.textContent.trim() : 'Unknown Title';

        debugLog(`%cProcessing: "${videoTitle}"`, 'font-weight: bold');

        const normalVideoCheck = isNormalVideo(parentElement);
        if (!normalVideoCheck.isNormal) {
            logHiding(normalVideoCheck.reason, videoTitle);
            hideElement(parentElement, `Not a normal video: ${normalVideoCheck.reason}`);
            return;
        }

        for (const term of FILTERED_TITLE_TERMS) {
            if (new RegExp(`\\b${term}(?:'s|s)?\\b`, 'i').test(videoTitle)) {
                logHiding(`Found "${term}" in title`, videoTitle);
                hideElement(parentElement, `Filtered title term: ${term}`);
                return;
            }
        }

        const videoId = getVideoId(parentElement);
        let channelName;
        let metadataElements;

        if (isNewLayout) {
            // Find channel name, views, and date in the new layout
            const metadataRows = parentElement.querySelectorAll('.yt-content-metadata-view-model-wiz__metadata-text');
            metadataElements = Array.from(metadataRows);
            // The first metadata row is usually the channel name
            channelName = metadataRows.length > 0 ? metadataRows[0].textContent.trim() : null;
        } else {
            // Fallback to old layout logic
            channelName = getChannelName(parentElement);
            metadataElements = parentElement.querySelectorAll('.inline-metadata-item.style-scope.ytd-video-meta-block');
        }

        if (!videoId || !channelName) {
            logHiding('Missing video ID or channel name', videoTitle);
            hideElement(parentElement, 'Missing video ID or channel name');
            return;
        }

        for (const term of FILTERED_CHANNEL_TERMS) {
            if (new RegExp(`\\b${term}(?:'s|s)?\\b`, 'i').test(channelName)) {
                logHiding(`Found "${term}" in channel name: "${channelName}"`, videoTitle);
                hideElement(parentElement, `Filtered channel term: ${term}`);
                return;
            }
        }

        let viewCountText = null;
        let metadataDate = null;
        metadataElements.forEach(element => {
            const text = element.textContent.trim().toLowerCase();
            if (text.includes('view')) {
                viewCountText = text;
            } else if (text.match(/\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/)) {
                metadataDate = text;
            }
        });

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

        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (subscribedChannels.has(normalizedChannelName)) {
            logHiding(`Subscribed channel: "${channelName}"`, videoTitle);
            hideElement(parentElement, 'Subscribed');
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
        const storedChannels = GM_getValue('subscribedChannels');
        if (storedChannels) {
            subscribedChannels = new Set(JSON.parse(storedChannels));
            debugLog('Loaded stored subscribed channels:', Array.from(subscribedChannels));
        } else {
            debugLog('No stored subscribed channels found');
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

    // Add this after your constants but before the functions
    function injectCSS() {
        const style = document.createElement('style');
        style.textContent = `
    [data-hide-reason] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        height: 0 !important;
        width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        overflow: hidden !important;
        position: absolute !important;
        left: -9999px !important;
    }
`;
        document.head.appendChild(style);
    }

    function monitorHiddenElements() {
        setInterval(() => {
            const hiddenElements = document.querySelectorAll('[data-hide-reason]');
            hiddenElements.forEach(element => {
                if (element.style.display !== 'none') {
                    const reason = element.getAttribute('data-hide-reason');
                    hideElement(element, reason);
                    debugLog(`Re-hiding element that reappeared: ${reason}`);
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

    // Enhanced navigation handler
    document.addEventListener('yt-navigate-finish', (event) => {
        const currentUrl = event.detail?.url || window.location.href;
        debugLog('Navigation finished, URL:', currentUrl);

        convertCurrentUrl();
        processingQueue.clear();

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
