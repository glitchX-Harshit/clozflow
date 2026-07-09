const logger = {
    info: (msg, data = '') => console.log(`[CLOZFLOW][INFO] ${msg}`, data ? data : ''),
    success: (msg, data = '') => console.log(`[CLOZFLOW][SUCCESS] ${msg}`, data ? data : ''),
    warn: (msg, data = '') => console.warn(`[CLOZFLOW][WARN] ${msg}`, data ? data : ''),
    error: (msg, err = '') => console.error(`[CLOZFLOW][ERROR] ${msg}`, err ? err : '')
};

let token = null;
let activeSessions = [];
let pollingInterval = null;

// Initialize
chrome.storage.local.get(['token'], (result) => {
    if (result.token) {
        logger.info("Token Loaded", "Validating...");
        token = result.token;
        startSessionPolling();
    }
});

async function customFetch(endpoint, options = {}) {
    const start = Date.now();
    logger.info(`Request: ${options.method || 'GET'} ${endpoint}`);
    
    try {
        const response = await fetch(endpoint, options);
        const latency = Date.now() - start;
        
        logger.info(`Response Status: ${response.status} | Latency: ${latency}ms for ${endpoint}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Fetch Failed (${response.status})`, errorText);
            throw new Error(`Status ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        logger.error("Failed To Reach Backend", error.message);
        throw error;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // We must return true if we want to sendResponse asynchronously
    
    if (request.action === 'setToken') {
        token = request.token;
        chrome.storage.local.set({ token });
        logger.success("Token Saved and Loaded");
        startSessionPolling();
        sendResponse({ success: true });
        return false;
    }
    
    if (request.action === 'getToken') {
        sendResponse({ token });
        return false;
    }
    
    if (request.action === 'analyzeMessage') {
        if (!token || !request.sessionId) {
            logger.warn("Analyze request rejected: No token or sessionId");
            sendResponse({ error: 'No active session or token' });
            return false;
        }
        
        logger.info("Sending To Backend for Analysis");
        
        customFetch(`http://localhost:8000/api/copilot/session/${request.sessionId}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                incoming_message: request.message,
                platform: request.platform
            })
        })
        .then(data => {
            logger.success("Backend Response Received");
            sendResponse({ data });
        })
        .catch(err => {
            sendResponse({ error: err.message });
        });
        
        return true; 
    }
    
    if (request.action === 'regenerateReply') {
        if (!token || !request.sessionId) {
            sendResponse({ error: 'No active session or token' });
            return false;
        }
        
        logger.info("Regenerate requested by UI");
        
        customFetch(`http://localhost:8000/api/copilot/session/${request.sessionId}/regenerate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(data => {
            logger.success("Regenerate Response Received");
            sendResponse({ data });
        })
        .catch(err => {
            sendResponse({ error: err.message });
        });
        
        return true;
    }
    
    if (request.action === 'getActiveSessions') {
        sendResponse({ sessions: activeSessions });
        return false;
    }
    
    if (request.action === 'COPY_TO_CLIPBOARD') {
        const textToCopy = request.text;
        
        if (sender && sender.tab && sender.tab.id) {
            logger.info("Executing background clipboard copy script in tab", sender.tab.id);
            chrome.scripting.executeScript({
                target: { tabId: sender.tab.id },
                func: (text) => {
                    return new Promise((resolve) => {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text)
                                .then(() => resolve(true))
                                .catch(() => resolve(false));
                        } else {
                            resolve(false);
                        }
                    }).then((success) => {
                        if (!success) {
                            // Fallback
                            try {
                                const textarea = document.createElement('textarea');
                                textarea.value = text;
                                textarea.style.position = 'fixed';
                                textarea.style.left = '-9999px';
                                textarea.style.top = '-9999px';
                                document.body.appendChild(textarea);
                                textarea.select();
                                const result = document.execCommand('copy');
                                document.body.removeChild(textarea);
                                return result;
                            } catch (e) {
                                return false;
                            }
                        }
                        return true;
                    });
                },
                args: [textToCopy]
            }, (results) => {
                if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                    logger.error("Copy operation failed via tab injection");
                    sendResponse({ success: false });
                } else {
                    logger.success("Copy operation succeeded");
                    sendResponse({ success: true });
                }
            });
            return true;
        } else {
            logger.error("No valid tab to inject copy script");
            sendResponse({ success: false });
        }
    }
    
    if (request.action === 'stopPolling') {
        stopSessionPolling();
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'startPolling') {
        startSessionPolling();
        sendResponse({ success: true });
        return false;
    }
});

function pollActiveSessions() {
    if (!token) return;
    
    customFetch('http://localhost:8000/api/copilot/sessions/active', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(sessions => {
        activeSessions = sessions || [];
        
        chrome.tabs.query({}, (tabs) => {
            for (let tab of tabs) {
                // Only broadcast to matching platforms
                const url = tab.url || '';
                if (url.includes('web.whatsapp.com') || 
                    url.includes('linkedin.com') || 
                    url.includes('mail.google.com') || 
                    url.includes('outlook.live.com') || 
                    url.includes('outlook.office.com')) {
                    
                    try {
                        chrome.tabs.sendMessage(tab.id, { 
                            action: 'sessionsUpdated', 
                            sessions: activeSessions 
                        }).catch(() => {}); // gracefully ignore context invalidated errors
                    } catch(e) {
                        // ignore errors sending to inactive tabs
                    }
                }
            }
        });
    })
    .catch(err => {
        logger.error("Session Polling Failed", err.message);
    });
}

function startSessionPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollActiveSessions(); // Initial poll
    pollingInterval = setInterval(pollActiveSessions, 5000);
    logger.info("Session Polling Started");
}

function stopSessionPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    logger.info("Session Polling Stopped");
    // Also notify tabs to hide copilot since polling stopped
    chrome.tabs.query({}, (tabs) => {
        for (let tab of tabs) {
            try {
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'sessionsUpdated', 
                    sessions: [] 
                }).catch(() => {});
            } catch(e) {}
        }
    });
}
