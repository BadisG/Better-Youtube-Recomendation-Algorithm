// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Count and hide YouTube thumbnails after 10 views, excluding subscribed channels, and hide playlist, live, and watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?*
// @match        https://www.youtube.com/feed/channels
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;
    let Threshold = 10;
    let subscribedChannels = new Set();

    function shouldRunOnCurrentPage() {
        const url = window.location.href;
        return url === 'https://www.youtube.com/' ||
            url.startsWith('https://www.youtube.com/watch?') ||
            url === 'https://www.youtube.com/feed/channels';
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
        // Check if it's a rich item renderer or compact video
        const isRichItem = element.tagName === 'YTD-RICH-ITEM-RENDERER';
        const isCompactVideo = element.tagName === 'YTD-COMPACT-VIDEO-RENDERER';

        // Check for duration
        const elementText = element.textContent;
        const durationMatch = elementText.match(/\d+:\d+/); // Capture the duration
        if (!durationMatch) {
            return { isNormal: false, reason: 'No duration found' };
        } else {
            console.log('Duration found:', durationMatch[0]); // Print the duration
        }

        // Check if the video has been watched
        const hasProgressBar = element.querySelector('[class*="progress" i]');
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

        const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') || thumbnailElement.closest('ytd-compact-video-renderer');
        if (!parentElement) {
            console.log('No parent element found, skipping');
            return;
        }

        const videoId = getVideoId(parentElement);
        const channelName = getChannelName(parentElement);
        if (!videoId || !channelName) {
            hideElement(parentElement, 'missing video ID or channel name');
            return;
        }

        const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        console.log('Video ID:', videoId, '| Channel:', normalizedChannelName);

        // Subscribed channel check moved here, before the duration check
        if (subscribedChannels.has(normalizedChannelName)) {
            hideElement(parentElement, 'subscribed');
            return;
        }

        let viewCount = GM_getValue(videoId, 0) + 1;
        GM_setValue(videoId, viewCount);
        console.log('View count:', viewCount);

        if (viewCount > Threshold) {
            hideElement(parentElement, 'Over threshold:');
            return;
        } else {
            showElement(parentElement);
        }

        const normalVideoCheck = isNormalVideo(parentElement);
        if (!normalVideoCheck.isNormal) {
            hideElement(parentElement, `Not a normal video: ${normalVideoCheck.reason}`);
            return;
        }
    }

    function observeDOMChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches('ytd-rich-item-renderer, ytd-compact-video-renderer')) {
                                processThumbnail(node);
                            } else {
                                node.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer').forEach(processThumbnail);
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.target.id === 'progress') {
                    const thumbnailElement = mutation.target.closest('ytd-rich-item-renderer') || mutation.target.closest('ytd-compact-video-renderer');
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
        const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer');
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
        if (event.detail && event.detail.url) {
            console.log('Navigation detected:', event.detail.url);
            if (event.detail.url.includes('/feed/channels')) {
                fetchSubscribedChannels();
            } else if (shouldRunOnCurrentPage()) {
                processExistingThumbnails();
            } else {
                console.log('Navigated to a non-target page, script inactive');
            }
        }
    });

    console.log('Script initialized');
})();
