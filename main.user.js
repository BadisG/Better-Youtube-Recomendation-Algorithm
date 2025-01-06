// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      6.7
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?*
// @match        https://www.youtube.com/feed/channels
// @match        https://www.youtube.com/results*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;
    let Threshold = 10;
    let subscribedChannels = new Set();

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

            console.log('Fetched subscribed channels:', Array.from(subscribedChannels));
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
        // Check current URL
        const isHomePage = window.location.href === 'https://www.youtube.com/' ||
              window.location.href === 'https://www.youtube.com';

        // Check if it's a rich item renderer, compact video, or any type of playlist
        const isRichItem = element.tagName === 'YTD-RICH-ITEM-RENDERER';
        const isCompactVideo = element.tagName === 'YTD-COMPACT-VIDEO-RENDERER';
        const isCompactPlaylist = element.tagName === 'YTD-COMPACT-PLAYLIST-RENDERER';
        const isItemSectionPlaylist = element.tagName === 'YTD-ITEM-SECTION-RENDERER';

        if (element.textContent.includes('LIVE') && element.textContent.includes('watching')) {
            return { isNormal: false, reason: 'Live video' };
        }

        // If it's any type of playlist, mark it as not normal
        if (isCompactPlaylist || isItemSectionPlaylist) {
            return { isNormal: false, reason: 'Playlist element detected' };
        }

        // Only perform duration check on homepage
        if (isHomePage) {
            const elementText = element.textContent;
            const durationMatch = elementText.match(/\d+:\d+/); // Capture the duration
            if (!durationMatch) {
                return { isNormal: false, reason: 'No duration found' };
            } else {
                console.log('Duration found:', durationMatch[0]); // Print the duration
            }
        }

        // Check if the video has been watched
        const hasProgressBar = element.querySelector('#progress, [class*="progress" i]');
        if (hasProgressBar) {
            return { isNormal: false, reason: 'Already watched' };
        }

        // If all checks pass, it's a normal video
        return { isNormal: true, reason: 'Normal video' };
    }

    function hideElement(element, reason) {
        if (element) {
            element.style.display = 'none';
            element.setAttribute('data-hide-reason', reason);
        }
        console.log(reason[0].toUpperCase() + reason.slice(1) + ' \x1b[31m%s\x1b[0m', 'HIDING');

    }

    function showElement(element) {
        if (element) {
            element.style.display = '';
            element.removeAttribute('data-hide-reason');
        }
        console.log('Below threshold: \x1b[32m%s\x1b[0m', 'SHOWING');
    }

    function processThumbnail(thumbnailElement) {
        if (!shouldRunOnCurrentPage()) {
            console.log('Not on a target page, skipping processing');
            return;
        }

        // Look for the parent element to ensure we are processing a valid video/playlist thumbnail
        const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') ||
              thumbnailElement.closest('ytd-compact-video-renderer') ||
              thumbnailElement.closest('ytd-compact-playlist-renderer') ||
              thumbnailElement.closest('ytd-item-section-renderer');

        if (!parentElement) {
            console.log('No parent element found, skipping');
            return;
        }

        // Check if the element represents a normal video
        const normalVideoCheck = isNormalVideo(parentElement);
        if (!normalVideoCheck.isNormal) {
            hideElement(parentElement, `Not a normal video: ${normalVideoCheck.reason}`);
            return;
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
            console.log('No valid date metadata found, skipping');
            return;
        }

        // Parse the publication date from the metadata
        const videoDate = parseDateFromMetadata(metadataDate);
        const startDate = new Date('2004-02-15'); // Set your desired start date
        const endDate = new Date(); // Set endDate to today's date

        // Check if the video falls within the specified date range
        if (!videoDate || !isWithinDateRange(videoDate, startDate, endDate)) {
            hideElement(parentElement, `Outside date range: ${metadataDate}`);
            return;
        }

        // Optionally, skip streamed videos (if desired)
        if (isStreamed) {
            hideElement(parentElement, `Streamed video: ${metadataDate}`);
            return;
        }

        // Get video ID and channel name
        const videoId = getVideoId(parentElement);
        const channelName = getChannelName(parentElement);
        if (!videoId || !channelName) {
            hideElement(parentElement, 'Missing video ID or channel name');
            return;
        }

        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        console.log('Video ID:', videoId, '| Channel:', normalizedChannelName);

        // Hide the video if it belongs to a subscribed channel
        if (subscribedChannels.has(normalizedChannelName)) {
            hideElement(parentElement, 'Subscribed');
            return;
        }

        // Handle view count threshold
        let viewCount = GM_getValue(videoId, 0) + 1;
        GM_setValue(videoId, viewCount);
        console.log('View count:', viewCount);

        if (viewCount > Threshold) {
            hideElement(parentElement, 'Over threshold');
            return;
        } else {
            showElement(parentElement);
        }
    }



    function observeDOMChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches('ytd-rich-item-renderer, ytd-compact-video-renderer', 'ytd-compact-playlist-renderer', 'ytd-item-section-renderer')) {
                                processThumbnail(node);
                            } else {
                                node.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer','ytd-compact-playlist-renderer', 'ytd-item-section-renderer').forEach(processThumbnail);
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.target.id === 'progress') {
                    const thumbnailElement = mutation.target.closest('ytd-rich-item-renderer') ||
                          mutation.target.closest('ytd-compact-video-renderer')||
                          mutation.target.closest('ytd-compact-playlist-renderer')||
                          mutation.target.closest('ytd-item-section-renderer');
                    if (thumbnailElement) {
                        processThumbnail(thumbnailElement);
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true
        });
    }

    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer', 'ytd-compact-playlist-renderer', 'ytd-item-section-renderer');
        console.log('Processing existing thumbnails:', thumbnails.length);
        thumbnails.forEach(processThumbnail);
    }

    function loadStoredSubscribedChannels() {
        const storedChannels = GM_getValue('subscribedChannels');
        if (storedChannels) {
            subscribedChannels = new Set(JSON.parse(storedChannels));
            console.log('Loaded stored subscribed channels:', Array.from(subscribedChannels));
        } else {
            console.log('No stored subscribed channels found');
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

    function init() {
        loadStoredSubscribedChannels();

        if (window.location.pathname === '/feed/channels') {
            console.log('On channels page, fetching subscribed channels');
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            console.log('Processing thumbnails');
            processExistingThumbnails();
            observeDOMChanges();
        } else {
            console.log('Not on a target page, script inactive');
        }
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    document.addEventListener('yt-navigate-finish', (event) => {
        const currentUrl = event.detail?.url || window.location.href;
        console.log('Using URL:', currentUrl);

        if (currentUrl.includes('/feed/channels')) {
            fetchSubscribedChannels();
        } else if (shouldRunOnCurrentPage()) {
            // Add a delay to wait for YouTube to load recommendations
            setTimeout(() => {
                processExistingThumbnails();
                // Re-initialize the observer to catch any new thumbnails
                observeDOMChanges();
            }, 1500); // 1.5 second delay
        } else {
            console.log('Navigated to a non-target page, script inactive');
        }
    });
    console.log('Script initialized');
})();
