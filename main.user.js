// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Count and hide YouTube thumbnails after 5 views, excluding subscribed channels, and hide playlist, live, and fully watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?v=*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';
    let Threshold = 5;
    let subscribedChannels = new Set();

    // Function to update subscribed channels
    function updateSubscribedChannels(allSubscriptions) {
        subscribedChannels = new Set(Array.from(allSubscriptions).map(el => el.title.trim().toLowerCase()));
        console.log('Subscribed Channels:', Array.from(subscribedChannels)); // Print the subscribed channels
    }

    // Function to load subscribed channels using the working code
    function loadSubscribedChannels() {
        function printAllSubscriptions(allSubscriptions) {
            console.log("List of all subscribed channels:");
            updateSubscribedChannels(allSubscriptions); // Update subscribed channels
        }

        function clickGuideButton() {
            const guideButton = document.querySelector("#guide-button");
            if (guideButton) {
                guideButton.click();
                setTimeout(clickSubscriptionsButton, 1000);
            } else {
                setTimeout(clickGuideButton, 1000);
            }
        }

        function clickSubscriptionsButton() {
            const subscriptionsButton = document.querySelector("ytd-guide-collapsible-entry-renderer.style-scope:nth-child(8) > ytd-guide-entry-renderer:nth-child(1) > a:nth-child(1) > tp-yt-paper-item:nth-child(1)");
            if (subscriptionsButton) {
                subscriptionsButton.click();
                setTimeout(getSubscriptions, 2000);
            } else {
                setTimeout(clickSubscriptionsButton, 1000);
            }
        }

        function getSubscriptions() {
            const allSubscriptions = document.querySelectorAll('a#endpoint.yt-simple-endpoint.style-scope.ytd-guide-entry-renderer[href^="/@"]');
            if (allSubscriptions.length > 0) {
                printAllSubscriptions(allSubscriptions);
            } else {
                setTimeout(getSubscriptions, 1000);
            }
        }

        clickGuideButton(); // Start the process
    }

    // Function to get the video ID from a thumbnail element
    function getVideoId(thumbnailElement) {
        const link = thumbnailElement.querySelector('a#thumbnail') || thumbnailElement.querySelector('a.yt-simple-endpoint');
        if (link) {
            const href = link.getAttribute('href');
            if (href) {
                const match = href.match(/[?&]v=([^&]+)/);
                return match ? match[1] : null;
            }
        }
        return null;
    }

    // Function to get the channel name from a thumbnail element
    function getChannelName(thumbnailElement) {
        const channelNameElement = thumbnailElement.querySelector('ytd-channel-name #text') || thumbnailElement.querySelector('#text');
        return channelNameElement ? channelNameElement.textContent.trim().toLowerCase() : null;
    }

    // Function to check if the thumbnail is a playlist or a mix
    function isPlaylist(thumbnailElement) {
        const playlistLabel = thumbnailElement.querySelector('ytd-thumbnail-overlay-bottom-panel-renderer yt-formatted-string');
        if (playlistLabel) {
            const labelText = playlistLabel.textContent.trim().toLowerCase();
            return /\d+\s+videos/.test(labelText) || labelText === 'mix';
        }
        return false;
    }

    // Function to check if the thumbnail is a live video
    function isLive(thumbnailElement) {
        const liveBadge = thumbnailElement.querySelector('ytd-badge-supported-renderer .badge-style-type-live-now-alternate');
        return !!liveBadge;
    }

    // Function to check if the video has any watch progress
    function hasWatchProgress(element) {
        const progressBar = element.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress');
        return progressBar !== null && progressBar.style.width !== '0%';
    }

    // Function to increment view count and hide if necessary
    function processThumbnail(thumbnailElement) {
        if (isPlaylist(thumbnailElement) || isLive(thumbnailElement) || hasWatchProgress(thumbnailElement)) {
            const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') || thumbnailElement.closest('ytd-compact-video-renderer');
            if (parentElement) {
                parentElement.style.display = 'none';
            }
            return;
        }

        const videoId = getVideoId(thumbnailElement);
        const channelName = getChannelName(thumbnailElement);

        if (videoId && channelName) {
            if (subscribedChannels.has(channelName)) {
                return;
            }
            let viewCount = GM_getValue(videoId, 0);
            viewCount++;
            GM_setValue(videoId, viewCount);

            if (viewCount > Threshold) {
                const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') || thumbnailElement.closest('ytd-compact-video-renderer');
                if (parentElement) {
                    parentElement.style.display = 'none';
                }
            }
        }
    }

    // Function to observe DOM changes
    function observeDOMChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            processThumbnail(node);
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    processThumbnail(mutation.target);
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style']
        });
    }

    // Initial processing of existing thumbnails
    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-grid-media, ytd-compact-video-renderer');
        thumbnails.forEach(processThumbnail);
    }

    // Run the script
    async function init() {
        loadSubscribedChannels(); // Load subscribed channels using the working code
        processExistingThumbnails();
        observeDOMChanges();
    }

    init();
})();
