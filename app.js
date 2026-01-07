/* =========================
   CONFIG
========================= */

const API = window.location.hostname.includes("localhost")
  ? "http://127.0.0.1:8000"
  : "https://gold-price-backend-vod4.onrender.com";

const TIMEOUT_MS = 8000;

let chart;
let currentKarat = "24K";

/* =========================
   DAILY INSIGHT COPY
========================= */

// Copy variants (A = default for V1)
const INSIGHT_VARIANT = "A"; // A | B | C

const DAILY_INSIGHT_COPY = {
  A: {
    UP:    city => `⬆️ Gold prices moved higher today in ${city}.`,
    DOWN:  city => `⬇️ Gold prices declined today in ${city}.`,
    FLAT:  city => `⏸️ Gold prices remained largely unchanged today in ${city}.`,
    HIGH:  city => `📈 Gold prices are at a 7-day high in ${city}.`,
    LOW:   city => `📉 Gold prices are at a 7-day low in ${city}.`,
    FALLBACK: city => `ℹ️ Showing the latest available gold price for ${city}.`
  },

  B: {
    UP:    city => `⬆️ Gold prices are higher today in ${city}.`,
    DOWN:  city => `⬇️ Gold prices are lower today in ${city}.`,
    FLAT:  city => `⏸️ Gold prices are mostly unchanged today in ${city}.`,
    HIGH:  city => `📈 Gold prices hit a 7-day high in ${city}.`,
    LOW:   city => `📉 Gold prices hit a 7-day low in ${city}.`,
    FALLBACK: city => `ℹ️ Latest gold price shown for ${city}.`
  },

  C: {
    UP:    city => `⬆️ Gold prices saw an uptick today in ${city}.`,
    DOWN:  city => `⬇️ Gold prices saw a decline today in ${city}.`,
    FLAT:  city => `⏸️ Gold prices remained stable today in ${city}.`,
    HIGH:  city => `📈 Gold prices touched a 7-day high in ${city}.`,
    LOW:   city => `📉 Gold prices touched a 7-day low in ${city}.`,
    FALLBACK: city => `ℹ️ Displaying the most recent gold price for ${city}.`
  }
};


/* =========================
   DOM ELEMENTS
========================= */

const cityInput = document.getElementById("city");
const statusEl = document.getElementById("status");
const suggestionBox = document.getElementById("citySuggestions");
const refreshBtn = document.getElementById("refreshBtn");

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

  const slug = city.toLowerCase().replace(/\s+/g, "-");
  canonical.href = `${window.location.origin}/${slug}-gold-rate`;
}

function updateGoldSchema(data) {
  const price =
    data.prices["24K"] || data.prices["22K"] || data.prices["18K"];
  if (!price) return;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${data.city} Gold Rate`,
    description: `Live gold price in ${data.city}. Updated daily.`,
    category: "Precious Metal",
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price,
      availability: "https://schema.org/InStock",
      url: window.location.href,
      priceValidUntil: new Date(data.last_updated).toISOString()
    }
  };

  document.getElementById("goldSchema").textContent =
    JSON.stringify(schema);
}

/* =========================
   CACHE
========================= */

function cacheKey(city) {
  return `gold:full:${city.toLowerCase()}`;
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
}

function setLoading(isLoading) {
  refreshBtn.disabled = isLoading;
  refreshBtn.classList.toggle("loading", isLoading);
}

function showPrices() {
  document.getElementById("prices").classList.remove("hidden");
  document.getElementById("meta").classList.remove("hidden");
}

/* =========================
   SKELETON
========================= */

function showSkeleton() {
  document.getElementById("prices").classList.remove("hidden");
  document.querySelectorAll(".price-card")
    .forEach(card => card.classList.add("skeleton"));
  document.getElementById("chartWrapper").classList.add("hidden");
}

function hideSkeleton() {
  document.querySelectorAll(".price-card")
    .forEach(card => card.classList.remove("skeleton"));
}

/* =========================
   AUTOCOMPLETE (BACKEND)
========================= */

let debounceTimer;

cityInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const q = cityInput.value.trim();

  if (q.length < 2) {
    suggestionBox.classList.add("hidden");
    return;
  }

  debounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${API}/api/v1/cities?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;

      const cities = await res.json();
      suggestionBox.innerHTML = "";

      cities.forEach(city => {
        const div = document.createElement("div");
        div.textContent = city;
        div.onclick = () => {
          cityInput.value = city;
          suggestionBox.classList.add("hidden");
          fetchPrice();
        };
        suggestionBox.appendChild(div);
      });

      suggestionBox.classList.remove("hidden");
    } catch {}
  }, 250);
});

document.addEventListener("mousedown", e => {
  if (!e.target.closest(".autocomplete-wrapper"))
    suggestionBox.classList.add("hidden");
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
function generateDailyInsight(city, history, karat = "24K") {
  const COPY = DAILY_INSIGHT_COPY[INSIGHT_VARIANT];

  // Fallback when data is insufficient
  if (!history || history.length < 2) {
    return COPY.FALLBACK(city);
  }

  // Ensure oldest → newest
  const ordered = [...history].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  const prices = ordered.map(h => h[karat]);
  const today = prices[prices.length - 1];
  const yesterday = prices[prices.length - 2];

  const min7 = Math.min(...prices);
  const max7 = Math.max(...prices);

  if (today === max7 && today !== yesterday) {
    return COPY.HIGH(city);
  }

  if (today === min7 && today !== yesterday) {
    return COPY.LOW(city);
  }

  if (today > yesterday) {
    return COPY.UP(city);
  }

  if (today < yesterday) {
    return COPY.DOWN(city);
  }

  return COPY.FLAT(city);
}




/* =========================
   MAIN FETCH
========================= */

async function fetchPrice() {
  let city = cityInput.value.trim();
  if (!city) {
    setStatus("Please enter a city");
    return;
  }
document.getElementById("insight")?.classList.add("hidden");
  city = city
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());

  setLoading(true);
  setStatus("Loading latest prices…");
  showSkeleton();

  if (!navigator.onLine) {
    const cached = loadCache(city);
    hideSkeleton();

    if (cached) {
      renderData(cached);
      setStatus("Offline — showing saved prices");
    } else {
      setStatus("Offline — no saved data");
    }

    setLoading(false);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${API}/api/v1/gold/full?city=${encodeURIComponent(city)}`,
      { signal: controller.signal }
    );

    if (!res.ok) {
      if (res.status === 404) throw new Error("CITY_NOT_FOUND");
      throw new Error("SERVER_ERROR");
    }

    const data = await res.json();
    saveCache(data.city, data);
    renderData(data);

    const newPath =
      `/${data.city.toLowerCase().replace(/\s+/g, "-")}-gold-rate`;
    if (window.location.pathname !== newPath) {
      history.pushState({}, "", newPath);
    }

    setStatus("");
  } catch (err) {
    hideSkeleton();

    if (!navigator.onLine)
      setStatus("You’re offline");
    else if (err.name === "AbortError")
      setStatus("Server timeout. Try again.");
    else if (err.message === "CITY_NOT_FOUND")
      setStatus("City not supported yet");
    else
      setStatus("Service temporarily unavailable");
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
  showPrices();

  // ✅ SEO updates
  updateSEO(data.city);
  updateCanonical(data.city);
  updateGoldSchema(data);

// ✅ SEO HTML enhancement
const seoCityEl = document.getElementById("seoCity");
if (seoCityEl) {
  seoCityEl.textContent = data.city;
}

const seoCityTextEl = document.getElementById("seoCityText");
if (seoCityTextEl) {
  seoCityTextEl.textContent = data.city;
}


  document.getElementById("pageHeading").textContent =
    `${data.city} Gold Price`;

  /* ===== DAILY INSIGHT (RUN ONCE) ===== */
  const insightEl = document.getElementById("insight");
  const insight = generateDailyInsight(
    data.city,
    data.history,
    "24K"
  );

  if (insight) {
    insightEl.textContent = insight;
    insightEl.classList.remove("hidden");
  } else {
    insightEl.classList.add("hidden");
  }
  /* =================================== */

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
    data.history.map(h => ({
      date: h.date,
      price: h[currentKarat]
    }))
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
   KARAT TOGGLE
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
