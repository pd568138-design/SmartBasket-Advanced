```javascript
"use strict";

// ============================================
// SMART BASKET - BASKET SELECTION PAGE
// ============================================

// Check customer login
if (sessionStorage.getItem("sbLogged") !== "1") {
    window.location.href = "login.html";
}

// Backend URL from config.js
const API_BASE_URL =
    typeof BACKEND_URL !== "undefined"
        ? BACKEND_URL.replace(/\/+$/, "")
        : "";

// Page elements
const grid = document.getElementById("basketGrid");
const message = document.getElementById("basketMessage");
const refreshButton = document.getElementById("refreshBaskets");

// Available basket IDs
const basketIds = ["B1", "B2", "B3", "B4", "B5"];


// ============================================
// SHOW MESSAGE
// ============================================

function say(text, type = "") {
    if (!message) return;

    message.textContent = text;
    message.className = "basket-message " + type;
}


// ============================================
// BACKEND API HELPER
// ============================================

async function apiRequest(endpoint, options = {}) {
    if (!API_BASE_URL) {
        throw new Error(
            "Backend URL missing. Check frontend/js/config.js."
        );
    }

    const response = await fetch(API_BASE_URL + endpoint, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        throw new Error(
            data.message || "Backend request failed."
        );
    }

    return data;
}


// ============================================
// LOAD BASKETS
// ============================================

async function loadBaskets() {
    if (!grid) {
        console.error("basketGrid element not found.");
        return;
    }

    if (refreshButton) {
        refreshButton.disabled = true;
    }

    grid.innerHTML =
        '<div class="glass basket-loading">' +
        "Checking live status...</div>";

    say("");

    try {
        const data = await apiRequest("/api/baskets");

        const baskets = Array.isArray(data.baskets)
            ? data.baskets
            : [];

        const statusMap = new Map(
            baskets.map(basket => [
                basket.basketId || basket._id,
                basket.status
            ])
        );

        grid.innerHTML = "";

        basketIds.forEach(id => {
            const status = statusMap.get(id) || "Available";
            const available = status === "Available";

            const card = document.createElement("article");

            card.className =
                "basket-card glass " +
                (available ? "available" : "in-use");

            card.innerHTML = `
                <div class="basket-icon">🧺</div>
                <h2>${id}</h2>

                <span class="basket-pill">
                    ${available ? "● Available" : "● In Use"}
                </span>

                <p>
                    ${available
                        ? "Ready to select"
                        : "Currently reserved"}
                </p>

                <button
                    type="button"
                    class="btn ${available ? "primary" : "secondary"}"
                    ${available ? "" : "disabled"}
                >
                    ${available
                        ? "Select basket →"
                        : "Unavailable"}
                </button>
            `;

            if (available) {
                card.querySelector("button")
                    .addEventListener("click", () => {
                        selectBasket(id, card);
                    });
            }

            grid.appendChild(card);
        });

        if (baskets.length === 0) {
            say(
                "No baskets found. Check your database.",
                "error"
            );
        }

    } catch (error) {
        console.error("Basket loading error:", error);

        grid.innerHTML =
            '<div class="glass basket-error">' +
            "Unable to load basket status.</div>";

        say(error.message, "error");

    } finally {
        if (refreshButton) {
            refreshButton.disabled = false;
        }
    }
}


// ============================================
// GET CUSTOMER LOCATION
// ============================================

function getCustomerLocation() {
    return new Promise(resolve => {
        if (!navigator.geolocation) {
            resolve(null);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },

            () => resolve(null),

            {
                timeout: 5000,
                maximumAge: 60000
            }
        );
    });
}


// ============================================
// SELECT BASKET
// ============================================

async function selectBasket(id, card) {
    const button = card.querySelector("button");

    button.disabled = true;
    button.textContent = "Reserving...";

    say("Reserving " + id + "...");

    try {
        const user = JSON.parse(
            localStorage.getItem("sbUser") || "{}"
        );

        // Location is optional
        const customerLocation =
            await getCustomerLocation();

        // Send basket selection request
        const data = await apiRequest(
            "/api/baskets/" +
            encodeURIComponent(id) +
            "/select",

            {
                method: "POST",

                body: JSON.stringify({
                    customerName: user.name || "Guest",
                    customerPhone: user.phone || "",
                    location: customerLocation
                })
            }
        );

        // Validate backend response
        if (!data.basketId || !data.sessionId) {
            throw new Error(
                "Basket selection response is incomplete. " +
                "Check the backend API response."
            );
        }

        // Save selected basket details
        sessionStorage.setItem(
            "activeBasketId",
            data.basketId
        );

        sessionStorage.setItem(
            "activeBasketSessionId",
            data.sessionId
        );

        localStorage.setItem(
            "basketId",
            data.basketId
        );

        say("Basket selected! Opening scanner...");

        // IMPORTANT: Use window.location for navigation
        window.location.href =
            "scanner.html?basketId=" +
            encodeURIComponent(data.basketId);

    } catch (error) {
        console.error("Basket selection error:", error);

        say(error.message, "error");

        await loadBaskets();
    }
}


// ============================================
// REFRESH BASKETS
// ============================================

if (refreshButton) {
    refreshButton.addEventListener(
        "click",
        loadBaskets
    );
}


// ============================================
// INITIALIZE PAGE
// ============================================

loadBaskets();
```
