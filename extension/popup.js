document.addEventListener('DOMContentLoaded', () => {
    // Start polling immediately when the extension icon is clicked
    chrome.runtime.sendMessage({ action: 'startPolling' });

    chrome.runtime.sendMessage({ action: 'getToken' }, (response) => {
        if (response && response.token) {
            document.getElementById('token-input').value = response.token;
            updateStatus(true);
        } else {
            updateStatus(false);
        }
    });

    chrome.runtime.sendMessage({ action: 'getActiveSessions' }, (response) => {
        if (response && response.sessions && response.sessions.length > 0) {
            document.getElementById('session-info').classList.remove('hidden');
            const detailsEl = document.getElementById('session-details');
            detailsEl.innerHTML = ''; // Clear existing
            response.sessions.forEach(session => {
                const div = document.createElement('div');
                div.textContent = `${session.platform} - ${session.business_name || 'Session ' + session.session_id}`;
                detailsEl.appendChild(div);
            });
        }
    });

    document.getElementById('save-token-btn').addEventListener('click', () => {
        const token = document.getElementById('token-input').value.trim();
        if (token) {
            chrome.runtime.sendMessage({ action: 'setToken', token: token }, (res) => {
                if (res.success) {
                    updateStatus(true);
                }
            });
        }
    });
    
    const devModeToggle = document.getElementById('dev-mode-toggle');
    const devModePanel = document.getElementById('dev-mode-panel');
    
    devModeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            devModePanel.classList.remove('hidden');
        } else {
            devModePanel.classList.add('hidden');
        }
    });

    document.getElementById('start-test-session-btn').addEventListener('click', async () => {
        const token = document.getElementById('token-input').value.trim();
        const contactName = document.getElementById('test-contact-name').value.trim();
        const phoneNumber = document.getElementById('test-contact-phone').value.trim();
        const platform = document.getElementById('test-contact-platform').value;

        if (!token) return alert('Please authenticate and sync extension first!');
        if (!contactName || !phoneNumber) return alert('Please enter contact name and phone number.');

        const btn = document.getElementById('start-test-session-btn');
        btn.textContent = 'Starting...';

        try {
            const res = await fetch('http://localhost:8000/api/copilot/session/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    contact_name: contactName,
                    phone_number: phoneNumber,
                    platform: platform
                })
            });

            if (res.ok) {
                btn.textContent = 'Session Created! ✓';
                // Trigger background to fetch new sessions immediately
                chrome.runtime.sendMessage({ action: 'regenAndFetchSessions' }); // Fake action just to wake it up or we let poll do it
                setTimeout(() => {
                    btn.textContent = 'Force Start Test Session';
                }, 3000);
            } else {
                const data = await res.json();
                alert(data.detail || 'Failed to start session');
                btn.textContent = 'Force Start Test Session';
            }
        } catch (e) {
            alert('Error: ' + e.message);
            btn.textContent = 'Force Start Test Session';
        }
    });

    document.getElementById('dashboard-btn').addEventListener('click', () => {
        window.open('http://localhost:5173/dashboard', '_blank');
    });
});

function updateStatus(connected) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    
    if (connected) {
        dot.className = 'status-dot green';
        text.textContent = 'Connected & Authenticated';
    } else {
        dot.className = 'status-dot red';
        text.textContent = 'Not Authenticated';
    }
}
