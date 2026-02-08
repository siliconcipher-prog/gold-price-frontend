/* =========================
   CONFIG
========================= */

const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname.startsWith("192.168.");

const API = isLocal
  ? "http://127.0.0.1:8000"
  : "https://gold-price-backend-vod4.onrender.com";


const TIMEOUT_MS = 8000;

let chart;
let currentKarat = "24K";
let currentWeight = 1;
let currentData = null;

/* =========================
   DAILY INSIGHT COPY
========================= */

const INSIGHT_VARIANT = "A";

const DAILY_INSIGHT_COPY = {
  A: {
    UP: city => `⬆️ Gold prices moved higher today in ${city}.`,
    DOWN: city => `⬇️ Gold prices declined today in ${city}.`,
    FLAT: city => `⏸️ Gold prices remained largely unchanged today in ${city}.`,
    HIGH: city => `📈 Gold prices are at a 7-day high in ${city}.`,
    LOW: city => `📉 Gold prices are at a 7-day low in ${city}.`,
    FALLBACK: city => `ℹ️ Showing the latest available gold price for ${city}.`
  }
};

/* =========================
   DOM
========================= */

const cityInput = document.getElementById("city");
const statusEl = document.getElementById("status");
const suggestionBox = document.getElementById("citySuggestions");
const refreshBtn = document.getElementById("refreshBtn");
const WEIGHT_OPTIONS = [1, 8];
const PRICE_KEYS = ["24K", "22K", "18K"];

/* =========================
   AUTOCOMPLETE STATE
========================= */

let debounceTimer;
let cityAbortController = null;
let isAutocompleteOpen = false;

function openAutocomplete() {
  isAutocompleteOpen = true;
  suggestionBox.classList.remove("hidden");
}

function closeAutocomplete() {
  isAutocompleteOpen = false;
  suggestionBox.classList.add("hidden");
  suggestionBox.innerHTML = "";
}

function showAutocompleteSkeleton(count = 4) {
  suggestionBox.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const div = document.createElement("div");
    div.className = "skeleton-item";
    suggestionBox.appendChild(div);
  }
  openAutocomplete();
}

function showAutocompleteError(msg) {
  closeAutocomplete();
  setStatus(msg);
}


/* =========================
   SEO HELPERS
========================= */

function getSelectedCity() {
  return cityInput && cityInput.value
    ? cityInput.value.trim()
    : "";
}

function isIndiaPage() {
  return window.location.pathname === "/india-gold-rate";
}

function isHomePage() {
  return window.location.pathname === "/";
}

function getCityFromURL() {
  const match = window.location.pathname.match(/^\/([a-z-]+)-gold-rate$/);
  if (!match) return null;

  return match[1]
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// function updateSEO(city) {
//   const title = `${city} Gold Rate Today – 24K, 22K, 18K Price`;
//   const description =
//     `Check today’s gold rate in ${city}. Live 24K, 22K & 18K gold prices per gram.`;

//   document.title = title;
//   document.getElementById("pageTitle").textContent = title;
//   document
//     .getElementById("metaDescription")
//     .setAttribute("content", description);
// }

// function updateCanonical(city) {
//   const canonical = document.getElementById("canonicalUrl");
//   if (!canonical) return;

//   canonical.href = `${window.location.origin}/${city
//     .toLowerCase()
//     .replace(/\s+/g, "-")}-gold-rate`;
// }

// function updateGoldSchema(data) {
//   const price = data.prices["24K"];
//   if (!price) return;

//   const seoCityEl = document.getElementById("seoCity");
// if (seoCityEl) seoCityEl.textContent = data.city;

// const seoCityTextEl = document.getElementById("seoCityText");
// if (seoCityTextEl) seoCityTextEl.textContent = data.city;

//   document.getElementById("goldSchema").textContent = JSON.stringify({
//     "@context": "https://schema.org",
//     "@type": "Dataset",
//     name: `${data.city} Gold Price Today`,
//     description: `Daily gold prices for 24K, 22K and 18K gold in ${data.city}.`,
//     keywords: ["gold price", "gold rate", "24K gold", "22K gold", "18K gold"],
//     dateModified: data.last_updated,
//     spatialCoverage: {
//       "@type": "Place",
//       name: data.city
//     },
//     creator: {
//       "@type": "Organization",
//       name: "Gold Rate India"
//     }
//   });
// }

/* =========================
   CACHE
========================= */

function cacheKey(city) {
  return `gold:${city.toLowerCase()}`;
}

function saveCache(city, data) {
  localStorage.setItem(cacheKey(city), JSON.stringify(data));
  localStorage.setItem("lastCity", city);
}

function loadCache(city) {
  const raw = localStorage.getItem(cacheKey(city));
  return raw ? JSON.parse(raw) : null;
}

/* =========================
   UI HELPERS
========================= */

function setStatus(msg = "") {
  statusEl.textContent = msg;

  if (!msg) {
    statusEl.classList.add("hidden");
  } else {
    statusEl.classList.remove("hidden");
  }
}


function setLoading(flag) {
  refreshBtn.disabled = flag;
  refreshBtn.classList.toggle("loading", flag);
}

function formatRupee(value) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function scalePrice(value) {
  return value * currentWeight;
}

function updateWeightToggleUI() {
  document.querySelectorAll(".weight-btn").forEach(btn => {
    const isActive = Number(btn.dataset.weight) === currentWeight;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function ensureWeightToggle() {
  if (document.getElementById("weightToggle")) return;

  const controls = document.querySelector(".controls");
  if (!controls) return;

  const toggle = document.createElement("div");
  toggle.id = "weightToggle";
  toggle.className = "weight-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Gold weight");

  WEIGHT_OPTIONS.forEach(weight => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `weight-btn${weight === currentWeight ? " active" : ""}`;
    btn.dataset.weight = String(weight);
    btn.textContent = `${weight}g`;
    btn.setAttribute(
      "aria-pressed",
      weight === currentWeight ? "true" : "false"
    );

    btn.addEventListener("click", () => {
      if (currentWeight === weight) return;
      currentWeight = weight;
      updateWeightToggleUI();
      if (currentData) {
        renderData(currentData);
      }
    });

    toggle.appendChild(btn);
  });

  controls.insertAdjacentElement("afterend", toggle);
}

function showSkeleton() {
  document.getElementById("prices").classList.remove("hidden");
  document.querySelectorAll(".price-card")
    .forEach(c => c.classList.add("skeleton"));
  document.getElementById("chartWrapper").classList.add("hidden");
}

function hideSkeleton() {
  document.querySelectorAll(".price-card")
    .forEach(c => c.classList.remove("skeleton"));
}

/* =========================
   AUTOCOMPLETE (FIXED)
========================= */

cityInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);

  const q = cityInput.value.trim();
  if (q.length < 2) {
    closeAutocomplete();
    return;
  }

  debounceTimer = setTimeout(async () => {
    if (cityAbortController) cityAbortController.abort();
    cityAbortController = new AbortController();

    // ✅ show skeleton immediately
    showAutocompleteSkeleton();
    setStatus("");

    try {
      const res = await fetch(
        `${API}/api/v1/cities?q=${encodeURIComponent(q)}`,
        { signal: cityAbortController.signal }
      );

      if (!res.ok) {
        throw new Error("CITY_FETCH_FAILED");
      }

      const cities = await res.json();
      if (cityInput.value.trim() !== q) return;

      suggestionBox.innerHTML = "";

      if (!cities.length) {
        closeAutocomplete();
        setStatus("No matching cities found");
        return;
      }

      cities.forEach(city => {
        const div = document.createElement("div");
        div.textContent = city;

        div.addEventListener("mousedown", e => {
          e.preventDefault();
          cityInput.value = city;
          closeAutocomplete();
          fetchPrice();
        });

        suggestionBox.appendChild(div);
      });

      openAutocomplete();
    } catch (err) {
      if (err.name === "AbortError") return;

      showAutocompleteError(
        "Unable to load city suggestions. Please try again."
      );
    }
  }, 250);
});


document.addEventListener("pointerdown", e => {
  if (!e.target.closest(".autocomplete-wrapper")) {
    closeAutocomplete();
  }
});

cityInput.addEventListener("blur", () => {
  setTimeout(closeAutocomplete, 120);
});

cityInput.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeAutocomplete();
    cityInput.blur();
  }

  if (e.key === "Enter" && isAutocompleteOpen) {
    e.preventDefault();
    closeAutocomplete();
    fetchPrice();
  }
});

/* =========================
   DATA HELPERS
========================= */

function calculateChange(history, karat) {
  if (!history || history.length < 2) return null;

  const prev = history[history.length - 2][karat];
  const curr = history[history.length - 1][karat];
  if (!prev || !curr) return null;

  const diff = curr - prev;
  const percent = ((diff / prev) * 100).toFixed(2);
  return { diff, percent };
}

function generateDailyInsight(city, history, karat) {
  const COPY = DAILY_INSIGHT_COPY[INSIGHT_VARIANT];
  if (!history || history.length < 2) return COPY.FALLBACK(city);

  const prices = history.map(h => h[karat]);
  const today = prices.at(-1);
  const yesterday = prices.at(-2);

  if (today === Math.max(...prices)) return COPY.HIGH(city);
  if (today === Math.min(...prices)) return COPY.LOW(city);
  if (today > yesterday) return COPY.UP(city);
  if (today < yesterday) return COPY.DOWN(city);
  return COPY.FLAT(city);
}

function updateBreadcrumb(city) {
  const cityEl = document.getElementById("breadcrumbCity");
  const sepEl = document.getElementById("breadcrumbSeparator");

  if (!cityEl || !sepEl) return;

  if (city === "India") {
    // ✅ Homepage / India page → single breadcrumb
    cityEl.textContent = "";
    sepEl.style.display = "none";
  } else {
    // ✅ City page
    cityEl.textContent = city;
    sepEl.style.display = "inline";
  }
}



/* =========================
   FETCH
========================= */
async function fetchPrice() {
  closeAutocomplete();
  if (cityAbortController) cityAbortController.abort();

  // 1️⃣ Resolve city (CORRECT priority)
  let city = getSelectedCity();

  // If user didn't type/select, try URL
  if (!city) {
    city = getCityFromURL() || "";
  }

  // If still empty → only THEN default to India
  if (!city) {
    city = "India";
  }

  // Validation (KEPT, but now meaningful)
  if (!city || city.trim() === "") {
    setStatus("Please enter a city");
    return;
  }

  // Normalize
  city = city.replace(/\b\w/g, c => c.toUpperCase());

// 🔑 Sync input ONLY if user did not type
if (cityInput && !getSelectedCity()) {
  cityInput.value = city;
}

  setLoading(true);
  setStatus("Loading latest prices…");
  showSkeleton();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const insightEl = document.getElementById("insight");
  insightEl.textContent = "Checking today’s gold price…";
  insightEl.classList.remove("hidden");

  try {
    const res = await fetch(
      `${API}/api/v1/gold/full?city=${encodeURIComponent(city)}`,
      { signal: controller.signal }
    );

    if (!res.ok) throw new Error("CITY_NOT_FOUND");

    const data = await res.json();
    saveCache(data.city, data);
    renderData(data);
    updateBreadcrumb(data.city);

    // 2️⃣ URL update (India = root)
const slug = data.city.toLowerCase().replace(/\s+/g, "-");
const nextURL = slug === "india" ? "/" : `/${slug}-gold-rate`;

if (window.location.pathname !== nextURL) {
  history.pushState({}, "", nextURL);
}

    setStatus("");
  } catch (err) {
    hideSkeleton();
    setStatus(
      err.message === "CITY_NOT_FOUND"
        ? "City not supported yet"
        : "Something went wrong. Please try again."
    );
  } finally {
    clearTimeout(timeout);
    setLoading(false);
    closeAutocomplete();
  }
}


/* =========================
   RENDER
========================= */

function renderData(data) {
  currentData = data;
  hideSkeleton();

  // updateSEO(data.city);
  // updateCanonical(data.city);
  // updateGoldSchema(data);

  document.getElementById("pageHeading").textContent =
    `${data.city} Gold Price`;

  const insightEl = document.getElementById("insight");
if (!data.history || data.history.length === 0) {
  insightEl.textContent = `Showing today’s gold price for ${data.city}`;
} else {
  insightEl.textContent =
    generateDailyInsight(data.city, data.history, "24K");
}
  insightEl.classList.remove("hidden");

  PRICE_KEYS.forEach(k => {
    const scaledPrice = scalePrice(data.prices[k]);
    document.getElementById("p" + k.slice(0, 2)).textContent =
      formatRupee(scaledPrice);

    const change = calculateChange(data.history, k);
    const el = document.getElementById("c" + k.slice(0, 2));

    if (!change) {
      el.textContent = "—";
      el.className = "change same";
    } else if (change.diff > 0) {
      const scaledDiff = scalePrice(change.diff);
      el.textContent = `▲ ${formatRupee(scaledDiff)} (+${change.percent}%)`;
      el.className = "change up";
    } else {
      const scaledDiff = scalePrice(Math.abs(change.diff));
      el.textContent =
        `▼ ${formatRupee(scaledDiff)} (-${Math.abs(change.percent)}%)`;
      el.className = "change down";
    }
  });

  renderChart(
    data.history.map(h => ({ date: h.date, price: scalePrice(h[currentKarat]) }))
  );

  document.getElementById("updated").textContent =
    `Updated: ${new Date(data.last_updated).toLocaleString()} • Showing ${currentWeight}g`;
}

/* =========================
   CHART
========================= */

function renderChart(history) {
  if (!history || history.length < 2) return;

  document.getElementById("chartWrapper").classList.remove("hidden");

  const ctx = document.getElementById("historyChart").getContext("2d");
  if (chart) chart.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, "rgba(212, 175, 55, 0.35)");
  gradient.addColorStop(1, "rgba(212, 175, 55, 0)");

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        data: history.map(h => h.price),
        borderColor: "#d4af37",
        backgroundColor: gradient,
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointRadius: 0
      }]
    },
    options: {
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { display: false } }
      }
    }
  });
}

/* =========================
   KARAT SWITCH
========================= */

document.querySelectorAll(".karat-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".karat-btn")
      .forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    currentKarat = btn.dataset.karat;
    const cached = loadCache(cityInput.value);
    if (cached) {
      renderChart(
        cached.history.map(h => ({
          date: h.date,
          price: scalePrice(h[currentKarat])
        }))
      );
    }
  };
});

/* =========================
   INIT
========================= */

refreshBtn.addEventListener("click", fetchPrice);

// document.addEventListener("DOMContentLoaded", () => {
//   const city =
//     getCityFromURL() ||
//     localStorage.getItem("lastCity") ||
//     "India";

//   cityInput.value = city;
//   fetchPrice();
// });

document.addEventListener("DOMContentLoaded", () => {
  ensureWeightToggle();
  let city;

  if (isHomePage()) {
    // ✅ Homepage must always show India
    city = "India";
  } else {
    // ✅ City pages derive city from URL
    city =
      getCityFromURL() ||
      localStorage.getItem("lastCity") ||
      "India";
  }

  // if (cityInput) {
  //   cityInput.value = city === "India" ? "" : city;
  // }

  if (cityInput) {
  if (isHomePage()) {
    // Homepage: empty input, India data
    cityInput.value = "";
  } else {
    // City pages INCLUDING india-gold-rate
    cityInput.value = city;
  }
}


  fetchPrice();
});


/* =========================
   Feedback
========================= */

let feedbackHelpful = null;

const fbYes = document.getElementById("fbYes");
const fbNo = document.getElementById("fbNo");
const fbSubmit = document.getElementById("fbSubmit");

function updateSubmitState() {
  fbSubmit.disabled = feedbackHelpful === null;
}

fbYes.onclick = () => {
  if (feedbackHelpful === true) {
    // unselect
    feedbackHelpful = null;
    fbYes.classList.remove("selected", "yes");
  } else {
    feedbackHelpful = true;
    fbYes.classList.add("selected", "yes");
    fbNo.classList.remove("selected", "no");
  }
  updateSubmitState();
};

fbNo.onclick = () => {
  if (feedbackHelpful === false) {
    // unselect
    feedbackHelpful = null;
    fbNo.classList.remove("selected", "no");
  } else {
    feedbackHelpful = false;
    fbNo.classList.add("selected", "no");
    fbYes.classList.remove("selected", "yes");
  }
  updateSubmitState();
};


function enableFeedback() {
  document.getElementById("fbSubmit").disabled = false;
}

document.getElementById("fbSubmit").onclick = async () => {
  const message = document.getElementById("fbMessage").value.trim();
  const city = cityInput.value || "India";

  try {
    await fetch(`${API}/api/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        city,
        helpful: feedbackHelpful,
        message,
        page_url: window.location.href
      })
    });

    document.getElementById("fbStatus").textContent =
      "Thanks! Your feedback helps improve the site 🙏";

    document.getElementById("fbSubmit").disabled = true;
  } catch {
    document.getElementById("fbStatus").textContent =
      "Could not submit feedback. Please try later.";
  }
};


const feedbackFab = document.getElementById("feedbackFab");
const feedbackPanel = document.getElementById("feedbackPanel");
const feedbackClose = document.getElementById("feedbackClose");

feedbackFab.onclick = () => {
  feedbackPanel.classList.toggle("hidden");
};

feedbackClose.onclick = () => {
  feedbackPanel.classList.add("hidden");
};

// Optional: close when clicking outside
document.addEventListener("click", e => {
  if (
    !feedbackPanel.contains(e.target) &&
    !feedbackFab.contains(e.target)
  ) {
    feedbackPanel.classList.add("hidden");
  }
});


document.getElementById("fbSubmit").onclick = async () => {
  const btn = document.getElementById("fbSubmit");
  btn.textContent = "Sending…";
  btn.disabled = true;

  try {
    await fetch(`${API}/api/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        city: cityInput.value || "India",
        helpful: feedbackHelpful,
        message: document.getElementById("fbMessage").value.trim(),
        page_url: window.location.href
      })
    });

    btn.textContent = "✓ Sent";
    document.getElementById("fbStatus").textContent =
      "Thanks! Your feedback helps improve the site 🙏";
  } catch {
    btn.textContent = "Submit feedback";
    btn.disabled = false;
    document.getElementById("fbStatus").textContent =
      "Could not submit feedback. Try again.";
  }
};
