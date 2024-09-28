// ==UserScript==
// @name         Better Youtube Recommendation Algorithm
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Count and hide YouTube thumbnails after 5 views, excluding subscribed channels, and hide playlist, live, and fully watched thumbnails.
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/watch?v=*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    let Threshold = 10;
    let subscribedChannels = new Set();

    // Function to update subscribed channels
    function updateSubscribedChannels(allSubscriptions) {
        subscribedChannels = new Set(
            Array.from(allSubscriptions).map((el) =>
                el.title.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            )
        );
        console.log('Updated Subscribed Channels:', Array.from(subscribedChannels)); // Debug log
    }

    function setGuideTransparency(transparent) {
        const guideContainer = document.querySelector('#contentContainer');
        const scrim = document.querySelector('#scrim');

        if (guideContainer) {
            guideContainer.style.transition = 'opacity 2s';
            guideContainer.style.opacity = transparent ? '0' : '1';
        }

        if (scrim) {
            scrim.style.transition = 'opacity 2s';
            scrim.style.opacity = transparent ? '0' : '1';
        }
    }

    // Function to load subscribed channels using the working code
    function loadSubscribedChannels() {
        return new Promise((resolve) => {
            function printAllSubscriptions(allSubscriptions) {
                console.log('List of all subscribed channels:');
                updateSubscribedChannels(allSubscriptions);
                closeGuide();
                setGuideTransparency(false);
                resolve();
            }

            function openGuide() {
                const guideButton = document.querySelector('#guide-button');
                if (guideButton) {
                    const isOpen = guideButton.getAttribute('aria-pressed') === 'true';
                    if (!isOpen) {
                        guideButton.click();
                    }
                    setTimeout(clickSubscriptionsButton, 1000);
                } else {
                    setTimeout(openGuide, 1000);
                }
            }

            function clickSubscriptionsButton() {
                const subscriptionsButton = document.querySelector(
                    'ytd-guide-collapsible-entry-renderer.style-scope:nth-child(8) > ytd-guide-entry-renderer:nth-child(1) > a:nth-child(1) > tp-yt-paper-item:nth-child(1)'
                );
                if (subscriptionsButton) {
                    subscriptionsButton.click();
                    setTimeout(getSubscriptions, 2000);
                } else {
                    setTimeout(clickSubscriptionsButton, 1000);
                }
            }

            function getSubscriptions() {
                const allSubscriptions = document.querySelectorAll(
                    'ytd-guide-section-renderer:nth-child(2) a#endpoint.yt-simple-endpoint[href^="/@"]'
                );
                if (allSubscriptions.length > 0) {
                    printAllSubscriptions(allSubscriptions);
                } else {
                    setTimeout(getSubscriptions, 1000);
                }
            }

            function closeGuide() {
                const guideButton = document.querySelector('#guide-button');
                const guideDrawer = document.querySelector('tp-yt-app-drawer#guide');

                if (guideButton) {
                    const isOpen = guideButton.getAttribute('aria-pressed') === 'true';

                    if (isOpen) {
                        guideButton.click();
                        setTimeout(() => {
                            if (guideButton.getAttribute('aria-pressed') === 'false') {
                                console.log('Guide successfully closed after gathering subscriptions');
                                // Ensure the 'opened' attribute is removed
                                if (guideDrawer) {
                                    guideDrawer.removeAttribute('opened');
                                    console.log('Removed "opened" attribute from guide drawer');
                                }
                            } else {
                                console.log('Failed to close guide. Retrying...');
                                closeGuide();
                            }
                        }, 500);
                    } else {
                        console.log('Guide was already closed');
                        // Ensure the 'opened' attribute is removed
                        if (guideDrawer) {
                            guideDrawer.removeAttribute('opened');
                            console.log('Removed "opened" attribute from guide drawer');
                        }
                    }
                }
            }

            openGuide(); // Start the process by ensuring the guide is open
        });
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
        const channelNameElement =
            thumbnailElement.querySelector('ytd-channel-name #text-container yt-formatted-string#text') ||
            thumbnailElement.querySelector('#text');
        return channelNameElement ? channelNameElement.textContent.trim() : null;
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
        const videoId = getVideoId(thumbnailElement);
        const channelName = getChannelName(thumbnailElement);

        if (videoId && channelName) {
            console.log('Processing thumbnail:', channelName); // Debug log

            const parentElement = thumbnailElement.closest('ytd-rich-item-renderer') || thumbnailElement.closest('ytd-compact-video-renderer');

            const normalizedChannelName = channelName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            // Check if the channel is in the subscribed list
            if (subscribedChannels.has(normalizedChannelName)) {
                console.log('Subscribed channel, hiding:', channelName); // Debug log
                if (parentElement) {
                    parentElement.style.display = 'none'; // Hide subscribed channel videos
                }
                return;
            }

            if (isPlaylist(thumbnailElement) || isLive(thumbnailElement) || hasWatchProgress(thumbnailElement)) {
                console.log('Hiding playlist/live/watched video:', channelName);
                if (parentElement) {
                    parentElement.style.display = 'none';
                }
                return;
            }

            let viewCount = GM_getValue(videoId, 0);
            viewCount++;
            GM_setValue(videoId, viewCount);

            if (viewCount > Threshold) {
                console.log('Hiding video above threshold:', channelName, 'View count:', viewCount);
                if (parentElement) {
                    parentElement.style.display = 'none';
                }
            } else {
                console.log('Keeping video below threshold:', channelName, 'View count:', viewCount);
                if (parentElement) {
                    parentElement.style.display = ''; // Ensure it's visible
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
                            if (node.matches('ytd-rich-item-renderer, ytd-compact-video-renderer')) {
                                processThumbnail(node);
                            } else {
                                node.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer').forEach(processThumbnail);
                            }
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Initial processing of existing thumbnails
    function processExistingThumbnails() {
        const thumbnails = document.querySelectorAll('ytd-rich-grid-media, ytd-compact-video-renderer');
        thumbnails.forEach(processThumbnail);
    }

    // Function to run the entire process
    async function runEntireProcess() {
        await loadSubscribedChannels();
        processExistingThumbnails();
        observeDOMChanges();
    }

    // Modified init function
    function init() {
        // Wait until the page is fully loaded before running the process
        if (document.readyState === 'complete') {
            runEntireProcess();
        } else {
            window.addEventListener('load', runEntireProcess);
        }

        // Add event listeners for navigation within YouTube
        document.addEventListener('yt-navigate-start', runEntireProcess);
        document.addEventListener('yt-navigate-finish', runEntireProcess);
    }

    // Run init when the script loads
    init();
})();
