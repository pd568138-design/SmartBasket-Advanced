
if (sessionStorage.getItem("sbLogged") !== "1") {
  location.href = "login.html";
}

const u = JSON.parse(localStorage.getItem("sbUser") || "{}");

document.getElementById("user").textContent = u.name || "there";

document.getElementById("basketPreview").textContent =
  sessionStorage.getItem("activeBasketId") || "Not selected";

document.getElementById("lastBarcode").textContent =
  localStorage.getItem("lastBarcode") || "Not scanned";

// Basket selection buttons
document.querySelectorAll("[data-basket-id]").forEach((button) => {
  button.addEventListener("click", async () => {
    const basketId = button.dataset.basketId;

    if (!basketId) {
      alert("Basket ID missing!");
      return;
    }

    const sessionId =
      sessionStorage.getItem("activeBasketSessionId");

    if (!sessionId) {
      alert("Please select or assign a basket first.");
      return;
    }

    sessionStorage.setItem("activeBasketId", basketId);

    location.href = "scanner.html";
  });
});

// Logout
document.getElementById("logout").onclick = async () => {
  const id = sessionStorage.getItem("activeBasketId");
  const sid = sessionStorage.getItem("activeBasketSessionId");

  if (id && sid) {
    try {
      await fetch(
        BACKEND_URL + "/api/baskets/" +
        encodeURIComponent(id) + "/release",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
          keepalive: true
        }
      );
    } catch (e) {
      console.error("Basket release failed:", e);
    }
  }

  sessionStorage.clear();
  location.href = "login.html";
};
