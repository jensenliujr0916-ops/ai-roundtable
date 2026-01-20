// AI Panel - Perplexity Content Script

(function() {
    'use strict';

    const AI_TYPE = 'perplexity';

    // Check if extension context is still valid
    function isContextValid() {
        return chrome.runtime && chrome.runtime.id;
    }

    // Safe message sender that checks context first
    function safeSendMessage(message, callback) {
        if (!isContextValid()) {
            console.log('[AI Panel] Extension context invalidated, skipping message');
            return;
        }

        try {
            chrome.runtime.sendMessage(message, callback);
        } catch (e) {
            console.log('[AI Panel] Failed to send message:', e.message);
        }
    }

    // Notify background that content script is ready
    safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'INJECT_MESSAGE') {
            injectMessage(message.message)
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;
        }

        if (message.type === 'GET_LATEST_RESPONSE') {
            const response = getLatestResponse();
            sendResponse({ content: response });
            return true;
        }
    });

    // Setup response observer for cross-reference feature
    setupResponseObserver();

    async function injectMessage(text) {
        // Perplexity uses a textarea with id="ask-input"
        const inputSelectors = [
            'textarea#ask-input',
            'textarea[placeholder*="問題"]',
            'textarea[placeholder*="question"]',
            '[contenteditable="true"]#ask-input'
        ];

        let inputEl = null;
        for (const selector of inputSelectors) {
            inputEl = document.querySelector(selector);
            if (inputEl) break;
        }

        if (!inputEl) {
            throw new Error('Could not find input field');
        }

        // Focus the input
        inputEl.focus();

        // Set the value
        if (inputEl.tagName === 'TEXTAREA') {
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (inputEl.isContentEditable) {
            inputEl.textContent = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Small delay to let React process
        await sleep(200);

        // Press Enter to submit
        inputEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true
        }));

        // Start capturing response after sending
        console.log('[AI Panel] Perplexity message sent, starting response capture...');
        waitForStreamingComplete();

        return true;
    }

    function setupResponseObserver() {
        // Watch for new responses in the conversation
        const observer = new MutationObserver((mutations) => {
            // Check context validity in observer callback
            if (!isContextValid()) {
                observer.disconnect();
                return;
            }

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            checkForResponse(node);
                        }
                    }
                }
            }
        });

        // Start observing once the main content area is available
        const startObserving = () => {
            if (!isContextValid()) return;

            const mainContent = document.querySelector('main') || document.body;
            observer.observe(mainContent, {
                childList: true,
                subtree: true
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserving);
        } else {
            startObserving();
        }
    }

    let lastCapturedContent = '';
    let isCapturing = false;

    function checkForResponse(node) {
        if (isCapturing) return;

        // Perplexity response selectors
        const responseSelectors = [
            '[class*="answer"]',
            '[class*="response"]',
            '[class*="result"]'
        ];

        for (const selector of responseSelectors) {
            if (node.matches?.(selector) || node.querySelector?.(selector)) {
                console.log('[AI Panel] Perplexity detected new response...');
                waitForStreamingComplete();
                break;
            }
        }
    }

    async function waitForStreamingComplete() {
        if (isCapturing) {
            console.log('[AI Panel] Perplexity already capturing, skipping...');
            return;
        }

        isCapturing = true;
        let previousContent = '';
        let stableCount = 0;
        const maxWait = 600000; // 10 minutes
        const checkInterval = 500;
        const stableThreshold = 4; // 2 seconds of stable content
        const startTime = Date.now();

        try {
            while (Date.now() - startTime < maxWait) {
                if (!isContextValid()) {
                    console.log('[AI Panel] Context invalidated, stopping capture');
                    return;
                }

                await sleep(checkInterval);

                const currentContent = getLatestResponse() || '';

                if (currentContent === previousContent && currentContent.length > 0) {
                    stableCount++;

                    if (stableCount >= stableThreshold) {
                        if (currentContent !== lastCapturedContent) {
                            lastCapturedContent = currentContent;
                            safeSendMessage({
                                type: 'RESPONSE_CAPTURED',
                                aiType: AI_TYPE,
                                content: currentContent
                            });
                            console.log('[AI Panel] Perplexity response captured, length:', currentContent.length);
                        }
                        return;
                    }
                } else {
                    stableCount = 0;
                }

                previousContent = currentContent;
            }
        } finally {
            isCapturing = false;
        }
    }

    function getLatestResponse() {
        // Try multiple selectors for Perplexity's response area
        const selectors = [
            '[class*="answer-container"] [class*="prose"]',
            '[class*="prose"]',
            'div[class*="DefaultAnswer"]',
            'div[class*="answer"]',
            'main div[class*="col"] > div > div'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                // Get the last matching element (latest response)
                const lastElement = elements[elements.length - 1];
                const text = lastElement.innerText?.trim();
                if (text && text.length > 10) {
                    return text;
                }
            }
        }

        return null;
    }

    // Utility functions
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    console.log('[AI Panel] Perplexity content script loaded');
})();
