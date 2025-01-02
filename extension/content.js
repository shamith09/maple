// const API_URL = 'http://localhost:5000/api';
const API_URL = "https://maple-production.up.railway.app/api";

// Cache for API responses
let couponCache = new Map();
let isCheckingPromoField = false;
let hasShownPopup = false;
let checkTimeout = null;

// Debounce function to prevent multiple rapid checks
function debounce(func, wait) {
  return function executedFunction(...args) {
    const later = () => {
      checkTimeout = null;
      if (!hasShownPopup) {
        func(...args);
      }
    };
    clearTimeout(checkTimeout);
    checkTimeout = setTimeout(later, wait);
  };
}

const PROMO_KEYWORDS = [
  "promo",
  "coupon",
  "discount",
  "voucher",
  "gift",
  "offer",
  "redeem",
  "promotion",
  "rewards",
  "redemption",
  "claim",
  "code",
];

const EXCLUDE_KEYWORDS = [
  "postal",
  "zip",
  "postcode",
  "post code",
  "zipcode",
  "address",
  "shipping",
  "billing",
  "mail",
  "security",
];

const CHECKOUT_KEYWORDS = [
  "payment",
  "checkout",
  "order",
  "shipping",
  "billing",
  "cart",
  "purchase",
  "total",
  "subtotal",
  "pay now",
];

function isCheckoutPage() {
  const pageText = document.body.innerText.toLowerCase();
  const url = window.location.href.toLowerCase();

  // Check URL for checkout indicators
  const urlHasCheckout = CHECKOUT_KEYWORDS.some((keyword) =>
    url.includes(keyword)
  );

  // Count checkout keywords in page text
  const checkoutKeywordsFound = CHECKOUT_KEYWORDS.filter((keyword) =>
    pageText.includes(keyword)
  ).length;

  // Look for price patterns
  const hasPricePattern = /\$\d+\.\d{2}/.test(pageText);

  // Return true if we have strong signals this is a checkout page
  return (
    (urlHasCheckout && checkoutKeywordsFound >= 1) ||
    (hasPricePattern && checkoutKeywordsFound >= 2)
  );
}

async function findPromoInputField() {
  // First check if we're on a checkout page
  if (!isCheckoutPage()) {
    return null;
  }

  // First try the attribute-based approach
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([hidden])'
  );
  for (const input of inputs) {
    // Skip invisible inputs
    const style = window.getComputedStyle(input);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      continue;
    }

    // Skip submit, button, checkbox types
    const inputType = input.type?.toLowerCase() || "";
    if (
      [
        "submit",
        "button",
        "checkbox",
        "radio",
        "file",
        "email",
        "tel",
        "password",
      ].includes(inputType)
    ) {
      continue;
    }

    // Get all attributes and surrounding text
    const attributes = Array.from(input.attributes).map((attr) =>
      attr.value.toLowerCase()
    );
    const surroundingText = [
      input.parentElement?.textContent,
      input.previousElementSibling?.textContent,
      input.nextElementSibling?.textContent,
      input.placeholder,
      input.name,
      input.id,
      ...attributes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // First check if this looks like a postal/zip code field
    if (EXCLUDE_KEYWORDS.some((keyword) => surroundingText.includes(keyword))) {
      continue;
    }

    // If no strong indicators, check for multiple weaker indicators
    const promoMatches = PROMO_KEYWORDS.filter((keyword) =>
      surroundingText.includes(keyword)
    ).length;

    console.log(surroundingText, input);

    // Require at least 1 matching keyword for weaker matches
    if (promoMatches >= 1) {
      return input;
    }
  }

  return null;
}

async function findApplyButton(promoInput) {
  const possibleButtons = [
    "button",
    'input[type="submit"]',
    'input[type="button"]',
    "a",
    'span[role="button"]', // Some sites use spans as buttons
    'div[role="button"]', // Some sites use divs as buttons
  ];

  // Get all potential apply buttons
  const buttons = Array.from(
    document.querySelectorAll(possibleButtons.join(","))
  ).filter((element) => {
    const text = (element.textContent || element.value || "")
      .toLowerCase()
      .trim();
    // More specific matching to avoid "apply coupons" type buttons
    // Also look for common variations of apply/add/submit
    return (
      text === "apply" ||
      text === "add" ||
      text === "submit" ||
      text === "ok" ||
      text === "apply code" ||
      text === "apply coupon" ||
      text === "add code" ||
      text === "add coupon" ||
      text === "submit code" ||
      text === "redeem"
    );
  });

  // First try to find buttons that are siblings or near relatives of the input
  const nearbyButton = buttons.find((button) => {
    // Check if button is a direct sibling
    if (
      button.previousElementSibling === promoInput ||
      button.nextElementSibling === promoInput
    ) {
      return true;
    }

    // Check if button is in the same parent
    if (button.parentElement === promoInput.parentElement) {
      return true;
    }

    // Check if button is in a common wrapper (like a form)
    if (button.closest("form") === promoInput.closest("form")) {
      // Get button's position relative to input
      const buttonRect = button.getBoundingClientRect();
      const inputRect = promoInput.getBoundingClientRect();

      // Button should be very close horizontally and roughly aligned vertically
      const horizontalDistance = Math.abs(buttonRect.left - inputRect.right);
      const verticalDistance = Math.abs(buttonRect.top - inputRect.top);

      // Button should be within 100px horizontally and 20px vertically
      return horizontalDistance < 100 && verticalDistance < 20;
    }

    return false;
  });

  if (nearbyButton) return nearbyButton;

  // If no nearby button found, try to find one by aria-label or other attributes
  const buttonByAttribute = buttons.find((button) => {
    const ariaLabel = button.getAttribute("aria-label")?.toLowerCase() || "";
    const dataAction = button.getAttribute("data-action")?.toLowerCase() || "";
    const dataTestId = button.getAttribute("data-testid")?.toLowerCase() || "";

    return (
      ariaLabel.includes("apply") ||
      ariaLabel.includes("add") ||
      ariaLabel.includes("submit") ||
      dataAction.includes("apply") ||
      dataAction.includes("add") ||
      dataTestId.includes("apply") ||
      dataTestId.includes("add")
    );
  });

  if (buttonByAttribute) return buttonByAttribute;

  // Last resort: find closest button by distance, but only if it's reasonably close
  const closestButton = buttons.reduce((closest, button) => {
    const distance = getDistance(promoInput, button);
    if (distance > 150) return closest; // Don't consider buttons too far away
    return !closest || distance < closest.distance
      ? { element: button, distance }
      : closest;
  }, null)?.element;

  return closestButton;
}

function getDistance(element1, element2) {
  const rect1 = element1.getBoundingClientRect();
  const rect2 = element2.getBoundingClientRect();
  return Math.hypot(rect1.left - rect2.left, rect1.top - rect2.top);
}

async function testCoupon(code, promoInput, applyButton) {
  try {
    // First check if there's a remove button and click it to ensure clean state
    const existingRemoveButtons = Array.from(
      document.querySelectorAll(
        'button, a, input[type="button"], input[type="submit"]'
      )
    ).filter((element) => {
      const text = (element.textContent || element.value || "").toLowerCase();
      return (
        text.includes("remove") ||
        text.includes("delete") ||
        text.includes("clear")
      );
    });

    if (existingRemoveButtons.length > 0) {
      existingRemoveButtons[0].click();
      // Wait for price to reset after removing
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // Get initial total before applying code
    const initialTotal = document.body.innerText.match(/\$\d+\.\d{2}/);
    const initialAmount = initialTotal
      ? parseFloat(initialTotal[0].replace("$", ""))
      : null;

    // Now apply the new code
    promoInput.value = code;
    promoInput.dispatchEvent(new Event("input", { bubbles: true }));
    promoInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Make sure we have a valid apply button
    let currentApplyButton = applyButton;
    if (!currentApplyButton || !document.body.contains(currentApplyButton)) {
      // Try to find the apply button again if the original one is no longer valid
      currentApplyButton = await findApplyButton(promoInput);
    }

    if (!currentApplyButton) {
      console.error("Could not find apply button after entering code");
      return { total: null, wasAttempted: false };
    }

    currentApplyButton.click();

    return new Promise((resolve) => {
      setTimeout(async () => {
        const currentTotal = document.body.innerText.match(/\$\d+\.\d{2}/);
        const finalAmount = currentTotal
          ? parseFloat(currentTotal[0].replace("$", ""))
          : null;
        const worked =
          finalAmount && initialAmount && finalAmount < initialAmount;

        // If the code worked, track the savings
        if (worked) {
          try {
            await makeApiRequest(`${API_URL}/analytics/savings`, {
              method: "POST",
              body: JSON.stringify({
                amount_saved: initialAmount - finalAmount,
              }),
            });
          } catch (error) {
            console.error("Error tracking savings:", error);
          }
        }

        resolve({
          total: finalAmount,
          wasAttempted: true,
        });
      }, 2000);
    });
  } catch (error) {
    console.error("Error testing coupon:", error);
    return { total: null, wasAttempted: false };
  }
}

async function getUserId() {
  try {
    const { userId } = await chrome.storage.local.get("userId");
    if (userId) return userId;

    // If no user ID exists, get one from the server
    const response = await fetch(`${API_URL}/user-id`);
    const data = await response.json();

    // Store the new user ID
    await chrome.storage.local.set({ userId: data.user_id });
    return data.user_id;
  } catch (error) {
    console.error("Error getting user ID:", error);
    return null;
  }
}

async function makeApiRequest(url, options = {}) {
  const userId = await getUserId();
  if (!userId) {
    throw new Error("Failed to get user ID");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-User-ID": userId,
    ...options.headers,
  };

  return fetch(url, { ...options, headers });
}

async function updateCouponTTL(couponId, worked, actualTotal, initialTotal) {
  try {
    const data = {
      id: couponId,
      worked,
    };

    // Calculate actual discount percentage if we have both totals
    if (worked && actualTotal && initialTotal) {
      const actualDiscountPercent =
        ((initialTotal - actualTotal) / initialTotal) * 100;
      data.actual_discount = actualDiscountPercent;
    }

    await makeApiRequest(`${API_URL}/coupons/${window.location.hostname}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  } catch (error) {
    console.error("Error updating coupon:", error);
  }
}

async function findBestCoupon() {
  const domain = window.location.hostname;
  const response = await makeApiRequest(`${API_URL}/coupons/${domain}`);
  const data = await response.json();

  const promoInput = await findPromoInputField();
  if (!promoInput) return null;

  const applyButton = await findApplyButton(promoInput);
  if (!applyButton) return null;

  console.log(promoInput, applyButton);

  let bestDiscount = null;
  let bestCode = null;
  let initialTotal = null;
  let lastTestedCode = null;

  // Get initial total before testing any codes
  const initialResult = await testCoupon("", promoInput, applyButton);
  initialTotal = initialResult.total;
  if (!initialTotal) return null;

  for (const coupon of data.coupons) {
    const result = await testCoupon(coupon.code, promoInput, applyButton);
    lastTestedCode = coupon.code;

    // Only update TTL if we actually attempted the code
    if (result.wasAttempted) {
      const worked = result.total && result.total < initialTotal;
      await updateCouponTTL(coupon.id, worked, result.total, initialTotal);

      if (worked && (!bestCode || result.total < bestDiscount)) {
        bestDiscount = result.total;
        bestCode = coupon.code;
      }
    }
  }

  // If we found a working code and it's not already applied (wasn't the last one tested)
  if (bestCode && bestCode !== lastTestedCode) {
    // Clear any existing code first
    const existingRemoveButtons = Array.from(
      document.querySelectorAll(
        'button, a, input[type="button"], input[type="submit"]'
      )
    ).filter((element) => {
      const text = (element.textContent || element.value || "").toLowerCase();
      return (
        text.includes("remove") ||
        text.includes("delete") ||
        text.includes("clear")
      );
    });

    if (existingRemoveButtons.length > 0) {
      existingRemoveButtons[0].click();
      // Wait for price to reset
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // Apply the best code
    promoInput.value = bestCode;
    promoInput.dispatchEvent(new Event("input", { bubbles: true }));
    promoInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Make sure we have a valid apply button
    let currentApplyButton = applyButton;
    if (!currentApplyButton || !document.body.contains(currentApplyButton)) {
      // Try to find the apply button again if the original one is no longer valid
      currentApplyButton = await findApplyButton(promoInput);
    }

    if (!currentApplyButton) {
      console.error("Could not find apply button when reapplying best code");
      return null;
    }

    currentApplyButton.click();

    // Wait for the final price update
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (bestCode) {
    return {
      code: bestCode,
      discount: initialTotal - bestDiscount,
    };
  }

  return null;
}

function formatDiscount(amount, type) {
  if (!amount) return "";
  return type === "percent" ? `${amount}%` : `$${amount.toFixed(2)}`;
}

function createNotification(numCoupons, coupons) {
  // Remove any existing popups
  const existingPopup = document.getElementById("maple-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // Get max discount info
  let maxDollarDiscount = 0;
  let maxPercentDiscount = 0;
  if (coupons) {
    coupons.forEach((coupon) => {
      if (coupon.discount_amount) {
        if (coupon.discount_type === "percent") {
          maxPercentDiscount = Math.max(
            maxPercentDiscount,
            coupon.discount_amount
          );
        } else {
          maxDollarDiscount = Math.max(
            maxDollarDiscount,
            coupon.discount_amount
          );
        }
      }
    });
  }

  // Create discount message
  let discountMessage = "";
  if (maxDollarDiscount > 0 && maxPercentDiscount > 0) {
    discountMessage = ` with up to $${maxDollarDiscount.toFixed(
      2
    )} or ${maxPercentDiscount}% in savings`;
  } else if (maxDollarDiscount > 0) {
    discountMessage = ` with up to $${maxDollarDiscount.toFixed(2)} in savings`;
  } else if (maxPercentDiscount > 0) {
    discountMessage = ` with up to ${maxPercentDiscount}% in savings`;
  }

  // Create popup container
  const popup = document.createElement("div");
  popup.id = "maple-popup";

  // Get extension URL for image
  const imageURL = chrome.runtime.getURL("images/maple.png");

  // Add styles
  popup.innerHTML = `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Bagel+Fat+One&family=Cookie&display=swap');
            
            #maple-popup * {
                font-family: 'Montserrat', sans-serif !important;
            }
            
            #maple-popup h3 {
                margin: 0 !important;
                color: #b24303 !important;
                font-size: 16px !important;
                font-weight: normal !important;
                font-family: 'Bagel Fat One', cursive !important;
            }

            #maple-popup .bmc-button {
                background: #b24303 !important;
                font-family: 'Cookie', cursive !important;
                font-size: 28px !important;
                line-height: 35px !important;
                padding: 5px 20px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                width: auto !important;
                min-width: 200px !important;
                height: 42px !important;
                border-radius: 21px !important;
            }
            
            #maple-popup {
                position: fixed !important;
                top: 20px !important;
                right: 20px !important;
                background: white !important;
                padding: 20px !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 12px rgba(178, 67, 3, 0.15) !important;
                z-index: 2147483647 !important;
                width: 300px !important;
                font-family: 'Montserrat', sans-serif !important;
                border: 1px solid #e8c4b0 !important;
                animation: slideIn 0.3s ease-out !important;
                font-size: 14px !important;
                line-height: 1.5 !important;
                color: #8c3502 !important;
            }
            @keyframes slideIn {
                from {
                    transform: translateX(100%) !important;
                    opacity: 0 !important;
                }
                to {
                    transform: translateX(0) !important;
                    opacity: 1 !important;
                }
            }
            #maple-popup .header {
                display: flex !important;
                align-items: center !important;
                margin-bottom: 15px !important;
            }
            #maple-popup .logo {
                width: 24px !important;
                height: 24px !important;
                margin-right: 10px !important;
            }
            #maple-popup h3 {
                margin: 0 !important;
                color: #b24303 !important;
                font-size: 16px !important;
                font-weight: 600 !important;
            }
            #maple-popup p {
                font-size: 14px !important;
                line-height: 1.5 !important;
                color: #8c3502 !important;
                margin: 0 0 15px 0 !important;
                font-weight: 400 !important;
            }
            #maple-popup input {
                width: 100% !important;
                padding: 8px !important;
                margin: 10px 0 !important;
                border: 1px solid #e8c4b0 !important;
                border-radius: 4px !important;
                box-sizing: border-box !important;
                font-size: 14px !important;
                font-family: 'Montserrat', sans-serif !important;
                color: #8c3502 !important;
                background: white !important;
            }
            #maple-popup input:focus {
                outline: none !important;
                border-color: #b24303 !important;
                box-shadow: 0 0 0 2px rgba(178, 67, 3, 0.1) !important;
            }
            #maple-popup .buttons {
                display: flex !important;
                gap: 10px !important;
                margin-top: 15px !important;
            }
            #maple-popup button {
                padding: 8px 15px !important;
                border: none !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                font-weight: 500 !important;
                flex: 1 !important;
                font-size: 14px !important;
                font-family: 'Montserrat', sans-serif !important;
                line-height: 1.5 !important;
                transition: background-color 0.2s !important;
            }
            #maple-popup button.primary {
                background: #b24303 !important;
                color: white !important;
            }
            #maple-popup button.primary:hover {
                background: #8c3502 !important;
            }
            #maple-popup button.secondary {
                background: #d4a088 !important;
                color: white !important;
            }
            #maple-popup button.secondary:hover {
                background: #c28b73 !important;
            }
            #maple-popup button:disabled {
                background: #d4a088 !important;
                cursor: not-allowed !important;
            }
            #maple-popup .form {
                display: none !important;
            }
            #maple-popup .form.visible {
                display: block !important;
            }
            #maple-popup .discount-wrapper {
                display: flex !important;
                gap: 10px !important;
                align-items: center !important;
            }
            #maple-popup #maple-discount-input {
                flex: 2 !important;
            }
            #maple-popup .discount-type-select {
                flex: 1 !important;
                padding: 8px !important;
                border: 1px solid #e8c4b0 !important;
                border-radius: 4px !important;
                font-family: 'Montserrat', sans-serif !important;
                font-size: 14px !important;
                height: 37px !important;
                color: #8c3502 !important;
                background: white !important;
            }
            #maple-popup .status {
                margin-top: 10px !important;
                padding: 10px !important;
                border-radius: 4px !important;
                display: none !important;
                font-size: 14px !important;
                line-height: 1.5 !important;
                font-weight: 400 !important;
            }
            #maple-popup .status.success {
                display: block !important;
                background: #fdf1e8 !important;
                color: #b24303 !important;
                border: 1px solid #e8c4b0 !important;
            }
            #maple-popup .status.error {
                display: block !important;
                background: #fdf1e8 !important;
                color: #b24303 !important;
                border: 1px solid #e8c4b0 !important;
            }
            #maple-popup .status.testing {
                display: block !important;
                background: #fdf1e8 !important;
                color: #b24303 !important;
                border: 1px solid #e8c4b0 !important;
            }
            #maple-popup .loading {
                display: inline-block !important;
                margin-left: 5px !important;
                animation: dots 1.5s infinite !important;
            }
            @keyframes dots {
                0%, 20% { content: '.' !important; }
                40% { content: '..' !important; }
                60% { content: '...' !important; }
                80%, 100% { content: '' !important; }
            }
            #maple-popup .checkbox-wrapper {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin: 10px 0 !important;
                font-size: 12px !important;
                color: #8c3502 !important;
                position: relative !important;
                z-index: 2147483647 !important;
            }
            #maple-popup .checkbox-wrapper input[type="checkbox"] {
                -webkit-appearance: none !important;
                -moz-appearance: none !important;
                appearance: none !important;
                width: 16px !important;
                height: 16px !important;
                border: 1px solid #e8c4b0 !important;
                border-radius: 3px !important;
                outline: none !important;
                cursor: pointer !important;
                margin: 0 !important;
                padding: 0 !important;
                background: white !important;
                position: relative !important;
                flex-shrink: 0 !important;
            }
            #maple-popup .checkbox-wrapper input[type="checkbox"]:checked {
                background: #b24303 !important;
                border-color: #b24303 !important;
            }
            #maple-popup .checkbox-wrapper input[type="checkbox"]:checked::after {
                content: '' !important;
                position: absolute !important;
                left: 4px !important;
                top: 1px !important;
                width: 6px !important;
                height: 10px !important;
                border: solid white !important;
                border-width: 0 2px 2px 0 !important;
                transform: rotate(45deg) !important;
            }
            #maple-popup .checkbox-wrapper input[type="checkbox"]:hover {
                border-color: #b24303 !important;
            }
            #maple-popup .checkbox-wrapper label {
                cursor: pointer !important;
                user-select: none !important;
                font-family: 'Montserrat', sans-serif !important;
                color: #8c3502 !important;
                font-size: 12px !important;
                margin: 0 !important;
                padding: 0 !important;
            }
        </style>
        <div class="header">
            <img src="${imageURL}" alt="Maple" class="logo">
            <h3>Maple</h3>
        </div>
        <div class="content">
            <p style="margin: 0 0 15px 0;">
                ${
                  numCoupons > 0
                    ? `Found ${numCoupons} potential coupon${
                        numCoupons !== 1 ? "s" : ""
                      }${discountMessage}!`
                    : "No coupon codes found for this website yet. Want to add one?"
                }
            </p>
            <div class="checkbox-wrapper">
                <input type="checkbox" id="maple-disable-site">
                <label for="maple-disable-site">Never display again on this site</label>
            </div>
            <div class="form">
                <input type="text" id="maple-code-input" placeholder="Enter coupon code">
                <div class="discount-wrapper">
                    <input type="number" id="maple-discount-input" placeholder="Discount amount">
                    <select id="maple-discount-type" class="discount-type-select">
                        <option value="dollar">$</option>
                        <option value="percent">%</option>
                    </select>
                </div>
            </div>
            <div class="status"></div>
            <div class="buttons">
                ${
                  numCoupons > 0
                    ? `<button class="primary" id="maple-try-codes">Try Codes</button>`
                    : `<button class="primary" id="maple-add-code">Add Code</button>
                       <button class="primary" id="maple-submit-code" style="display: none;">Submit</button>`
                }
                <button class="secondary" id="maple-dismiss">Dismiss</button>
            </div>
        </div>
    `;

  // Add to page
  document.body.appendChild(popup);

  // Add event listeners
  if (numCoupons > 0) {
    document
      .getElementById("maple-try-codes")
      .addEventListener("click", async () => {
        const status = popup.querySelector(".status");
        const tryButton = document.getElementById("maple-try-codes");
        const buttons = popup.querySelector(".buttons");

        status.className = "status testing";
        status.innerHTML = 'Testing coupon codes<span class="loading"></span>';
        tryButton.disabled = true;

        const result = await findBestCoupon();

        if (result && result.code) {
          status.className = "status success";
          status.textContent = `Best coupon found: ${
            result.code
          } (Saves $${result.discount.toFixed(2)})`;
        } else {
          status.className = "status error";
          status.textContent = "Unfortunately, none of the codes worked.";
        }

        // Always show the add code button after trying codes
        buttons.innerHTML = `
                <button class="primary" id="maple-add-code">Add Code</button>
                <button class="secondary" id="maple-dismiss">Dismiss</button>
            `;

        // Add event listener for the add code button
        const addButton = document.getElementById("maple-add-code");
        const form = popup.querySelector(".form");

        addButton.addEventListener("click", () => {
          form.classList.add("visible");
          status.style.display = "none";
          status.className = "";
          status.textContent = "";
          buttons.innerHTML = `
                    <button class="primary" id="maple-submit-code">Submit</button>
                    <button class="secondary" id="maple-dismiss">Dismiss</button>
                `;

          // Add event listener for the new submit button
          const submitButton = document.getElementById("maple-submit-code");
          submitButton.addEventListener("click", async () => {
            const code = document.getElementById("maple-code-input").value;
            const discount = document.getElementById(
              "maple-discount-input"
            ).value;
            const discountType = document.getElementById(
              "maple-discount-type"
            ).value;

            if (!code) {
              status.className = "status error";
              status.textContent = "Please enter a coupon code";
              return;
            }

            const discountError = getDiscountError(discount, discountType);
            if (discountError) {
              status.className = "status error";
              status.textContent = discountError;
              return;
            }

            try {
              submitButton.disabled = true;
              status.className = "status testing";
              status.innerHTML =
                'Adding coupon code<span class="loading"></span>';

              const response = await makeApiRequest(`${API_URL}/coupons`, {
                method: "POST",
                body: JSON.stringify({
                  code,
                  domain: window.location.hostname,
                  discount_amount: discount || null,
                  discount_type: discountType,
                }),
              });

              if (response.ok) {
                status.className = "status success";
                status.textContent = "Coupon code added successfully!";
                setTimeout(() => {
                  popup.remove();
                  // Refresh coupons
                  couponCache.delete(window.location.hostname);
                  checkForPromoField();
                }, 1500);
              } else {
                const data = await response.json();
                status.className = "status error";
                status.textContent =
                  data.error || "Failed to add coupon code. Please try again.";
                submitButton.disabled = false;
              }
            } catch (error) {
              console.error("Error adding coupon:", error);
              status.className = "status error";
              status.textContent =
                "Failed to add coupon code. Please try again.";
              submitButton.disabled = false;
            }
          });

          // Re-add dismiss handler
          document
            .getElementById("maple-dismiss")
            .addEventListener("click", () => {
              popup.remove();
            });
        });

        // Re-add dismiss handler
        document
          .getElementById("maple-dismiss")
          .addEventListener("click", () => {
            popup.remove();
          });
      });
  } else {
    const form = popup.querySelector(".form");
    const addButton = document.getElementById("maple-add-code");
    const submitButton = document.getElementById("maple-submit-code");

    addButton.addEventListener("click", () => {
      form.classList.add("visible");
      addButton.style.display = "none";
      submitButton.style.display = "block";
    });

    submitButton.addEventListener("click", async () => {
      const code = document.getElementById("maple-code-input").value;
      const discount = document.getElementById("maple-discount-input").value;
      const discountType = document.getElementById("maple-discount-type").value;

      if (!code) {
        status.className = "status error";
        status.textContent = "Please enter a coupon code";
        return;
      }

      const discountError = getDiscountError(discount, discountType);
      if (discountError) {
        status.className = "status error";
        status.textContent = discountError;
        return;
      }

      try {
        submitButton.disabled = true;
        status.className = "status testing";
        status.innerHTML = 'Adding coupon code<span class="loading"></span>';

        const response = await makeApiRequest(`${API_URL}/coupons`, {
          method: "POST",
          body: JSON.stringify({
            code,
            domain: window.location.hostname,
            discount_amount: discount || null,
            discount_type: discountType,
          }),
        });

        if (response.ok) {
          status.className = "status success";
          status.textContent = "Coupon code added successfully!";
          setTimeout(() => {
            popup.remove();
            // Refresh coupons
            couponCache.delete(window.location.hostname);
            checkForPromoField();
          }, 1500);
        } else {
          const data = await response.json();
          status.className = "status error";
          status.textContent =
            data.error || "Failed to add coupon code. Please try again.";
          submitButton.disabled = false;
        }
      } catch (error) {
        console.error("Error adding coupon:", error);
        status.className = "status error";
        status.textContent = "Failed to add coupon code. Please try again.";
        submitButton.disabled = false;
      }
    });
  }

  document.getElementById("maple-dismiss").addEventListener("click", () => {
    popup.remove();
  });

  // Add checkbox event listener
  const checkbox = document.getElementById("maple-disable-site");
  const checkboxLabel = checkbox.nextElementSibling;

  // Add click handlers to both checkbox and label
  [checkbox, checkboxLabel].forEach((element) => {
    element.addEventListener(
      "click",
      async (e) => {
        // Prevent any default behavior and event bubbling
        e.preventDefault();
        e.stopPropagation();

        // Toggle checkbox state
        checkbox.checked = !checkbox.checked;

        // Update storage
        const { disabledSites = {} } = await chrome.storage.local.get(
          "disabledSites"
        );
        disabledSites[window.location.hostname] = checkbox.checked;
        await chrome.storage.local.set({ disabledSites });

        // Return false to prevent any other handlers
        return false;
      },
      true
    );
  });
}

async function fetchCoupons(domain) {
  // Check cache first
  if (couponCache.has(domain)) {
    return couponCache.get(domain);
  }

  try {
    const response = await makeApiRequest(`${API_URL}/coupons/${domain}`);
    const data = await response.json();
    // Cache the response
    couponCache.set(domain, data);
    return data;
  } catch (error) {
    console.error("Error fetching coupons:", error);
    return { coupons: [] };
  }
}

// Check for promo input field
async function checkForPromoField() {
  if (isCheckingPromoField || hasShownPopup) return;

  try {
    isCheckingPromoField = true;

    // Check if this site is disabled
    const { disabledSites = {} } = await chrome.storage.local.get(
      "disabledSites"
    );
    if (disabledSites[window.location.hostname]) {
      return;
    }

    const promoInput = await findPromoInputField();
    if (promoInput) {
      const domain = window.location.hostname;
      const data = await fetchCoupons(domain);

      await chrome.storage.local.set({
        numCoupons: data.coupons?.length || 0,
        coupons: data.coupons || [],
      });

      chrome.runtime.sendMessage({
        action: "updateBadge",
        count: data.coupons?.length || 0,
      });

      if (!hasShownPopup) {
        createNotification(data.coupons?.length || 0, data.coupons);
        hasShownPopup = true;

        if (observer) observer.disconnect();
        clearInterval(checkInterval);
      }
    }
  } finally {
    isCheckingPromoField = false;
  }
}

// Debounced version of the check function
const debouncedCheck = debounce(checkForPromoField, 250);

// Start checking when page loads
setTimeout(debouncedCheck, 1000); // Initial delay to let page load

// Set up interval for periodic checks
let checkInterval = setInterval(debouncedCheck, 1000);

// Set up observer for DOM changes
const observer = new MutationObserver((mutations) => {
  if (!hasShownPopup) {
    // Check if any mutation involves adding nodes or modifying attributes
    const shouldCheck = mutations.some(
      (mutation) =>
        (mutation.type === "childList" && mutation.addedNodes.length > 0) ||
        (mutation.type === "attributes" && mutation.target.tagName === "INPUT")
    );

    if (shouldCheck) {
      debouncedCheck();
    }
  }
});

// Start observing with a more comprehensive configuration
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["style", "class", "type", "value", "placeholder"], // Only watch relevant attributes
  characterData: false, // We don't need to watch text changes
});

// Clean up after 5 minutes if nothing found
setTimeout(() => {
  if (!hasShownPopup) {
    clearInterval(checkInterval);
    observer.disconnect();
  }
}, 300000);

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "findCoupons") {
    findBestCoupon().then((result) => {
      sendResponse(result);
    });
    return true;
  }
});

function validateDiscount(amount, type) {
  if (!amount) return true; // Optional discount

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) return false;

  if (type === "percent") {
    return numAmount > 0 && numAmount <= 100;
  } else {
    return numAmount > 0;
  }
}

function getDiscountError(amount, type) {
  if (!amount) return null;

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) {
    return "Invalid discount amount";
  }

  if (type === "percent") {
    if (numAmount <= 0 || numAmount > 100) {
      return "Percentage discount must be between 0 and 100";
    }
  } else {
    if (numAmount <= 0) {
      return "Dollar discount must be greater than 0";
    }
  }
  return null;
}
