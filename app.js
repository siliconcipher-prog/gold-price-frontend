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

/* =========================
   SEO HELPERS
========================= */

function getCityFromURL() {
  const match = window.location.pathname.match(/^\/([a-z-]+)-gold-rate$/);
  if (!match) return null;

  return match[1]
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function updateSEO(city) {
  const title = `${city} Gold Rate Today – 24K, 22K, 18K Price`;
  const description =
    `Check today’s gold rate in ${city}. Live 24K, 22K & 18K gold prices per gram.`;

  document.title = title;
  document.getElementById("pageTitle").textContent = title;
  document
    .getElementById("metaDescription")
    .setAttribute("content", description);
}

function updateCanonical(city) {
  const canonical = document.getElementById("canonicalUrl");
  if (!canonical) return;

  canonical.href = `${window.location.origin}/${city
    .toLowerCase()
    .replace(/\s+/g, "-")}-gold-rate`;
}

function updateGoldSchema(data) {
  const price = data.prices["24K"];
  if (!price) return;

  const seoCityEl = document.getElementById("seoCity");
if (seoCityEl) seoCityEl.textContent = data.city;

const seoCityTextEl = document.getElementById("seoCityText");
if (seoCityTextEl) seoCityTextEl.textContent = data.city;

  document.getElementById("goldSchema").textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${data.city} Gold Rate`,
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price,
      availability: "https://schema.org/InStock",
      url: window.location.href
    }
  });
}

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

    try {
      const res = await fetch(
        `${API}/api/v1/cities?q=${encodeURIComponent(q)}`,
        { signal: cityAbortController.signal }
      );

      if (!res.ok) return;

      const cities = await res.json();
      if (cityInput.value.trim() !== q) return;

      suggestionBox.innerHTML = "";
      if (!cities.length) {
        closeAutocomplete();
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
      if (err.name !== "AbortError") closeAutocomplete();
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

/* =========================
   FETCH
========================= */

async function fetchPrice() {
  closeAutocomplete();
  if (cityAbortController) cityAbortController.abort();

  let city = cityInput.value.trim();
  if (!city) {
    setStatus("Please enter a city");
    return;
  }

  city = city.replace(/\b\w/g, c => c.toUpperCase());

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

    history.pushState({}, "", `/${data.city.toLowerCase().replace(/\s+/g, "-")}-gold-rate`);
    setStatus("");
  } catch {
    setStatus("City not supported yet");
  } finally {
    clearTimeout(timeout);
    setLoading(false);
  }
}

/* =========================
   RENDER
========================= */

function renderData(data) {
  hideSkeleton();

  updateSEO(data.city);
  updateCanonical(data.city);
  updateGoldSchema(data);

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

  ["24K", "22K", "18K"].forEach(k => {
    document.getElementById("p" + k.slice(0, 2)).textContent =
      `₹${data.prices[k]}`;

    const change = calculateChange(data.history, k);
    const el = document.getElementById("c" + k.slice(0, 2));

    if (!change) {
      el.textContent = "—";
      el.className = "change same";
    } else if (change.diff > 0) {
      el.textContent = `▲ ₹${change.diff.toFixed(0)} (+${change.percent}%)`;
      el.className = "change up";
    } else {
      el.textContent =
        `▼ ₹${Math.abs(change.diff).toFixed(0)} (-${Math.abs(change.percent)}%)`;
      el.className = "change down";
    }
  });

  renderChart(
    data.history.map(h => ({ date: h.date, price: h[currentKarat] }))
  );

  document.getElementById("updated").textContent =
    `Updated: ${new Date(data.last_updated).toLocaleString()}`;
}

/* =========================
   CHART
========================= */

function renderChart(history) {
  if (!history || history.length < 2) return;

  document.getElementById("chartWrapper").classList.remove("hidden");

  const ctx = document.getElementById("historyChart").getContext("2d");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        data: history.map(h => h.price),
        borderColor: "#d4af37",
        borderWidth: 3,
        tension: 0.35,
        pointRadius: 0
      }]
    },
    options: {
      plugins: { legend: { display: false } },
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
          price: h[currentKarat]
        }))
      );
    }
  };
});

/* =========================
   INIT
========================= */

refreshBtn.addEventListener("click", fetchPrice);

document.addEventListener("DOMContentLoaded", () => {
  const city =
    getCityFromURL() ||
    localStorage.getItem("lastCity") ||
    "India";

  cityInput.value = city;
  fetchPrice();
});
