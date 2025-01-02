// const API_URL = 'http://localhost:5000/api';
const API_URL = 'https://maple-production.up.railway.app/api';

async function getUserId() {
    try {
        const { userId } = await chrome.storage.local.get('userId');
        if (userId) return userId;

        // If no user ID exists, get one from the server
        const response = await fetch(`${API_URL}/user-id`);
        const data = await response.json();
        
        // Store the new user ID
        await chrome.storage.local.set({ userId: data.user_id });
        return data.user_id;
    } catch (error) {
        console.error('Error getting user ID:', error);
        return null;
    }
}

async function makeApiRequest(url, options = {}) {
    const userId = await getUserId();
    if (!userId) {
        throw new Error('Failed to get user ID');
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        ...options.headers
    };

    return fetch(url, { ...options, headers });
}

function validateDiscount(amount, type) {
    if (!amount) return true;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return false;
    return type === 'percent' ? (numAmount > 0 && numAmount <= 100) : numAmount > 0;
}

function getDiscountError(amount, type) {
    if (!amount) return null;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return 'Invalid discount amount';
    if (type === 'percent' && (numAmount <= 0 || numAmount > 100)) {
        return 'Percentage discount must be between 0 and 100';
    } else if (!type === 'percent' && numAmount <= 0) {
        return 'Dollar discount must be greater than 0';
    }
    return null;
}

function formatDiscount(amount, type) {
    if (!amount) return '';
    return type === 'percent' ? `${amount}%` : `$${amount.toFixed(2)}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    // Make sure we have a user ID before proceeding
    const userId = await getUserId();
    if (!userId) {
        document.body.innerHTML = '<div class="error">Failed to initialize extension. Please try again.</div>';
        return;
    }

    // Auto-fill domain from current tab for both add and search inputs
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.url) {
            const domain = new URL(tab.url).hostname;
            document.getElementById('domain-input').value = domain;
            document.getElementById('search-domain').value = domain;
        }
    });

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and contents
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');

            // If denylist tab is selected, load the denylisted sites
            if (tab.dataset.tab === 'denylist') {
                loadDenylist();
            }
        });
    });

    // Add code functionality
    const addButton = document.getElementById('add-code');
    const status = document.querySelector('#add-tab .status');

    addButton.addEventListener('click', async () => {
        const domain = document.getElementById('domain-input').value.trim();
        const code = document.getElementById('code-input').value.trim();
        const discount = document.getElementById('discount-input').value.trim();
        const discountType = document.getElementById('discount-type').value;

        if (!domain || !code) {
            status.className = 'status error';
            status.textContent = 'Please enter both domain and code';
            return;
        }

        const discountError = getDiscountError(discount, discountType);
        if (discountError) {
            status.className = 'status error';
            status.textContent = discountError;
            return;
        }

        try {
            addButton.disabled = true;
            status.className = 'status';
            status.textContent = 'Adding coupon code...';

            const response = await makeApiRequest(`${API_URL}/coupons`, {
                method: 'POST',
                body: JSON.stringify({
                    code,
                    domain,
                    discount_amount: discount || null,
                    discount_type: discountType
                })
            });

            if (response.ok) {
                status.className = 'status success';
                status.textContent = 'Coupon code added successfully!';
                document.getElementById('code-input').value = '';
                document.getElementById('discount-input').value = '';
            } else {
                const data = await response.json();
                status.className = 'status error';
                status.textContent = data.error || 'Failed to add coupon code';
            }
        } catch (error) {
            status.className = 'status error';
            status.textContent = 'Failed to add coupon code';
        } finally {
            addButton.disabled = false;
        }
    });

    // Search functionality
    const searchButton = document.getElementById('search-codes');
    const currentSiteButton = document.getElementById('current-site');
    const searchDomainInput = document.getElementById('search-domain');
    const codesList = document.querySelector('.codes-list');

    async function searchCodes(domain) {
        if (!domain) {
            codesList.innerHTML = '<div class="code-item">Please enter a domain to search</div>';
            return;
        }

        try {
            searchButton.disabled = true;
            if (currentSiteButton) currentSiteButton.disabled = true;
            codesList.innerHTML = '<div class="code-item">Searching...</div>';

            const response = await makeApiRequest(`${API_URL}/coupons/${domain}`);
            const data = await response.json();

            if (response.ok && data.coupons?.length > 0) {
                codesList.innerHTML = data.coupons.map(coupon => `
                    <div class="code-item">
                        <span class="code">${coupon.code}</span>
                        <span class="discount">${formatDiscount(coupon.discount_amount, coupon.discount_type)}</span>
                    </div>
                `).join('');
            } else {
                codesList.innerHTML = '<div class="code-item">No coupons found for this domain</div>';
            }
        } catch (error) {
            codesList.innerHTML = '<div class="code-item">Failed to fetch coupons</div>';
        } finally {
            searchButton.disabled = false;
            if (currentSiteButton) currentSiteButton.disabled = false;
        }
    }

    searchButton.addEventListener('click', () => {
        searchCodes(searchDomainInput.value.trim());
    });

    currentSiteButton.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
            const domain = new URL(tab.url).hostname;
            searchDomainInput.value = domain;
            searchCodes(domain);
        }
    });

    async function loadDenylist() {
        const denylistContainer = document.querySelector('.denylist-sites');
        const { disabledSites = {} } = await chrome.storage.local.get('disabledSites');
        
        if (Object.keys(disabledSites).length === 0) {
            denylistContainer.innerHTML = '<div class="empty-denylist">No sites in denylist</div>';
            return;
        }

        const sitesHtml = Object.keys(disabledSites)
            .filter(site => disabledSites[site])
            .map(site => `
                <div class="denylist-item">
                    <span>${site}</span>
                    <button class="remove-site" data-site="${site}">Enable</button>
                </div>
            `).join('');

        denylistContainer.innerHTML = sitesHtml;

        // Add click handlers for enable buttons
        document.querySelectorAll('.remove-site').forEach(button => {
            button.addEventListener('click', async () => {
                const site = button.dataset.site;
                const { disabledSites } = await chrome.storage.local.get('disabledSites');
                delete disabledSites[site];
                await chrome.storage.local.set({ disabledSites });
                loadDenylist(); // Refresh the list
            });
        });
    }

    // Load denylist if it's the active tab
    if (document.querySelector('.tab[data-tab="denylist"]').classList.contains('active')) {
        loadDenylist();
    }
}); 