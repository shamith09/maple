// const API_URL = 'http://localhost:5000/api';
const API_URL = 'https://maple-production.up.railway.app/api';

// Listen for when the extension is installed
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Open onboarding page
        chrome.tabs.create({
            url: 'https://savewithmaple.vercel.app'
        });
    }
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
        const domain = new URL(tab.url).hostname;
        
        // Add domain to database
        try {
            await fetch(`${API_URL}/websites`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ domain })
            });
        } catch (error) {
            console.error('Error adding domain:', error);
        }

        // Inject the content script
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
        } catch (error) {
            console.error('Error injecting script:', error);
        }
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateBadge') {
        // Update the extension badge with number of coupons
        chrome.action.setBadgeText({
            text: request.count.toString(),
            tabId: sender.tab.id
        });
        chrome.action.setBadgeBackgroundColor({
            color: '#4CAF50',
            tabId: sender.tab.id
        });
    } else if (request.action === 'openPopup') {
        // Can't programmatically open popup, but we can focus the extension icon
        chrome.action.setBadgeText({
            text: '+',
            tabId: sender.tab.id
        });
        chrome.action.setBadgeBackgroundColor({
            color: '#4CAF50',
            tabId: sender.tab.id
        });
    }
}); 