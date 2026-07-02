const logger = {
    info: (msg, data = '') => console.log(`[CLOZFLOW][INFO] ${msg}`, data ? data : ''),
    success: (msg, data = '') => console.log(`[CLOZFLOW][SUCCESS] ${msg}`, data ? data : ''),
    warn: (msg, data = '') => console.warn(`[CLOZFLOW][WARN] ${msg}`, data ? data : ''),
    error: (msg, err = '') => console.error(`[CLOZFLOW][ERROR] ${msg}`, err ? err : '')
};

logger.info("Sidebar Loaded");

let currentSidebarSessionId = null;

window.addEventListener('message', (event) => {
    if (event.data.action === 'displayAnalysis') {
        logger.info("Updating Sidebar with Analysis");
        const data = event.data.data;
        
        document.getElementById('suggested-reply').textContent = data.suggested_reply || "No suggestion";
        document.getElementById('why-text').textContent = data.why || "-";
        
        if (data.updated_stage) {
            document.getElementById('stage-text').textContent = data.updated_stage.replace('_', ' ').toUpperCase();
        }
        
        if (data.hidden_concern) {
            document.getElementById('hidden-concern').textContent = data.hidden_concern;
        }
        
        if (data.updated_buying_intent !== undefined) {
            document.getElementById('buying-intent').style.width = `${data.updated_buying_intent}%`;
        }
        
        if (data.updated_trust_score !== undefined) {
            document.getElementById('trust-score').style.width = `${data.updated_trust_score}%`;
        }
        
        logger.success("Sidebar Updated");
    } else if (event.data.action === 'setActiveSession') {
        const session = event.data.session;
        const allSessions = event.data.allSessions || [];
        
        const selector = document.getElementById('session-selector');
        selector.innerHTML = '';
        
        if (allSessions.length === 0) {
            selector.innerHTML = '<option value="">Waiting For Session...</option>';
        } else {
            allSessions.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.session_id;
                opt.textContent = s.business_name || `Session ${s.session_id}`;
                selector.appendChild(opt);
            });
        }

        if (session) {
            selector.value = session.session_id;
            document.getElementById('platform-badge').textContent = session.platform;
            document.querySelector('.status-dot').className = 'status-dot green';
            
            // Only reset the text if we actually switched to a DIFFERENT session
            if (currentSidebarSessionId !== session.session_id) {
                document.getElementById('suggested-reply').textContent = "Ready. Waiting For Message...";
                currentSidebarSessionId = session.session_id;
            }
        } else {
            currentSidebarSessionId = null;
            document.getElementById('platform-badge').textContent = '';
            document.querySelector('.status-dot').className = 'status-dot red';
            
            // Clear out some info
            document.getElementById('suggested-reply').textContent = "Waiting For Chat...";
            document.getElementById('why-text').textContent = "-";
            document.getElementById('stage-text').textContent = "Discovery";
            document.getElementById('hidden-concern').textContent = "-";
            document.getElementById('buying-intent').style.width = `0%`;
            document.getElementById('trust-score').style.width = `0%`;
        }
    } else if (event.data.action === 'copyResult') {
        const btn = document.getElementById('copy-btn');
        if (event.data.success) {
            logger.success("Copy Success");
            btn.textContent = 'Copied ✓';
        } else {
            logger.error("Copy Failed");
            btn.textContent = 'Unable to copy';
            alert('Unable to copy. Please copy manually.');
        }
        setTimeout(() => btn.textContent = 'Copy Reply', 2000);
    } else if (event.data.action === 'backendError') {
        document.getElementById('suggested-reply').textContent = "Backend Offline / Error";
        logger.error("Backend Error Received in Sidebar");
    }
});

document.getElementById('session-selector').addEventListener('change', (e) => {
    const sessionId = e.target.value;
    if (sessionId) {
        logger.info("Session manually selected", sessionId);
        parent.postMessage({ action: 'setSession', sessionId: sessionId }, '*');
    }
});

document.getElementById('copy-btn').addEventListener('click', () => {
    const text = document.getElementById('suggested-reply').textContent;
    const btn = document.getElementById('copy-btn');
    
    logger.info("Copy requested by UI");
    btn.textContent = 'Loading...';
    
    // Send message to parent (content script) for copying
    parent.postMessage({ action: 'COPY_TO_CLIPBOARD', text: text }, '*');
});

document.getElementById('regenerate-btn').addEventListener('click', () => {
    logger.info("Regenerate Requested");
    parent.postMessage({ action: 'regenerateReply' }, '*');
});
