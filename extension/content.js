const logger = {
    info: (msg, data = '') => console.log(`[CLOZFLOW][INFO] ${msg}`, data ? data : ''),
    success: (msg, data = '') => console.log(`[CLOZFLOW][SUCCESS] ${msg}`, data ? data : ''),
    warn: (msg, data = '') => console.warn(`[CLOZFLOW][WARN] ${msg}`, data ? data : ''),
    error: (msg, err = '') => console.error(`[CLOZFLOW][ERROR] ${msg}`, err ? err : '')
};

let currentSessionId = null;
let manualSessionId = null;
let sidebarIframe = null;
let sidebarContainer = null;
let platform = '';
let activeSessions = [];
let observer = null;
let lastMessage = '';
let activeChatName = null;
let chatChangeInterval = null;

function isContextValid() {
    return chrome.runtime && !!chrome.runtime.id;
}

function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('web.whatsapp.com')) return 'whatsapp';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('mail.google.com')) return 'gmail';
    if (host.includes('outlook.live.com') || host.includes('outlook.office.com')) return 'outlook';
    return '';
}

platform = detectPlatform();

// Listen for background updates
if (isContextValid()) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'sessionsUpdated') {
            activeSessions = request.sessions;
            checkAndInjectSidebar();
        }
    });
}

// Listen for UI events from sidebar iframe
window.addEventListener('message', (event) => {
    if (event.data.action === 'setSession') {
        currentSessionId = parseInt(event.data.sessionId, 10) || event.data.sessionId;
        manualSessionId = currentSessionId;
        logger.info("Manual session locked in UI", currentSessionId);
        updateCurrentSession(); 
    } 
    else if (event.data.action === 'COPY_TO_CLIPBOARD') {
        if (!isContextValid()) return;
        logger.info("Forwarding Copy request to background");
        chrome.runtime.sendMessage({ action: 'COPY_TO_CLIPBOARD', text: event.data.text }, (response) => {
            if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                    action: 'copyResult',
                    success: response && response.success
                }, '*');
            }
        });
    }
    else if (event.data.action === 'regenerateReply') {
        if (!isContextValid()) return;
        if (!currentSessionId) {
            logger.warn("Cannot regenerate: no active session");
            return;
        }
        logger.info("Forwarding Regenerate request to background");
        chrome.runtime.sendMessage({ action: 'regenerateReply', sessionId: currentSessionId }, (response) => {
            if (response && response.data && sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                    action: 'displayAnalysis',
                    data: response.data
                }, '*');
            } else if (response && response.error) {
                logger.error("Regenerate Failed", response.error);
                if (sidebarIframe) {
                    sidebarIframe.contentWindow.postMessage({ action: 'backendError' }, '*');
                }
            }
        });
    }
});

function checkAndInjectSidebar() {
    const hasMatchingSession = activeSessions.some(s => s.platform.toLowerCase() === platform);
    
    if (hasMatchingSession) {
        if (!sidebarContainer) {
            logger.info("Sidebar Injecting...");
            injectSidebar();
        }
        startMonitoring();
    } else {
        removeSidebar();
        stopMonitoring();
    }
    
    checkChatChange();
    updateCurrentSession();
}

function injectSidebar() {
    if (document.getElementById('clozflow-copilot-container')) return;
    
    sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'clozflow-copilot-container';
    
    if (!isContextValid()) return;
    
    chrome.storage.local.get(['clozflowSidebarPosition', 'clozflowSidebarSize'], (result) => {
        sidebarContainer.style.position = 'fixed';
        sidebarContainer.style.zIndex = '999999';
        sidebarContainer.style.backgroundColor = 'transparent';
        sidebarContainer.style.display = 'flex';
        sidebarContainer.style.flexDirection = 'column';
        sidebarContainer.style.borderRadius = '16px';
        sidebarContainer.style.overflow = 'hidden';
        sidebarContainer.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05)';
        sidebarContainer.style.resize = 'both';
        sidebarContainer.style.minWidth = '320px';
        sidebarContainer.style.minHeight = '400px';

        if (result.clozflowSidebarPosition) {
            sidebarContainer.style.top = result.clozflowSidebarPosition.top;
            sidebarContainer.style.left = result.clozflowSidebarPosition.left;
        } else {
            sidebarContainer.style.top = '20px';
            sidebarContainer.style.right = '20px';
        }
        
        if (result.clozflowSidebarSize) {
            sidebarContainer.style.width = result.clozflowSidebarSize.width;
            sidebarContainer.style.height = result.clozflowSidebarSize.height;
        } else {
            sidebarContainer.style.width = '350px';
            sidebarContainer.style.height = '600px';
        }
    });
    
    const header = document.createElement('div');
    header.style.padding = '14px 18px';
    header.style.background = 'rgba(255, 255, 255, 0.5)';
    header.style.backdropFilter = 'blur(30px)';
    header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.05)';
    header.style.color = '#0f172a';
    header.style.cursor = 'move';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.fontFamily = "'Plus Jakarta Sans', -apple-system, sans-serif";
    
    const title = document.createElement('div');
    title.style.fontSize = '11px';
    title.style.fontWeight = '800';
    title.style.letterSpacing = '0.18em';
    title.innerHTML = `<span style="color:#0f172a;">CLOZ</span><span style="color:#64748b;font-weight:400;">FLOW</span>`;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = '#64748b';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '0 4px';
    closeBtn.style.transition = 'color 0.2s';
    closeBtn.onmouseover = () => closeBtn.style.color = '#ef4444';
    closeBtn.onmouseout = () => closeBtn.style.color = '#64748b';
    closeBtn.onclick = removeSidebar;
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    sidebarIframe = document.createElement('iframe');
    sidebarIframe.id = 'clozflow-copilot-sidebar';
    sidebarIframe.src = chrome.runtime.getURL('sidebar.html');
    sidebarIframe.allow = 'clipboard-write';
    sidebarIframe.style.width = '100%';
    sidebarIframe.style.flex = '1';
    sidebarIframe.style.height = '100%';
    sidebarIframe.style.border = 'none';
    sidebarIframe.style.minHeight = '400px';
    
    sidebarContainer.appendChild(header);
    sidebarContainer.appendChild(sidebarIframe);
    document.body.appendChild(sidebarContainer);
    
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    
    header.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = sidebarContainer.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        sidebarIframe.style.pointerEvents = 'none';
    });
    
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        sidebarContainer.style.left = `${initialLeft + dx}px`;
        sidebarContainer.style.top = `${initialTop + dy}px`;
        sidebarContainer.style.right = 'auto';
    });
    
    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            sidebarIframe.style.pointerEvents = 'auto';
            if (isContextValid()) {
                chrome.storage.local.set({
                    clozflowSidebarPosition: { left: sidebarContainer.style.left, top: sidebarContainer.style.top }
                });
            }
        }
    });

    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (entry.target === sidebarContainer && isContextValid()) {
                chrome.storage.local.set({
                    clozflowSidebarSize: { width: entry.target.style.width, height: entry.target.style.height }
                });
            }
        }
    });
    resizeObserver.observe(sidebarContainer);
    logger.success("Sidebar Injected");
}

function removeSidebar() {
    if (sidebarContainer) {
        sidebarContainer.remove();
        sidebarContainer = null;
        sidebarIframe = null;
        logger.info("Sidebar Removed");
    }
}

function getCurrentChatName() {
    if (platform === 'whatsapp') {
        const header = document.querySelector('#main header');
        if (header) {
            const titleEl = header.querySelector('[title]');
            if (titleEl) return titleEl.getAttribute('title');
            
            const firstTextDiv = header.querySelector('div[dir="auto"]');
            if (firstTextDiv) return firstTextDiv.textContent;
        }
    }
    return null;
}

function checkChatChange() {
    const chatName = getCurrentChatName();
    if (chatName && chatName !== activeChatName) {
        logger.info("Chat Matched", chatName);
        activeChatName = chatName;
        manualSessionId = null;
        updateCurrentSession();
    } else if (!activeChatName && chatName !== activeChatName) {
        activeChatName = null;
        updateCurrentSession();
    }
}

function updateCurrentSession() {
    if (!activeSessions || !activeSessions.length) {
        if (sidebarIframe && sidebarIframe.contentWindow) {
            sidebarIframe.contentWindow.postMessage({ action: 'setActiveSession', session: null, allSessions: [] }, '*');
        }
        return;
    }
    
    const platformSessions = activeSessions.filter(s => s.platform.toLowerCase() === platform.toLowerCase());
    let matchedSession = null;
    
    if (manualSessionId) {
        matchedSession = platformSessions.find(s => s.session_id === manualSessionId);
    } 
    
    if (!matchedSession && activeChatName) {
        const activeDigits = activeChatName.replace(/\D/g, '');
        if (activeDigits.length >= 7) {
            matchedSession = platformSessions.find(s => {
                if (!s.phone_number) return false;
                const sessionDigits = s.phone_number.replace(/\D/g, '');
                if (sessionDigits.length < 7) return false;
                return activeDigits.endsWith(sessionDigits) || sessionDigits.endsWith(activeDigits);
            });
        }
    }
    
    if (matchedSession) {
        if (currentSessionId !== matchedSession.session_id) {
            logger.success("Session Found", matchedSession.session_id);
        }
        currentSessionId = matchedSession.session_id;
    } else {
        if (currentSessionId !== null && activeChatName) {
            logger.warn("Waiting For Correct Chat", activeChatName);
        }
        currentSessionId = null;
    }
    
    if (sidebarIframe && sidebarIframe.contentWindow) {
        sidebarIframe.contentWindow.postMessage({
            action: 'setActiveSession',
            session: matchedSession,
            allSessions: platformSessions
        }, '*');
    }
}

function startMonitoring() {
    if (observer) return;
    
    if (platform === 'whatsapp') {
        const chatContainer = document.querySelector('#main');
        if (chatContainer) {
            logger.info("Observer Started");
            observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.textContent) {
                            if (node.querySelector('.message-in')) {
                                logger.info("Message Node Found (Incoming)");
                                let msg = node.querySelector('.copyable-text span')?.textContent;
                                if (msg && msg !== lastMessage) {
                                    logger.info("Incoming Message Accepted:", msg);
                                    lastMessage = msg;
                                    analyzeMessage(msg);
                                }
                            } else if (node.querySelector('.message-out')) {
                                logger.info("Ignored Outgoing Message");
                            }
                        }
                    });
                });
            });
            observer.observe(chatContainer, { childList: true, subtree: true });
        }
    }
    
    if (!chatChangeInterval) {
        chatChangeInterval = setInterval(checkChatChange, 1000);
    }
}

function stopMonitoring() {
    if (observer) {
        observer.disconnect();
        observer = null;
        logger.info("Observer Stopped");
    }
    if (chatChangeInterval) {
        clearInterval(chatChangeInterval);
        chatChangeInterval = null;
    }
}

function analyzeMessage(msg) {
    if (!currentSessionId) {
        logger.warn("Waiting For Correct Chat. Cannot analyze message.");
        return; 
    }
    
    if (!isContextValid()) {
        logger.error("Extension context invalidated");
        return;
    }
    
    logger.info("Sending request", { msg, sessionId: currentSessionId });
    
    chrome.runtime.sendMessage({
        action: 'analyzeMessage',
        message: msg,
        platform: platform,
        sessionId: currentSessionId
    }, (response) => {
        if (response && response.data) {
            logger.success("Backend responded. Forwarding to sidebar.");
            if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({
                    action: 'displayAnalysis',
                    data: response.data
                }, '*');
            }
        } else if (response && response.error) {
            logger.error("Analysis Failed", response.error);
            if (sidebarIframe && sidebarIframe.contentWindow) {
                sidebarIframe.contentWindow.postMessage({ action: 'backendError' }, '*');
            }
        }
    });
}

if (isContextValid()) {
    chrome.runtime.sendMessage({ action: 'getActiveSessions' }, (response) => {
        if (response && response.sessions) {
            activeSessions = response.sessions;
            checkAndInjectSidebar();
        }
    });
}
