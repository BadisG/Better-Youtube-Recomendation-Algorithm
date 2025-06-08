// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?*
// @match        https://www.youtube.com/feed/channels
// @match        https://www.youtube.com/results*
// @match        https://www.youtube.com/user/*
// @match        https://www.youtube.com/channel/*
// @match        https://www.youtube.com/c/*
// @match        https://www.youtube.com/@*
// @match        https://www.youtube.com/live/*
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
        const videoLink = thumbnailElement.querySelector('a[href^="/watch?v="]');
        if (videoLink) {
            const href = videoLink.getAttribute('href');
            // Extract the video ID using a regular expression
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
        if (element.tagName.toUpperCase() === 'YT-LOCKUP-VIEW-MODEL') {
            return { isNormal: false, reason: 'yt-lockup-view-model (Mix/Collection) detected' };
        }

        // Check current URL
        const isHomePage = window.location.href === 'https://www.youtube.com/' ||
              window.location.href === 'https://www.youtube.com';
        const isWatchPage = window.location.href.includes('/watch?v=');

        // Different handling for different page types
        if (isWatchPage) {
            // On watch pages, compact video renderers are the normal recommended videos
            const isCompactVideo = element.tagName === 'YTD-COMPACT-VIDEO-RENDERER';
            const isCompactPlaylist = element.tagName === 'YTD-COMPACT-PLAYLIST-RENDERER';

            // Hide playlists but allow compact videos
            if (isCompactPlaylist) {
                return { isNormal: false, reason: 'Playlist element detected' };
            }

            // Check for live streams and hide them
            const hasLiveBadge = element.querySelector('[aria-label="LIVE"], .badge-style-type-live-now-alternate');
            const hasWatchingCount = element.textContent.match(/\d+\s+watching/);
            if (hasLiveBadge || hasWatchingCount) {
                return { isNormal: false, reason: 'Live stream detected' };
            }

            // Check for watched videos (progress bar)
            const hasProgressBar = element.querySelector('#progress, [class*="progress" i]');
            if (hasProgressBar) {
                return { isNormal: false, reason: 'Already watched' };
            }

            // For watch pages, don't check duration - compact videos don't always show duration the same way
            return { isNormal: true, reason: 'Normal video (watch page)' };
        } else if (isHomePage) {
            // Original homepage logic
            const isRichItem = element.tagName === 'YTD-RICH-ITEM-RENDERER';
            const isCompactVideo = element.tagName === 'YTD-COMPACT-VIDEO-RENDERER';
            const isCompactPlaylist = element.tagName === 'YTD-COMPACT-PLAYLIST-RENDERER';
            const isItemSectionPlaylist = element.tagName === 'YTD-ITEM-SECTION-RENDERER';

            if (isCompactPlaylist || isItemSectionPlaylist) {
                return { isNormal: false, reason: 'Playlist element detected' };
            }

            // Duration check only for homepage
            const elementText = element.textContent;
            const durationMatch = elementText.match(/\d+:\d+/);
            if (!durationMatch) {
                return { isNormal: false, reason: 'No duration found' };
            }

            const hasProgressBar = element.querySelector('#progress, [class*="progress" i]');
            if (hasProgressBar) {
                return { isNormal: false, reason: 'Already watched' };
            }

            return { isNormal: true, reason: 'Normal video (homepage)' };
        }

        // For other pages, default to normal
        return { isNormal: true, reason: 'Default normal' };
    }

    function hideElement(element, reason) {
        if (element) {
            element.remove(); // This completely removes the element from the DOM
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
        if (!shouldRunOnCurrentPage()) {
            debugLog('Not on a target page, skipping processing');
            return;
        }

        if (!shouldProcessElement(thumbnailElement)) {
            debugLog('Element type not suitable for current page, skipping');
            return;
        }

        // Look for the parent element to ensure we are processing a valid video/playlist thumbnail
        const parentElement = thumbnailElement.closest(VIDEO_CONTAINER_SELECTORS);
        if (!parentElement) {
            debugLog('No parent element found, skipping');
            return;
        }

        // Get video title first for logging purposes
        const videoTitleElement = parentElement.querySelector('#video-title, yt-formatted-string#video-title');
        let videoTitle = 'Unknown Title';
        if (videoTitleElement) {
            videoTitle = videoTitleElement.textContent.trim();
        }
        debugLog(`%cProcessing: "${videoTitle}"`, 'font-weight: bold');

        // Check if the element represents a normal video - FIRST CHECK
        const normalVideoCheck = isNormalVideo(parentElement);
        if (!normalVideoCheck.isNormal) {
            logHiding(`${normalVideoCheck.reason}`, videoTitle);
            hideElement(parentElement, `Not a normal video: ${normalVideoCheck.reason}`);
            return; // EARLY RETURN - prevents further processing
        }

        // Check for filtered title terms - SECOND CHECK
        if (videoTitleElement) {
            for (const term of FILTERED_TITLE_TERMS) {
                const regex = new RegExp(`\\b${term}(?:'s|s)?\\b`, 'i');
                if (regex.test(videoTitle)) {
                    logHiding(`Found "${term}" in title`, videoTitle);
                    hideElement(parentElement, `Filtered title term: ${term}`);
                    return; // EARLY RETURN
                }
            }
        }

        // Get video ID and channel name
        const videoId = getVideoId(parentElement);
        const channelName = getChannelName(parentElement);
        if (!videoId || !channelName) {
            logHiding('Missing video ID or channel name', videoTitle);
            hideElement(parentElement, 'Missing video ID or channel name');
            return; // EARLY RETURN
        }

        // Check for filtered channel name terms - THIRD CHECK
        for (const term of FILTERED_CHANNEL_TERMS) {
            const regex = new RegExp(`\\b${term}(?:'s|s)?\\b`, 'i');
            if (regex.test(channelName)) {
                logHiding(`Found "${term}" in channel name: "${channelName}"`, videoTitle);
                hideElement(parentElement, `Filtered channel term: ${term}`);
                return; // EARLY RETURN
            }
        }

        // Retrieve metadata elements (date and views share the same class)
        const metadataElements = parentElement.querySelectorAll('.inline-metadata-item.style-scope.ytd-video-meta-block');
        let metadataDate = null;
        let isStreamed = false;

        // Loop through metadata elements to find one matching a date or streamed format
        metadataElements.forEach((element) => {
            const text = element.textContent.trim();
            if (text.match(/^(Streamed\s+)?\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/)) {
                metadataDate = text;
                isStreamed = text.startsWith('Streamed');
            }
        });

        // Skip if no valid date metadata is found
        if (!metadataDate) {
            logHiding('No valid date metadata found', videoTitle);
            hideElement(parentElement, 'No valid date metadata found');
            return; // EARLY RETURN
        }

        // Parse the publication date from the metadata
        const videoDate = parseDateFromMetadata(metadataDate);
        const startDate = new Date('2004-02-15'); // Set your desired start date
        const endDate = new Date(); // Set endDate to today's date

        // Check if the video falls within the specified date range
        if (!videoDate || !isWithinDateRange(videoDate, startDate, endDate)) {
            logHiding(`Outside date range: ${metadataDate}`, videoTitle);
            hideElement(parentElement, `Outside date range: ${metadataDate}`);
            return; // EARLY RETURN
        }

        // Optionally, skip streamed videos (if desired)
        if (isStreamed) {
            logHiding(`Streamed video: ${metadataDate}`, videoTitle);
            hideElement(parentElement, `Streamed video: ${metadataDate}`);
            return; // EARLY RETURN
        }

        // Extract and evaluate view count
        let viewCountText = null;
        metadataElements.forEach((element) => {
            const text = element.textContent.trim();
            const lowerText = text.toLowerCase();
            // Check for date/streamed info
            if (lowerText.match(/^(streamed\s+)?\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/)) {
                metadataDate = text;
                isStreamed = lowerText.startsWith('streamed');
            }
            // Check for view count (modified condition here!)
            if (lowerText.includes('view')) { // Check for "view" (singular)
                viewCountText = text;
            }
        });

        if (!viewCountText) {
            logHiding('No view count metadata found', videoTitle);
            hideElement(parentElement, 'No view count metadata found');
            return; // EARLY RETURN
        }

        const numericViews = parseViewCount(viewCountText);
        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Comprehensive logging for all video details
        debugLog(`   Channel: ${channelName}`);
        debugLog(`   Views: ${viewCountText} (${numericViews.toLocaleString()} views)`);
        debugLog(`   Date: ${metadataDate}`);

        if (numericViews < MINIMUM_VIEWS) {
            logHiding(`Below minimum views: ${viewCountText}`, videoTitle);
            hideElement(parentElement, `Below minimum views: ${viewCountText}`);
            return; // EARLY RETURN
        }

        // Hide the video if it belongs to a subscribed channel
        if (subscribedChannels.has(normalizedChannelName)) {
            logHiding(`Subscribed channel: "${channelName}"`, videoTitle);
            hideElement(parentElement, 'Subscribed');
            return; // EARLY RETURN
        }

        // Handle view count threshold
        let viewCount = GM_getValue(videoId, 0) + 1;
        GM_setValue(videoId, viewCount);
        debugLog(`View count: ${viewCount}/${Threshold}`);

        if (viewCount > Threshold) {
            logHiding(`Over threshold (${viewCount}/${Threshold})`, videoTitle);
            hideElement(parentElement, 'Over threshold');
            return; // EARLY RETURN
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
            const primaryVideo = document.querySelector('ytd-watch-flexy');
            if (primaryVideo) {
                debugLog('Main video container detected, processing recommendations');
                setTimeout(() => {
                    processExistingThumbnails();
                    observeDOMChanges();
                }, 300);
                obs.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Disconnect after 5 seconds to prevent infinite observation
        setTimeout(() => observer.disconnect(), 5000);
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

        convertCurrentUrl(); // Add this line
        processingQueue.clear();

        if (currentUrl.includes('/feed/channels')) {
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            observeFirstVideo(); // Add this line
            processPageWithRetry(5, 300);
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
        // Optionally disconnect observer during navigation
        if (currentObserver) {
            currentObserver.disconnect();
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
