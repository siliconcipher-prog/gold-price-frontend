/* =========================
   CONFIG
========================= */

let slabsData = null;
let citySlabMap = null;
let citiesList = null;
let slabsLastUpdated = "";

let chart;
let portfolioValueChart;
let currentKarat = "24K";
let currentWeight = 1;
let currentRange = 7;
let currentPrices = null;
let currentData = null;
let isLoading = false;
let lastWeightToggleAt = 0;
const ANALYSIS_WINDOW_DAYS = 30;
const PORTFOLIO_STORAGE_KEY = "goldPortfolio_v1";
const LEGACY_PORTFOLIO_STORAGE_KEY = "goldPortfolio";

const WEIGHT_TOGGLE_DEBOUNCE_MS = 220;
const PRICE_ANIMATION_MS = 340;
const ESTIMATOR_ANIMATION_MS = 320;
const CHART_ANIMATION_MS = 360;
const WEIGHT_TOGGLE_LOCK_MS = CHART_ANIMATION_MS + 80;
const MIN_REFRESH_SPINNER_MS = 350;
const priceAnimationFrames = new WeakMap();
const estimatorAnimationFrames = new WeakMap();
let weightToggleLockTimer = null;
let isWeightToggleLocked = false;

/* =========================
   DAILY INSIGHT COPY
========================= */

const INSIGHT_VARIANT = "A";

const DAILY_INSIGHT_COPY = {
  A: {
    UP: city => `\uD83D\uDCC8 Gold prices moved higher today in ${city}.`,
    DOWN: city => `\uD83D\uDCC9 Gold prices declined today in ${city}.`,
    FLAT: city => `\u2796 Gold prices remained largely unchanged today in ${city}.`,
    HIGH: city => `\uD83D\uDCC8 Gold prices are at a 7-day high in ${city}.`,
    LOW: city => `\uD83D\uDCC9 Gold prices are at a 7-day low in ${city}.`,
    FALLBACK: city => `\u2139\uFE0F Showing the latest available gold price for ${city}.`
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
let isAutocompleteOpen = false;
let isAutocompleteLoading = false;

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

// function getCityFromURL() {
//   const match = window.location.pathname.match(/^\/([a-z-]+)-gold-rate$/);
//   if (!match) return null;

//   return match[1]
//     .split("-")
//     .map(w => w.charAt(0).toUpperCase() + w.slice(1))
//     .join(" ");
// }
function getCityFromURL() {
  const path = window.location.pathname;

  const match =
    path.match(/^\/([a-z-]+)-gold-rate$/) ||
    path.match(/^\/cities\/([a-z-]+)-gold-rate\/?$/);

  if (!match) return null;

  return match[1]
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}


/* =========================
   CACHE
========================= */

function cacheKey(city) {
  return `gold:${city.toLowerCase()}`;
}

function saveCache(city, data) {
  const payload = {
    data,
    cachedAt: Date.now()
  };

  localStorage.setItem(
    cacheKey(city),
    JSON.stringify(payload)
  );

  localStorage.setItem("lastCity", city);
}

function loadCache(city) {
  const raw = localStorage.getItem(cacheKey(city));
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw);
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    if (!payload.cachedAt) return null;

    if (Date.now() - payload.cachedAt > CACHE_TTL) {
      localStorage.removeItem(cacheKey(city));
      return null;
    }

    return payload.data;
  } catch (err) {
    console.warn("Cache parse error", err);
    localStorage.removeItem(cacheKey(city));
    return null;
  }
}

async function loadData() {
  try {
    if (!slabsData) {
      const res = await fetch("https://rxdmyncafckkpmizpcgu.supabase.co/storage/v1/object/public/data/slabs.json", {
        cache: "no-store"
      });
      if (!res.ok) throw new Error("SLABS_FETCH_FAILED");
      const json = await res.json();
      slabsData = json.slabs || {};
      slabsLastUpdated = json.last_updated || "";
    }

    if (!citySlabMap) {
      const res = await fetch("https://rxdmyncafckkpmizpcgu.supabase.co/storage/v1/object/public/data/city-slab-map.json", {
        cache: "no-store"
      });
      if (!res.ok) throw new Error("CITY_MAP_FETCH_FAILED");
      citySlabMap = await res.json();
    }

    if (!citiesList) {
      const res = await fetch("https://rxdmyncafckkpmizpcgu.supabase.co/storage/v1/object/public/data/cities.json", {
        cache: "no-store"
      });
      if (!res.ok) throw new Error("CITIES_FETCH_FAILED");
      citiesList = await res.json();
    }
  } catch (err) {
    console.error("Failed to load static data:", err);
    throw err;
  }
}

function getCityMapKey(city) {
  const normalized = String(city || "").trim().toLowerCase();
  if (!normalized) return "";

  const candidates = [
    normalized,
    normalized.replace(/\s+/g, "-"),
    normalized.replace(/\s+/g, ""),
    normalized.replace(/[^a-z0-9]/g, "")
  ];

  return candidates.find(k => citySlabMap && citySlabMap[k]) || candidates[0];
}

async function loadCities() {
  await loadData();
  return Array.isArray(citiesList) ? citiesList : [];
}

async function getCityPrice(city) {
  await loadData();

  const key = getCityMapKey(city);
  const slab = citySlabMap[key];

  if (!slab) {
    console.error("City not mapped:", city);
    return null;
  }

  const slabData = slabsData[slab];
  if (!slabData) {
    console.error("Slab not found:", slab);
    return null;
  }

  const history = Array.isArray(slabData.history)
    ? [...slabData.history].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      )
    : [];
  const latest = history.at(-1) || null;
  const current = latest
    ? {
        "24K": Number(latest["24K"]),
        "22K": Number(latest["22K"]),
        "18K": Number(latest["18K"])
      }
    : slabData.current;

  return {
    city,
    slab,
    prices: current,
    current,
    history,
    last_updated: slabsLastUpdated || new Date().toISOString()
  };
}

function clearOldCaches() {
  const prefix = "gold:";

  Object.keys(localStorage).forEach(key => {
    if (!key.startsWith(prefix)) return;

    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (!value.cachedAt) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  });
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
  isLoading = flag;
  refreshBtn.disabled = flag;
  refreshBtn.classList.toggle("loading", flag);
  setWeightToggleDisabled(flag || isWeightToggleLocked);
}

function setAutocompleteLoading(flag) {
  isAutocompleteLoading = flag;
  if (isLoading) return;
  refreshBtn.classList.toggle("loading", flag);
}

function formatRupee(value) {
  return `\u20B9${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function toPaise(value) {
  return Math.round(Number(value) * 100);
}

function fromPaise(value) {
  return Number(value) / 100;
}

function scalePrice(value) {
  // Always derive from base price using paise math to prevent drift on repeated toggles.
  return fromPaise(toPaise(value) * currentWeight);
}

function setWeightToggleDisabled(flag) {
  document.querySelectorAll(".weight-btn").forEach(btn => {
    btn.disabled = flag || isWeightToggleLocked;
  });
}

function lockWeightToggleForTransition() {
  isWeightToggleLocked = true;
  setWeightToggleDisabled(true);

  if (weightToggleLockTimer) {
    clearTimeout(weightToggleLockTimer);
  }

  weightToggleLockTimer = setTimeout(() => {
    isWeightToggleLocked = false;
    setWeightToggleDisabled(isLoading);
    weightToggleLockTimer = null;
  }, WEIGHT_TOGGLE_LOCK_MS);
}
function animatePriceValue(el, toValue) {
  const prev = Number(el.dataset.priceValue ?? toValue);
  const next = Number(toValue);

  if (prev === next) {
    el.textContent = formatRupee(next);
    el.dataset.priceValue = String(next);
    return;
  }

  const activeFrame = priceAnimationFrames.get(el);
  if (activeFrame) cancelAnimationFrame(activeFrame);

  const start = performance.now();
  const delta = next - prev;

  const tick = now => {
    const progress = Math.min((now - start) / PRICE_ANIMATION_MS, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = prev + delta * eased;
    el.textContent = formatRupee(current);

    if (progress < 1) {
      priceAnimationFrames.set(el, requestAnimationFrame(tick));
      return;
    }

    el.dataset.priceValue = String(next);
    priceAnimationFrames.delete(el);
  };

  priceAnimationFrames.set(el, requestAnimationFrame(tick));
}
function updateWeightToggleUI() {
  document.querySelectorAll(".weight-btn").forEach(btn => {
    const isActive = Number(btn.dataset.weight) === currentWeight;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function ensureInsightActions() {
  let actions = document.getElementById("insightActions");
  if (actions) return actions;

  const insightEl = document.getElementById("insight");
  if (!insightEl) return null;

  actions = document.createElement("div");
  actions.id = "insightActions";
  actions.className = "insight-actions";
  insightEl.insertAdjacentElement("afterend", actions);
  return actions;
}

function ensureWeightToggle() {
  if (document.getElementById("weightToggle")) return;

  const actions = ensureInsightActions();
  if (!actions) return;

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
      if (isLoading || isWeightToggleLocked) return;

      const now = Date.now();
      if (now - lastWeightToggleAt < WEIGHT_TOGGLE_DEBOUNCE_MS) return;
      lastWeightToggleAt = now;

      if (currentWeight === weight) return;

      currentWeight = weight;
      updateWeightToggleUI();
      if (currentData) {
        lockWeightToggleForTransition();
        renderData(currentData, { animatePrices: true });
      }
    });

    toggle.appendChild(btn);
  });

  actions.insertAdjacentElement("beforeend", toggle);
}

async function handleShareClick() {
  try {
    if (shouldUseNativeShare()) {
      await navigator.share(getNativeSharePayload());
      return;
    }
    toggleShareMenu();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    toggleShareMenu();
  }
}

function shouldUseNativeShare() {
  if (!navigator.share) return false;

  const ua = navigator.userAgent || "";
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
  const iPadDesktopMode =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return mobileUA || iPadDesktopMode;
}

function getShareContent() {
  const city =
    currentData?.city ||
    getSelectedCity() ||
    getCityFromURL() ||
    "India";
  const title = `Gold Price Today in ${city}`;
  const insightText =
    document.getElementById("insight")?.textContent?.trim() ||
    `Check latest gold prices in ${city}.`;
  const url = window.location.href;
  const sharePrice = karat => {
    const base = getKaratValue(currentData?.prices, karat);
    if (typeof base !== "number") return "-";
    return formatRupee(scalePrice(base));
  };
  const resolveDiff = karat => {
    const historyChange = calculateChange(currentData?.history, karat);
    if (historyChange && !Number.isNaN(Number(historyChange.diff))) {
      return Number(historyChange.diff);
    }

    // Fallback when history may not include every karat key.
    const changeSources = [
      currentData?.changes,
      currentData?.change,
      currentData?.daily_change,
      currentData?.price_change
    ];

    for (const source of changeSources) {
      const diff = getKaratValue(source, karat);
      if (diff !== null && !Number.isNaN(Number(diff))) {
        return Number(diff);
      }
    }

    return null;
  };
  const formatChange = karat => {
    const diff = resolveDiff(karat);
    if (diff === null) return "";
    if (diff === 0) return " (\u00B1\u20B90)";
    const prefix = diff > 0 ? "+" : "-";
    return ` (${prefix}${formatRupee(Math.abs(scalePrice(diff)))})`;
  };
  const unitLabel = `${currentWeight}g`;
  const linesWithoutUrl = [
    title,
    "",
    `Rate shown per ${unitLabel}`,
    "",
    `24K (${unitLabel}): ${sharePrice("24K")}${formatChange("24K")}`,
    `22K (${unitLabel}): ${sharePrice("22K")}${formatChange("22K")}`,
    `18K (${unitLabel}): ${sharePrice("18K")}${formatChange("18K")}`,
    "",
    insightText,
    "",
    "Check gold price for your city:"
  ];

  return {
    title,
    city,
    unitLabel,
    linesWithoutUrl,
    url
  };
}

function getNativeSharePayload() {
  const content = getShareContent();

  return {
    title: content.title,
    text: content.linesWithoutUrl.join("\n"),
    url: content.url
  };
}

function getExtendedShareText() {
  const content = getShareContent();
  return `${content.linesWithoutUrl.join("\n")}\n${content.url}`;
}

function getCityGoldHashtag(city) {
  const normalized = (city || "India")
    .replace(/[^a-zA-Z\s]/g, " ")
    .trim()
    .split(/\s+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  return `#${normalized || "India"}Gold`;
}

function getShareMenu() {
  return document.getElementById("shareMenu");
}

function getShareButton() {
  return document.getElementById("shareBtn");
}

function setShareMenuOpen(open) {
  const menu = getShareMenu();
  const btn = getShareButton();
  if (!menu || !btn) return;

  menu.classList.toggle("hidden", !open);
  btn.classList.toggle("active", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeShareMenu() {
  setShareMenuOpen(false);
}

function toggleShareMenu() {
  const menu = getShareMenu();
  if (!menu) return;
  setShareMenuOpen(menu.classList.contains("hidden"));
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function ensureShareButton() {
  if (document.getElementById("shareBtn")) return;

  const actions = ensureInsightActions();
  if (!actions) return;

  const shareAction = document.createElement("div");
  shareAction.className = "share-action";

  const btn = document.createElement("button");
  btn.id = "shareBtn";
  btn.className = "share-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Share this page");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-haspopup", "menu");

  const icon = document.createElement("span");
  icon.className = "share-icon";
  icon.textContent = "\u2934";
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(" Share"));

  btn.addEventListener("click", handleShareClick);

  const note = document.createElement("span");
  note.className = "share-note";
  note.textContent = "Share today's gold price";

  const menu = document.createElement("div");
  menu.id = "shareMenu";
  menu.className = "share-menu hidden";

  const shareXBtn = document.createElement("button");
  shareXBtn.type = "button";
  shareXBtn.className = "share-menu-btn";
  shareXBtn.textContent = "Share on X";
  shareXBtn.addEventListener("click", () => {
    const shareText = getExtendedShareText();
    const city =
      currentData?.city ||
      getSelectedCity() ||
      getCityFromURL() ||
      "India";
    const hashtags =
      `#GoldPrice #GoldRateToday ${getCityGoldHashtag(city)}`;
    const intentUrl =
      `https://x.com/intent/tweet?text=${encodeURIComponent(
        `${shareText}\n\n${hashtags}`
      )}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
    closeShareMenu();
  });

  const copyLinkBtn = document.createElement("button");
  copyLinkBtn.type = "button";
  copyLinkBtn.className = "share-menu-btn";
  copyLinkBtn.textContent = "Copy link";
  copyLinkBtn.addEventListener("click", async () => {
    try {
      await copyText(window.location.href);
      setStatus("Link copied");
      setTimeout(() => {
        if (statusEl.textContent === "Link copied") setStatus("");
      }, 1200);
    } catch {
      setStatus("Could not copy link");
    } finally {
      closeShareMenu();
    }
  });

  const copyUpdateBtn = document.createElement("button");
  copyUpdateBtn.type = "button";
  copyUpdateBtn.className = "share-menu-btn";
  copyUpdateBtn.textContent = "Copy update";
  copyUpdateBtn.addEventListener("click", async () => {
    try {
      await copyText(getExtendedShareText());
      setStatus("Update copied");
      setTimeout(() => {
        if (statusEl.textContent === "Update copied") setStatus("");
      }, 1400);
    } catch {
      setStatus("Could not copy update");
    } finally {
      closeShareMenu();
    }
  });

  const shareWhatsAppBtn = document.createElement("button");
  shareWhatsAppBtn.type = "button";
  shareWhatsAppBtn.className = "share-menu-btn";
  shareWhatsAppBtn.textContent = "Share on WhatsApp";
  shareWhatsAppBtn.addEventListener("click", () => {
    const waUrl =
      `https://wa.me/?text=${encodeURIComponent(getExtendedShareText())}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
    closeShareMenu();
  });

  menu.appendChild(shareXBtn);
  menu.appendChild(shareWhatsAppBtn);
  menu.appendChild(copyUpdateBtn);
  menu.appendChild(copyLinkBtn);
  shareAction.appendChild(btn);
  shareAction.appendChild(note);
  shareAction.appendChild(menu);
  actions.insertAdjacentElement("afterbegin", shareAction);
}
function showSkeleton() {
  const prices = document.getElementById("prices");
  const priceSkeleton = document.getElementById("priceSkeleton");
  if (prices) prices.classList.add("hidden");
  if (priceSkeleton) priceSkeleton.classList.remove("hidden");
  const chartWrapper = document.getElementById("chartWrapper");
  chartWrapper.classList.remove("hidden");
  chartWrapper.classList.add("chart-loading");
}

function hideSkeleton() {
  const prices = document.getElementById("prices");
  const priceSkeleton = document.getElementById("priceSkeleton");
  if (prices) prices.classList.remove("hidden");
  if (priceSkeleton) priceSkeleton.classList.add("hidden");
  document.getElementById("chartWrapper").classList.remove("chart-loading");
}

function setRangeButtonsLoading(loading) {
  document.querySelectorAll(".range-btn").forEach(btn => {
    const isCurrent = Number(btn.dataset.range) === currentRange;
    btn.classList.toggle("loading", loading && isCurrent);
  });
}

function ensureMonthlyStatsSection() {
  let section = document.getElementById("monthlyStats");
  if (section) return section;

  const chartWrapper = document.getElementById("chartWrapper");
  if (!chartWrapper) return null;

  section = document.createElement("section");
  section.id = "monthlyStats";
  section.className = "monthly-stats";
  section.innerHTML = `
    <h3>Monthly Gold Stats</h3>
    <p id="statsSubtitle">India • 24K • per gram</p>
    <div class="stats-grid">
      <div class="stat-card">
        <span>High</span>
        <strong id="mHigh">-</strong>
      </div>
      <div class="stat-card">
        <span>Low</span>
        <strong id="mLow">-</strong>
      </div>
      <div class="stat-card">
        <span>Average</span>
        <strong id="mAvg">-</strong>
      </div>
      <div class="stat-card">
        <span>Monthly Change</span>
        <strong id="mChange">-</strong>
      </div>
      <div class="stat-card">
        <span>Volatility</span>
        <strong id="mVolatility">-</strong>
      </div>
    </div>
  `;

  const estimator = document.getElementById("estimator");
  if (estimator) {
    estimator.parentNode.insertBefore(section, estimator);
  } else {
    chartWrapper.insertAdjacentElement("afterend", section);
  }

  return section;
}

function ensurePortfolioSection() {
  let section = document.getElementById("portfolioSection");
  if (section) return section;

  const pricingGuide = document.querySelector(".pricing-guide");
  const estimator = document.getElementById("estimator");
  if (!pricingGuide && !estimator) return null;

  section = document.createElement("section");
  section.id = "portfolioSection";
  section.className = "portfolio-section";
  section.innerHTML = `
    <div class="portfolio-head">
      <div>
        <h3>My Gold Portfolio</h3>
        <p class="portfolio-note">Track the current value of the gold you own.</p>
      </div>
      <button id="openPortfolioModal" class="portfolio-add-btn" type="button">Add Gold Item</button>
    </div>

    <div class="portfolio-dashboard">
      <div class="portfolio-main">
        <span class="label">Portfolio Value</span>
        <h2 id="portfolioCurrentValue">₹0</h2>
        <div class="portfolio-profit">
          <span id="portfolioProfitLoss">₹0</span>
          <span id="portfolioProfitPercent">(0%)</span>
        </div>
        <div id="portfolioTodayChange" class="portfolio-today-change hidden"></div>
      </div>

      <div class="portfolio-secondary">
        <div class="mini-card">
          <span>Total Gold</span>
          <strong id="portfolioTotalWeight">0 g</strong>
        </div>

        <div class="mini-card">
          <span>Total Investment</span>
          <strong id="portfolioTotalInvestment">₹0</strong>
        </div>
      </div>
    </div>

    <div id="portfolioValueChartWrap" class="portfolio-chart hidden">
      <canvas id="portfolioValueChart"></canvas>
    </div>

    <div id="portfolioBreakdown" class="portfolio-breakdown"></div>
    <div id="portfolioList" class="portfolio-list"></div>

    <div id="portfolioAllocationWrap" class="portfolio-allocation hidden">
      <h4>Gold Allocation</h4>
      <div class="alloc-row">
        <span>22K</span>
        <div class="alloc-bar">
          <div id="alloc22" class="alloc-fill"></div>
        </div>
        <span id="alloc22Percent">0%</span>
      </div>
      <div class="alloc-row">
        <span>24K</span>
        <div class="alloc-bar">
          <div id="alloc24" class="alloc-fill"></div>
        </div>
        <span id="alloc24Percent">0%</span>
      </div>
      <div class="alloc-row">
        <span>18K</span>
        <div class="alloc-bar">
          <div id="alloc18" class="alloc-fill"></div>
        </div>
        <span id="alloc18Percent">0%</span>
      </div>
    </div>
  `;

  if (pricingGuide && pricingGuide.parentNode) {
    pricingGuide.parentNode.insertBefore(section, pricingGuide);
  } else if (estimator && estimator.parentNode) {
    estimator.insertAdjacentElement("afterend", section);
  }

  return section;
}

function ensurePortfolioModal() {
  let modal = document.getElementById("portfolioModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "portfolioModal";
  modal.className = "portfolio-modal hidden";
  modal.innerHTML = `
    <div class="portfolio-modal-card">
      <div class="portfolio-modal-head">
        <h4>Add Gold Item</h4>
        <button id="closePortfolioModal" class="portfolio-close-btn" type="button" aria-label="Close portfolio modal">Close</button>
      </div>

      <form id="portfolioForm" class="portfolio-form">
        <label>
          <span>Name</span>
          <input id="portfolioName" type="text" placeholder="Wedding Ring" required>
        </label>

        <label>
          <span>Weight (grams)</span>
          <input id="portfolioWeight" type="number" min="0.01" step="0.01" placeholder="10" required>
        </label>

        <label>
          <span>Karat</span>
          <select id="portfolioKarat" required>
            <option value="24K">24K</option>
            <option value="22K" selected>22K</option>
            <option value="18K">18K</option>
          </select>
        </label>

        <label>
          <span>Buy Price</span>
          <input id="portfolioBuyPrice" type="number" min="0" step="0.01" placeholder="6200" required>
        </label>

        <p id="portfolioFormWarning" class="portfolio-form-warning hidden"></p>

        <label>
          <span>Buy Date</span>
          <input id="portfolioBuyDate" type="date" required>
        </label>

        <div class="portfolio-form-actions">
          <button type="button" id="cancelPortfolioModal" class="portfolio-secondary-btn">Cancel</button>
          <button type="submit" class="portfolio-primary-btn">Save</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function ensureMainTabs() {
  const container = document.querySelector(".container");
  const subtitle = document.querySelector(".subtitle");
  if (!container || !subtitle) return null;

  let tabs = document.querySelector(".main-tabs");
  if (!tabs) {
    tabs = document.createElement("div");
    tabs.className = "main-tabs";
    tabs.innerHTML = `
      <button class="tab-btn active" data-tab="price" type="button">Price</button>
      <button class="tab-btn" data-tab="calculator" type="button">Calculator</button>
      <button class="tab-btn" data-tab="portfolio" type="button">Portfolio</button>
    `;
    subtitle.insertAdjacentElement("afterend", tabs);
  }

  const ensureTabContent = (id, sections, active) => {
    let panel = document.getElementById(id);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = id;
      panel.className = `tab-content${active ? " active" : ""}`;
      const anchor = sections.find(section => section && section.parentNode);
      if (anchor?.parentNode) {
        anchor.parentNode.insertBefore(panel, anchor);
      } else {
        container.appendChild(panel);
      }
    }

    sections.forEach(section => {
      if (section && section.parentNode !== panel) {
        panel.appendChild(section);
      }
    });

    return panel;
  };

  ensureMonthlyStatsSection();
  ensurePortfolioSection();

  const priceSections = [
    document.querySelector(".insight-block"),
    document.getElementById("meta"),
    document.getElementById("chartWrapper"),
    document.getElementById("monthlyStats")
  ];
  const calculatorSections = [
    document.getElementById("estimateJump"),
    document.getElementById("estimator"),
    document.querySelector(".pricing-guide")
  ];
  const portfolioSections = [
    document.getElementById("portfolioSection")
  ];

  ensureTabContent("tab-price", priceSections, true);
  ensureTabContent("tab-calculator", calculatorSections, false);
  ensureTabContent("tab-portfolio", portfolioSections, false);

  return tabs;
}

function initMainTabs() {
  const tabsWrap = ensureMainTabs();
  if (!tabsWrap) return;

  const tabs = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  if (!tabs.length || !tabContents.length) return;

  tabs.forEach(tab => {
    if (tab.dataset.bound === "true") return;
    tab.dataset.bound = "true";

    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(content => content.classList.remove("active"));

      tab.classList.add("active");
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) {
        target.classList.add("active");
      }
    });
  });
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
    showAutocompleteSkeleton();
    setStatus("");
    setAutocompleteLoading(true);

    try {
      const allCities = await loadCities();
      if (cityInput.value.trim() !== q) return;
      const query = q.toLowerCase();
      const cities = allCities
        .filter(city => city.toLowerCase().includes(query))
        .slice(0, 20);

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
      showAutocompleteError(
        "Unable to load city suggestions. Please try again."
      );
    } finally {
      setAutocompleteLoading(false);
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

  const prev = getKaratValue(history[history.length - 2], karat);
  const curr = getKaratValue(history[history.length - 1], karat);
  if (prev === null || curr === null) return null;

  const diff = curr - prev;
  const percent = ((diff / prev) * 100).toFixed(2);
  return { diff, percent };
}

function getKaratValue(source, karat) {
  if (!source || !karat) return null;

  const key = String(karat);
  const compact = key.replace(/\s+/g, "");
  const lower = compact.toLowerCase();
  const digits = lower.replace(/[^0-9]/g, "");
  const candidates = [
    key,
    compact,
    lower,
    compact.toUpperCase(),
    digits,
    `${digits}k`,
    `${digits}K`,
    `k${digits}`,
    `K${digits}`
  ];

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(source, candidate)) {
      const value = Number(source[candidate]);
      if (!Number.isNaN(value)) return value;
    }
  }

  return null;
}

function generateDailyInsight(city, history, karat) {
  if (!history || history.length < 2)
    return `Showing latest gold price in ${city}.`;

  const prices = history.map(h => h[karat]);
  const today = prices.at(-1);
  const yesterday = prices.at(-2);

  const max = Math.max(...prices);
  const min = Math.min(...prices);

  const diff = today - yesterday;
  const percent = ((diff / yesterday) * 100);

  if (today === max)
    return `🔴 Gold is at a ${currentRange}-day high in ${city}.`;

  if (today === min)
    return `🟢 Gold is at a ${currentRange}-day low in ${city}.`;

  if (percent > 2)
    return `📈 Strong upward momentum (${percent.toFixed(2)}%).`;

  if (percent < -2)
    return `📉 Sharp drop detected (${percent.toFixed(2)}%).`;

  if (diff > 0)
    return `📈 Gold prices moved higher today in ${city}.`;

  if (diff < 0)
    return `📉 Gold prices declined today in ${city}.`;

  return `➖ Gold prices remained stable in ${city}.`;
}

function getAnalysisHistory(history) {
  if (!Array.isArray(history) || !history.length) return [];
  return history.slice(-ANALYSIS_WINDOW_DAYS);
}

function getMarketAnalysis(history, karat) {
  const analysisHistory = getAnalysisHistory(history);
  const prices = analysisHistory
    .map(h => getKaratValue(h, karat))
    .filter(v => typeof v === "number" && Number.isFinite(v));

  if (prices.length < 2) {
    return {
      today: 0,
      yesterday: 0,
      price7DaysAgo: 0,
      min: 0,
      max: 0,
      weeklyLow: 0,
      weeklyHigh: 0,
      monthlyLow: 0,
      monthlyHigh: 0,
      score: 50,
      zone: "MID RANGE",
      trend: "SIDEWAYS",
      trendSentence: "stable momentum",
      volatility: "LOW VOLATILITY",
      volatilitySentence: "low",
      signal: "WATCH MARKET",
      signalSentence: "market watch conditions"
    };
  }

  const today = prices.at(-1);
  const yesterday = prices.at(-2) ?? today;
  const price7DaysAgo = prices.length >= 7 ? prices.at(-7) : prices[0];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const recent7 = prices.slice(-7);
  const weeklyLow = Math.min(...recent7);
  const weeklyHigh = Math.max(...recent7);
  const movingAvg30 =
    prices.reduce((sum, p) => sum + p, 0) / prices.length;

  let score = 50;
  if (range > 0) {
    score = ((today - min) / range) * 100;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let zone = "MID RANGE";
  if (score < 35) zone = "LOW ZONE";
  else if (score > 65) zone = "HIGH ZONE";

  let trend = "SIDEWAYS";
  let trendSentence = "stable momentum";
  const maDeltaPct = movingAvg30 > 0
    ? ((today - movingAvg30) / movingAvg30) * 100
    : 0;

  if (maDeltaPct > 3) {
    trend = "STRONG UPTREND";
    trendSentence = "strong upward momentum";
  } else if (maDeltaPct > 1) {
    trend = "UPTREND";
    trendSentence = "moderate upward momentum";
  } else if (maDeltaPct < -1) {
    trend = "DOWNTREND";
    trendSentence = "downward momentum";
  }

  const dailyPctChanges = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0) {
      dailyPctChanges.push(((curr - prev) / prev) * 100);
    }
  }

  let volatilityStd = 0;
  if (dailyPctChanges.length) {
    const mean =
      dailyPctChanges.reduce((sum, v) => sum + v, 0) /
      dailyPctChanges.length;
    const variance =
      dailyPctChanges.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      dailyPctChanges.length;
    volatilityStd = Math.sqrt(variance);
  }

  let volatility = "LOW VOLATILITY";
  let volatilitySentence = "low";
  if (volatilityStd > 2) {
    volatility = "EXTREME VOLATILITY";
    volatilitySentence = "extreme";
  } else if (volatilityStd > 1.2) {
    volatility = "HIGH VOLATILITY";
    volatilitySentence = "high";
  } else if (volatilityStd >= 0.5) {
    volatility = "MODERATE VOLATILITY";
    volatilitySentence = "moderate";
  } else {
    volatility = "LOW VOLATILITY";
    volatilitySentence = "low";
  }

  const isUptrend = trend === "UPTREND" || trend === "STRONG UPTREND";
  let signal = "WATCH MARKET";
  let signalSentence = "market watch conditions";

  if (trend === "DOWNTREND") {
    signal = "WAIT BEFORE BUYING";
    signalSentence = "wait-before-buying conditions";
  } else if (zone === "HIGH ZONE") {
    signal = "PRICES ELEVATED";
    signalSentence = "prices may be overheated";
  } else if (zone === "LOW ZONE" && isUptrend) {
    signal = "GOOD BUY WINDOW";
    signalSentence = "a favorable buying window";
  } else if (zone === "MID RANGE" && isUptrend) {
    signal = "WATCH MARKET";
    signalSentence = "a market watch phase";
  }

  return {
    today,
    yesterday,
    price7DaysAgo,
    min,
    max,
    weeklyLow,
    weeklyHigh,
    monthlyLow: min,
    monthlyHigh: max,
    score,
    zone,
    trend,
    trendSentence,
    volatility,
    volatilitySentence,
    signal,
    signalSentence
  };
}

function generateMarketSummary(data) {
  const {
    today: currentPrice,
    yesterday: yesterdayPrice,
    monthlyLow,
    monthlyHigh
  } = data;

  const dailyChange = currentPrice - yesterdayPrice;
  const monthlyRange = monthlyHigh - monthlyLow;
  const rangePosition = monthlyRange > 0
    ? (currentPrice - monthlyLow) / monthlyRange
    : 0.5;

  const isFlat = Math.abs(dailyChange) < 0.001;
  const indicator = isFlat ? "➡" : dailyChange > 0 ? "⬆" : "⬇";
  const movement = isFlat
    ? "holds steady"
    : dailyChange > 0
      ? "rises"
      : "falls";

  const context =
    rangePosition < 0.25
      ? "near monthly lows"
      : rangePosition > 0.75
        ? "near monthly highs"
        : "near mid-range";

  const headline = `${indicator} Gold ${movement} ${context}`;
  return headline.length <= 60
    ? headline
    : "➡ Gold holds steady near mid-range";
}

function generateInsightBadges(history, karat, insightText) {
  void insightText;
  const analysis = getMarketAnalysis(history, karat);

  const zoneType =
    analysis.zone === "LOW ZONE"
      ? "green"
      : analysis.zone === "HIGH ZONE"
        ? "red"
        : "blue";

  const trendType =
    analysis.trend === "DOWNTREND"
      ? "red"
      : analysis.trend === "SIDEWAYS"
        ? "blue"
        : "green";

  const volatilityType =
    analysis.volatility === "EXTREME VOLATILITY"
      ? "red"
      : analysis.volatility === "HIGH VOLATILITY"
        ? "yellow"
        : analysis.volatility === "MODERATE VOLATILITY"
          ? "blue"
          : "green";

  const signalType =
    analysis.signal === "GOOD BUY WINDOW"
      ? "green"
      : analysis.signal === "WATCH MARKET"
        ? "blue"
        : analysis.signal === "PRICES ELEVATED"
          ? "yellow"
          : "red";

  return [
    { text: analysis.zone, type: zoneType },
    { text: analysis.volatility, type: volatilityType },
    { text: analysis.trend, type: trendType },
    { text: analysis.signal, type: signalType }
  ];
}

function calculateGoldScore(history, karat) {
  const analysisHistory = getAnalysisHistory(history);
  if (!analysisHistory || analysisHistory.length < 2) return 50;

  const prices = analysisHistory
    .map(h => getKaratValue(h, karat))
    .filter(v => typeof v === "number" && Number.isFinite(v));
  if (prices.length < 2) return 50;

  const currentPrice = prices.at(-1);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  if (maxPrice === minPrice) return 50;

  const score =
    ((currentPrice - minPrice) / (maxPrice - minPrice)) * 100;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function formatUpdatedTimestamp(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function updateBreadcrumb(city) {
  const cityEl = document.getElementById("breadcrumbCity");
  const sepEl = document.getElementById("breadcrumbSeparator");

  if (!cityEl || !sepEl) return;

  if (city === "India") {
    // Homepage / India page -> single breadcrumb
    cityEl.textContent = "";
    sepEl.style.display = "none";
  } else {
    // City page
    cityEl.textContent = city;
    sepEl.style.display = "inline";
  }
}

function syncCityURL(city) {
  const slug = city.toLowerCase().replace(/\s+/g, "-");
  const nextURL = slug === "india" ? "/" : `/${slug}-gold-rate`;

  if (window.location.pathname === "/" && slug !== "india") {
    window.location.href = nextURL;
    return true;
  }

  if (
    window.location.pathname !== "/" &&
    window.location.pathname !== nextURL
  ) {
    window.location.href = nextURL;
    return true;
  }

  return false;
}



/* =========================
   FETCH
========================= */
async function fetchPrice(options = {}) {
  const { smoothRange = false, forceRefresh = false } = options;
  closeAutocomplete();
  const startedAt = Date.now();

  // 1) Resolve city (CORRECT priority)
  let city = getSelectedCity();

  // If user didn't type/select, try URL
  if (!city) {
    city = getCityFromURL() || "";
  }

  // If still empty -> only then default to India
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

// Sync input only if user did not type
if (cityInput && !getSelectedCity()) {
  cityInput.value = city;
}

  if (smoothRange) {
    setStatus("");
    document.getElementById("chartWrapper").classList.add("chart-loading");
    setRangeButtonsLoading(true);
  } else {
    setLoading(true);
    setStatus("Loading latest prices...");
    showSkeleton();
  }

  const insightEl = document.getElementById("insight");
  if (!smoothRange) {
    insightEl.textContent = "Checking today's gold price...";
    insightEl.classList.remove("hidden");
  }

  try {
    const cached = forceRefresh ? null : loadCache(city);
    if (cached && Array.isArray(cached.history) && cached.history.length) {
      renderData(cached, { animatePrices: smoothRange });
      updateBreadcrumb(cached.city);
      if (syncCityURL(cached.city)) return;
      setStatus("");
      return;
    }

    const data = await getCityPrice(city);
    if (!data) throw new Error("CITY_NOT_FOUND");

    saveCache(data.city, data);
    renderData(data);
    updateBreadcrumb(data.city);

    // 2) URL update (India = root)
    if (syncCityURL(data.city)) return;

    setStatus("");
  } catch (err) {
    hideSkeleton();
    setStatus(
      err.message === "CITY_NOT_FOUND"
        ? "City not supported yet"
        : "Something went wrong. Please try again."
    );
  } finally {
    if (!smoothRange && forceRefresh) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_REFRESH_SPINNER_MS) {
        await new Promise(resolve =>
          setTimeout(resolve, MIN_REFRESH_SPINNER_MS - elapsed)
        );
      }
    }
    setRangeButtonsLoading(false);
    document.getElementById("chartWrapper")
      .classList.remove("chart-loading");
    if (!smoothRange) {
      setLoading(false);
    }
    closeAutocomplete();
  }
}


/* =========================
   RENDER
========================= */

function getScaledHistory(history, karat) {
  if (!history || !history.length) return [];

  return history.map(h => ({
    date: h.date,
    price: scalePrice(h[karat])
  }));
}

function renderData(data, options = {}) {
  const { animatePrices = false } = options;
  currentData = data;
  hideSkeleton();

  document.getElementById("pageHeading").textContent =
    `${data.city} Gold Price`;

  const insightEl = document.getElementById("insight");
  if (!data.history || data.history.length === 0) {
    insightEl.textContent = `Showing today's gold price for ${data.city}`;
  } else {
    const analysis = getMarketAnalysis(data.history, currentKarat);
    const quickSummary = generateMarketSummary(analysis);
    insightEl.innerHTML =
      `${quickSummary}<span class="insight-footnote">Based on the last 30 days of gold price trends.</span>`;
  }
  insightEl.classList.remove("hidden");

  const insightMeta = document.getElementById("insightMeta");
  const scoreEl = document.getElementById("goldScore");

  if (insightMeta && scoreEl) {
    const analysis = getMarketAnalysis(data.history, currentKarat);
    const score = analysis.score;
    scoreEl.textContent = `Gold Score ${score}`;
    scoreEl.dataset.tooltip =
      "Gold Score reflects price position within recent range, momentum strength, and volatility. Higher score indicates relatively favorable market conditions based on recent trends.";
    scoreEl.tabIndex = 0;
    scoreEl.setAttribute("aria-label", `Gold Score ${score} out of 100`);
    if (!scoreEl.dataset.tooltipBound) {
      scoreEl.addEventListener("click", () => {
        if (document.activeElement === scoreEl) {
          scoreEl.blur();
        } else {
          scoreEl.focus();
        }
      });
      scoreEl.dataset.tooltipBound = "1";
    }

    const summary = generateMarketSummary(analysis);
    insightEl.innerHTML =
      `${summary}<span class="insight-footnote">Based on the last 30 days of gold price trends.</span>`;

    const insightText = insightEl.textContent;
    const badges = generateInsightBadges(
      data.history,
      currentKarat,
      insightText
    );
    const badgesContainer =
      document.getElementById("insightBadges");

    if (badgesContainer) {
      badgesContainer.innerHTML = "";

      badges.forEach(b => {
        const el = document.createElement("span");
        el.className = `badge ${b.type}`;
        el.textContent = b.text;
        badgesContainer.appendChild(el);
      });
    }

    const signalEl =
      document.getElementById("goldSignal");

    if(signalEl){
      let signalClass = "neutral";
      let signalText = analysis.signal;
      if (analysis.signal === "GOOD BUY WINDOW") {
        signalClass = "good";
        signalText = "Good Buying Opportunity";
      } else if (analysis.signal === "WATCH MARKET") {
        signalClass = "neutral";
        signalText = "Neutral Market";
      } else if (
        analysis.signal === "PRICES ELEVATED" ||
        analysis.signal === "WAIT BEFORE BUYING"
      ) {
        signalClass = "high";
        signalText =
          analysis.signal === "WAIT BEFORE BUYING"
            ? "Wait Before Buying"
            : "Prices Elevated";
      }
      signalEl.textContent = signalText;
      signalEl.className = "gold-signal " + signalClass;

    }

    insightMeta.classList.remove("hidden");
  }

  PRICE_KEYS.forEach(k => {
    const scaledPrice = scalePrice(data.prices[k]);
    const priceEl = document.getElementById("p" + k.slice(0, 2));

    if (animatePrices) {
      animatePriceValue(priceEl, scaledPrice);
    } else {
      priceEl.textContent = formatRupee(scaledPrice);
      priceEl.dataset.priceValue = String(scaledPrice);
    }

    const change = calculateChange(data.history, k);
    const el = document.getElementById("c" + k.slice(0, 2));

    if (!change) {
      el.textContent = "-";
      el.className = "change same";
    } else if (change.diff > 0) {
      const scaledDiff = scalePrice(change.diff);
      el.textContent = `\u2191 ${formatRupee(scaledDiff)} (+${change.percent}%)`;
      el.className = "change down";
    } else {
      const scaledDiff = scalePrice(Math.abs(change.diff));
      el.textContent =
        `\u2193 ${formatRupee(scaledDiff)} (-${Math.abs(change.percent)}%)`;
      el.className = "change up";
    }
  });
  currentPrices = data.prices;
  updateAdvancedCalc();
  updateMonthlyStats(data.history);
  renderPortfolio();

  renderCurrentChart();

  document.getElementById("updated").innerHTML =
    `<span class="updated-main">Updated: ${formatUpdatedTimestamp(data.last_updated)}</span>` +
    `<span class="updated-sub">Unit: ${currentWeight}g</span>`;
}

function getMonthlyStats(history, karat = "24K") {
  if (!Array.isArray(history) || history.length === 0) return null;

  const latestRow = history
    .slice()
    .sort((a, b) =>
      new Date(a.date || a.recorded_on || a.recorded_at) -
      new Date(b.date || b.recorded_on || b.recorded_at)
    )
    .at(-1);
  if (!latestRow) return null;

  const latestDate = new Date(
    latestRow.date || latestRow.recorded_on || latestRow.recorded_at
  );
  if (Number.isNaN(latestDate.getTime())) return null;

  const currentMonth = latestDate.getMonth();
  const currentYear = latestDate.getFullYear();

  const monthRows = history
    .filter(row => {
      const dt = new Date(row.date || row.recorded_on || row.recorded_at);
      return (
        !Number.isNaN(dt.getTime()) &&
        dt.getMonth() === currentMonth &&
        dt.getFullYear() === currentYear
      );
    })
    .sort((a, b) =>
      new Date(a.date || a.recorded_on || a.recorded_at) -
      new Date(b.date || b.recorded_on || b.recorded_at)
    );

  if (!monthRows.length) return null;

  const prices = monthRows
    .map(row => getKaratValue(row, karat))
    .filter(v => typeof v === "number" && Number.isFinite(v));

  if (!prices.length) return null;

  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];
  const change = endPrice - startPrice;
  const range = high - low;

  let volatility = "Low";
  if (range < 100) {
    volatility = "Low";
  } else if (range < 300) {
    volatility = "Medium";
  } else {
    volatility = "High";
  }

  return {
    high,
    low,
    avg,
    change,
    volatility
  };
}

function updateMonthlyStats(history) {
  ensureMonthlyStatsSection();

  const subtitleEl = document.getElementById("statsSubtitle");
  const highEl = document.getElementById("mHigh");
  const lowEl = document.getElementById("mLow");
  const avgEl = document.getElementById("mAvg");
  const changeEl = document.getElementById("mChange");
  const volatilityEl = document.getElementById("mVolatility");

  if (
    !subtitleEl ||
    !highEl ||
    !lowEl ||
    !avgEl ||
    !changeEl ||
    !volatilityEl
  ) return;

  const city =
    currentData?.city ||
    getSelectedCity() ||
    getCityFromURL() ||
    "India";
  subtitleEl.textContent = `${city} • ${currentKarat} • per gram`;

  const stats = getMonthlyStats(history, currentKarat);
  if (!stats) {
    subtitleEl.textContent = `${city} • ${currentKarat} • per gram`;
    highEl.textContent = "-";
    lowEl.textContent = "-";
    avgEl.textContent = "-";
    changeEl.textContent = "-";
    changeEl.className = "";
    volatilityEl.textContent = "-";
    return;
  }

  highEl.textContent = formatRupee(stats.high);
  lowEl.textContent = formatRupee(stats.low);
  avgEl.textContent = formatRupee(stats.avg);

  const signed = stats.change > 0 ? "+" : "";
  changeEl.textContent = `${signed}${formatRupee(stats.change)}`;
  changeEl.className =
    stats.change > 0
      ? "up"
      : stats.change < 0
        ? "down"
        : "";

  volatilityEl.textContent = stats.volatility;
}

function generatePortfolioItemId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `portfolio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function destroyPortfolioCharts() {
  if (portfolioValueChart) {
    portfolioValueChart.destroy();
    portfolioValueChart = null;
  }
}

function renderPortfolioCharts({ totalInvestment, totalCurrentValue, karatBreakdown, showCharts }) {
  const valueWrap = document.getElementById("portfolioValueChartWrap");
  const allocationWrap = document.getElementById("portfolioAllocationWrap");
  const valueCanvas = document.getElementById("portfolioValueChart");

  if (!valueWrap || !allocationWrap || !valueCanvas) {
    return;
  }

  destroyPortfolioCharts();

  if (!showCharts) {
    valueWrap.classList.add("hidden");
    allocationWrap.classList.add("hidden");
    return;
  }

  valueWrap.classList.remove("hidden");
  allocationWrap.classList.remove("hidden");

  portfolioValueChart = new Chart(valueCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: ["Investment", "Current Value"],
      datasets: [{
        data: [totalInvestment, totalCurrentValue],
        backgroundColor: ["rgba(148, 163, 184, 0.75)", "rgba(212, 175, 55, 0.8)"],
        borderColor: ["rgba(148, 163, 184, 1)", "rgba(212, 175, 55, 1)"],
        borderWidth: 1.2,
        borderRadius: 12,
        maxBarThickness: 68
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => formatRupee(context.parsed.y)
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#d1d5db" },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: "#9ca3af",
            callback: value => formatRupee(value)
          },
          grid: { color: "rgba(255,255,255,0.08)" }
        }
      }
    }
  });

}

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_PORTFOLIO_STORAGE_KEY);
      if (!legacy) return [];
      const parsedLegacy = JSON.parse(legacy);
      if (Array.isArray(parsedLegacy)) {
        localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(parsedLegacy));
        return parsedLegacy;
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePortfolio(items) {
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(items));
}

function getPortfolioMarkup(item) {
  const currentPrice = currentPrices?.[item.karat];
  const currentValue =
    typeof currentPrice === "number" ? item.weight * currentPrice : null;
  const invested = item.weight * item.buyPrice;
  const profit =
    typeof currentValue === "number" ? currentValue - invested : null;
  const profitPercent =
    typeof profit === "number" && invested > 0
      ? (profit / invested) * 100
      : null;
  const profitClass =
    profit > 0 ? "up" : profit < 0 ? "down" : "";
  const profitText =
    typeof profit === "number"
      ? `${formatRupee(profit)} (${Math.round(profitPercent)}%)`
      : "-";

  return `
    <article class="portfolio-card" data-id="${item.id}">
      <div class="portfolio-card-head">
        <div class="portfolio-item-meta">
          <h4>${item.name}</h4>
          <p>${item.weight}g • ${item.karat}</p>
        </div>
        <button class="portfolio-delete-btn" type="button" data-id="${item.id}">Delete</button>
      </div>
      <div class="portfolio-card-grid">
        <div class="portfolio-stat">
          <span>Buy Rate</span>
          <strong>${formatRupee(item.buyPrice)}/g</strong>
        </div>
        <div class="portfolio-stat">
          <span>Current Rate</span>
          <strong>${typeof currentPrice === "number" ? `${formatRupee(currentPrice)}/g` : "-"}</strong>
        </div>
        <div class="portfolio-stat">
          <span>Investment</span>
          <strong>${formatRupee(invested)}</strong>
        </div>
        <div class="portfolio-stat">
          <span>Current value</span>
          <strong>${typeof currentValue === "number" ? formatRupee(currentValue) : "-"}</strong>
        </div>
      </div>
      <div class="portfolio-card-footer">
        <div class="portfolio-card-date">
          <span>Buy date</span>
          <strong>${item.buyDate || "-"}</strong>
        </div>
        <div class="portfolio-card-profit ${profitClass}">
          <span>Profit/Loss</span>
          <strong>${profitText}</strong>
        </div>
      </div>
    </article>
  `;
}

function renderPortfolio() {
  ensurePortfolioSection();

  const listEl = document.getElementById("portfolioList");
  const breakdownEl = document.getElementById("portfolioBreakdown");
  const valueChartWrap = document.getElementById("portfolioValueChartWrap");
  const allocationWrap = document.getElementById("portfolioAllocationWrap");
  const alloc22El = document.getElementById("alloc22");
  const alloc24El = document.getElementById("alloc24");
  const alloc18El = document.getElementById("alloc18");
  const alloc22PercentEl = document.getElementById("alloc22Percent");
  const alloc24PercentEl = document.getElementById("alloc24Percent");
  const alloc18PercentEl = document.getElementById("alloc18Percent");
  const totalWeightEl = document.getElementById("portfolioTotalWeight");
  const totalInvestmentEl = document.getElementById("portfolioTotalInvestment");
  const currentValueEl = document.getElementById("portfolioCurrentValue");
  const totalProfitEl = document.getElementById("portfolioProfitLoss");
  const totalProfitPercentEl = document.getElementById("portfolioProfitPercent");
  const todayChangeEl = document.getElementById("portfolioTodayChange");

  if (
    !listEl || !breakdownEl || !valueChartWrap || !allocationWrap ||
    !alloc22El || !alloc24El || !alloc18El ||
    !alloc22PercentEl || !alloc24PercentEl || !alloc18PercentEl ||
    !totalWeightEl || !totalInvestmentEl || !currentValueEl ||
    !totalProfitEl || !totalProfitPercentEl || !todayChangeEl
  ) {
    return;
  }

  const items = loadPortfolio();
  if (!items.length) {
    destroyPortfolioCharts();
    valueChartWrap.classList.add("hidden");
    allocationWrap.classList.add("hidden");
    breakdownEl.innerHTML = "";
    listEl.innerHTML = `
      <div class="portfolio-empty">
        <p>You haven't added any gold yet.</p>
        <p>Track your jewellery or coins to see how their value changes.</p>
        <button type="button" class="portfolio-add-btn portfolio-empty-btn" id="portfolioEmptyAction">Add Gold Item</button>
      </div>
    `;
    totalWeightEl.textContent = "-";
    totalInvestmentEl.textContent = "-";
    currentValueEl.textContent = "-";
    totalProfitEl.textContent = "-";
    totalProfitPercentEl.textContent = "";
    totalProfitEl.className = "";
    totalProfitPercentEl.className = "";
    todayChangeEl.textContent = "";
    todayChangeEl.className = "portfolio-today-change hidden";
    alloc22El.style.width = "0%";
    alloc24El.style.width = "0%";
    alloc18El.style.width = "0%";
    alloc22PercentEl.textContent = "0%";
    alloc24PercentEl.textContent = "0%";
    alloc18PercentEl.textContent = "0%";
    return;
  }

  let totalWeight = 0;
  let totalInvestment = 0;
  let totalCurrentValue = 0;
  const hasLivePrices = Boolean(currentPrices);
  const karatBreakdown = {
    "24K": 0,
    "22K": 0,
    "18K": 0
  };

  items.forEach(item => {
    totalWeight += Number(item.weight) || 0;
    totalInvestment += (Number(item.weight) || 0) * (Number(item.buyPrice) || 0);
    if (Object.prototype.hasOwnProperty.call(karatBreakdown, item.karat)) {
      karatBreakdown[item.karat] += Number(item.weight) || 0;
    }
    if (typeof currentPrices?.[item.karat] === "number") {
      totalCurrentValue += (Number(item.weight) || 0) * currentPrices[item.karat];
    }
  });

  const totalProfit = totalCurrentValue - totalInvestment;
  const totalProfitPercent =
    totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;
  let todayChange = 0;
  const history = Array.isArray(currentData?.history) ? currentData.history : [];
  const hasTodayChange = history.length >= 2;
  const percent22 = totalWeight > 0 ? (karatBreakdown["22K"] / totalWeight) * 100 : 0;
  const percent24 = totalWeight > 0 ? (karatBreakdown["24K"] / totalWeight) * 100 : 0;
  const percent18 = totalWeight > 0 ? (karatBreakdown["18K"] / totalWeight) * 100 : 0;
  const profitClass =
    !hasLivePrices ? "" : totalProfit > 0 ? "up" : totalProfit < 0 ? "down" : "";

  if (hasTodayChange) {
    const todayRow = history[history.length - 1];
    const yesterdayRow = history[history.length - 2];
    items.forEach(item => {
      const weight = Number(item.weight) || 0;
      const todayPrice = Number(todayRow?.[item.karat]);
      const yesterdayPrice = Number(yesterdayRow?.[item.karat]);
      if (Number.isFinite(todayPrice) && Number.isFinite(yesterdayPrice)) {
        todayChange += (todayPrice - yesterdayPrice) * weight;
      }
    });
  }

  totalWeightEl.textContent = `${totalWeight.toLocaleString("en-IN", {
    minimumFractionDigits: totalWeight % 1 ? 2 : 0,
    maximumFractionDigits: 2
  })} g`;
  totalInvestmentEl.textContent = formatRupee(totalInvestment);
  currentValueEl.textContent = hasLivePrices ? formatRupee(totalCurrentValue) : "-";
  totalProfitEl.textContent = hasLivePrices ? formatRupee(totalProfit) : "-";
  totalProfitPercentEl.textContent = hasLivePrices ? `(${Math.round(totalProfitPercent)}%)` : "";
  totalProfitEl.className = profitClass;
  totalProfitPercentEl.className = profitClass;

  if (hasLivePrices && hasTodayChange) {
    const todayClass = todayChange > 0 ? "positive" : todayChange < 0 ? "negative" : "";
    const prefix = todayChange > 0 ? "+" : "";
    todayChangeEl.textContent = `Today ${prefix}${formatRupee(todayChange)}`;
    todayChangeEl.className = `portfolio-today-change${todayClass ? ` ${todayClass}` : ""}`;
  } else {
    todayChangeEl.textContent = "";
    todayChangeEl.className = "portfolio-today-change hidden";
  }

  alloc22El.style.width = `${percent22}%`;
  alloc24El.style.width = `${percent24}%`;
  alloc18El.style.width = `${percent18}%`;
  alloc22PercentEl.textContent = `${Math.round(percent22)}%`;
  alloc24PercentEl.textContent = `${Math.round(percent24)}%`;
  alloc18PercentEl.textContent = `${Math.round(percent18)}%`;

  breakdownEl.innerHTML = `
    <div class="portfolio-breakdown-card">22K -> ${karatBreakdown["22K"].toLocaleString("en-IN", { maximumFractionDigits: 2 })}g</div>
    <div class="portfolio-breakdown-card">24K -> ${karatBreakdown["24K"].toLocaleString("en-IN", { maximumFractionDigits: 2 })}g</div>
    <div class="portfolio-breakdown-card">18K -> ${karatBreakdown["18K"].toLocaleString("en-IN", { maximumFractionDigits: 2 })}g</div>
  `;
  listEl.innerHTML = items.map(getPortfolioMarkup).join("");

  renderPortfolioCharts({
    totalInvestment,
    totalCurrentValue,
    karatBreakdown,
    showCharts: hasLivePrices
  });
}

function addPortfolioItem(item) {
  const items = loadPortfolio();
  items.push(item);
  savePortfolio(items);
  renderPortfolio();
}

function deletePortfolioItem(id) {
  if (!window.confirm("Delete this gold item from your portfolio?")) {
    return;
  }
  const items = loadPortfolio().filter(item => item.id !== id);
  savePortfolio(items);
  renderPortfolio();
}

function openPortfolioModal() {
  document.getElementById("portfolioModal")?.classList.remove("hidden");
}

function closePortfolioModal() {
  document.getElementById("portfolioModal")?.classList.add("hidden");
}

function updatePortfolioBuyRateWarning() {
  const warningEl = document.getElementById("portfolioFormWarning");
  const karat = document.getElementById("portfolioKarat")?.value;
  const buyPrice = Number(document.getElementById("portfolioBuyPrice")?.value);
  const currentPrice = karat ? currentPrices?.[karat] : null;

  if (!warningEl) return false;

  if (
    typeof currentPrice === "number" &&
    Number.isFinite(buyPrice) &&
    buyPrice > currentPrice * 3
  ) {
    warningEl.textContent =
      "Buy Rate looks unusually high compared to the current live rate. Please check the value before saving.";
    warningEl.classList.remove("hidden");
    return true;
  }

  warningEl.textContent = "";
  warningEl.classList.add("hidden");
  return false;
}

function bindPortfolioUi() {
  ensurePortfolioSection();
  ensurePortfolioModal();

  const trigger = document.getElementById("openPortfolioModal");
  if (trigger?.dataset.bound === "1") return;

  document.getElementById("openPortfolioModal")
    ?.addEventListener("click", openPortfolioModal);
  document.getElementById("closePortfolioModal")
    ?.addEventListener("click", closePortfolioModal);
  document.getElementById("cancelPortfolioModal")
    ?.addEventListener("click", closePortfolioModal);
  document.getElementById("portfolioKarat")
    ?.addEventListener("change", updatePortfolioBuyRateWarning);
  document.getElementById("portfolioBuyPrice")
    ?.addEventListener("input", updatePortfolioBuyRateWarning);

  document.getElementById("portfolioForm")
    ?.addEventListener("submit", event => {
      event.preventDefault();

      const name = document.getElementById("portfolioName")?.value.trim();
      const weight = Number(document.getElementById("portfolioWeight")?.value);
      const karat = document.getElementById("portfolioKarat")?.value;
      const buyPrice = Number(document.getElementById("portfolioBuyPrice")?.value);
      const buyDate = document.getElementById("portfolioBuyDate")?.value;

      if (!name || !weight || weight <= 0 || !karat || !buyPrice || buyPrice <= 0 || !buyDate) {
        return;
      }

      if (updatePortfolioBuyRateWarning()) {
        return;
      }

      addPortfolioItem({
        id: generatePortfolioItemId(),
        name,
        weight,
        karat,
        buyPrice,
        buyDate
      });

      event.target.reset();
      const karatField = document.getElementById("portfolioKarat");
      if (karatField) karatField.value = "22K";
      closePortfolioModal();
    });

  document.getElementById("portfolioList")
    ?.addEventListener("click", event => {
      const addBtn = event.target.closest("#portfolioEmptyAction");
      if (addBtn) {
        openPortfolioModal();
        return;
      }
      const btn = event.target.closest(".portfolio-delete-btn");
      if (!btn) return;
      deletePortfolioItem(btn.dataset.id);
    });

  if (trigger) {
    trigger.dataset.bound = "1";
  }
}
/* =========================
   CHART
========================= */

function computeYAxisBounds(values) {
  if (!values.length) return { min: 0, max: 100 };

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  const range = Math.max(maxValue - minValue, 1);
  const paddedMin = Math.max(0, minValue - range * 0.12);
  const paddedMax = maxValue + range * 0.12;
  const paddedRange = Math.max(paddedMax - paddedMin, 1);

  const targetTicks = 5;
  const roughStep = paddedRange / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;

  let niceMultiplier = 1;
  if (residual > 5) {
    niceMultiplier = 10;
  } else if (residual > 2) {
    niceMultiplier = 5;
  } else if (residual > 1) {
    niceMultiplier = 2;
  }

  const step = niceMultiplier * magnitude;
  const min = Math.floor(paddedMin / step) * step;
  const max = Math.ceil(paddedMax / step) * step;

  return { min, max, step };
}

function buildChartGradient(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, "rgba(212, 175, 55, 0.35)");
  gradient.addColorStop(1, "rgba(212, 175, 55, 0)");
  return gradient;
}

function buildDateLabels(history) {
  return history.map(item => {
    const d = new Date(item.date);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short"
    }).format(d);
  });
}

function getChartUnitText() {
  return `Price (\u20B9 / ${currentWeight}g)`;
}

function ensureChartUnitLabel() {
  const wrapper = document.getElementById("chartWrapper");
  if (!wrapper) return null;

  let label = wrapper.querySelector(".chart-unit-label");
  if (!label) {
    label = document.createElement("div");
    label.className = "chart-unit-label";
    const controls = wrapper.querySelector(".chart-controls");
    if (controls && controls.nextSibling) {
      wrapper.insertBefore(label, controls.nextSibling);
    } else {
      wrapper.appendChild(label);
    }
  }

  label.textContent = getChartUnitText();
  return label;
}

function renderCurrentChart() {
  if (!currentData?.history?.length) return;
  const chartHistory = currentData.history.slice(-currentRange);
  renderChart(getScaledHistory(chartHistory, currentKarat));
}

function renderChart(history) {
  if (!history || history.length < 2) return;

  document.getElementById("chartWrapper").classList.remove("hidden");
  ensureChartUnitLabel();

  const ctx = document.getElementById("historyChart").getContext("2d");
  const prices = history.map(h => h.price);
  const bounds = computeYAxisBounds(prices);
  const labels = buildDateLabels(history);

  if (!chart) {
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: `${currentKarat} \u00B7 ${currentWeight}g`,
          data: prices,
          borderColor: "#d4af37",
          backgroundColor: buildChartGradient(ctx),
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHitRadius: 18,
          pointHoverRadius: 4
        }]
      },
      options: {
        animation: {
          duration: CHART_ANIMATION_MS,
          easing: "easeOutCubic"
        },
        interaction: {
          mode: "index",
          intersect: false
        },
        hover: {
          mode: "index",
          intersect: false
        },
        layout: {
          padding: {
            top: 10,
            right: 8,
            bottom: 4,
            left: 6
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: () => `${currentKarat} \u00B7 ${currentWeight}g`,
              label: context => `Price: ${formatRupee(context.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              autoSkip: true,
              maxTicksLimit: window.innerWidth < 480 ? 4 : 8,
              maxRotation: 0,
              minRotation: 0,
              padding: 8
            }
          },
          y: {
            min: bounds.min,
            max: bounds.max,
            grid: { display: false },
            ticks: {
              stepSize: bounds.step,
              maxTicksLimit: 6,
              includeBounds: false,
              padding: 10,
              callback: value => formatRupee(value)
            }
          }
        }
      }
    });
    document.getElementById("chartWrapper").classList.remove("chart-loading");
    return;
  }

  chart.data.labels = labels;
  chart.data.datasets[0].label = `${currentKarat} \u00B7 ${currentWeight}g`;
  chart.data.datasets[0].data = prices;
  chart.data.datasets[0].pointHitRadius = 18;
  chart.data.datasets[0].pointHoverRadius = 4;
  chart.options.animation.duration = CHART_ANIMATION_MS;
  chart.options.animation.easing = "easeOutCubic";
  chart.options.interaction.mode = "index";
  chart.options.interaction.intersect = false;
  chart.options.hover.mode = "index";
  chart.options.hover.intersect = false;
  chart.options.layout.padding.top = 10;
  chart.options.layout.padding.right = 8;
  chart.options.layout.padding.bottom = 4;
  chart.options.layout.padding.left = 6;
  chart.options.scales.x.ticks.autoSkip = true;
  chart.options.scales.x.ticks.maxTicksLimit =
    window.innerWidth < 480 ? 4 : 8;
  chart.options.scales.x.ticks.maxRotation = 0;
  chart.options.scales.x.ticks.minRotation = 0;
  chart.options.scales.x.ticks.padding = 8;
  chart.options.scales.y.ticks.stepSize = bounds.step;
  chart.options.scales.y.ticks.maxTicksLimit = 6;
  chart.options.scales.y.ticks.includeBounds = false;
  chart.options.scales.y.ticks.padding = 10;
  chart.options.scales.y.min = bounds.min;
  chart.options.scales.y.max = bounds.max;
  chart.update();
  document.getElementById("chartWrapper").classList.remove("chart-loading");
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
    if (currentData) {
      renderData(currentData);
    }
  };
});

document.querySelectorAll(".range-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".range-btn")
      .forEach(b => b.classList.remove("active"));

    btn.classList.add("active");
    currentRange = Number(btn.dataset.range);
    renderCurrentChart();
  };
});

function formatPrice(n){
  return "₹"+Math.round(n).toLocaleString("en-IN");
}

function animateEstimatorPriceValue(el, toValue) {
  if (!el) return;

  const next = Number(toValue);
  if (!Number.isFinite(next)) return;

  const prevValue = el.dataset.estimatorValue;
  const prev = prevValue !== undefined ? Number(prevValue) : next;

  if (!Number.isFinite(prev) || prev === next) {
    el.textContent = formatPrice(next);
    el.dataset.estimatorValue = String(next);
    return;
  }

  const activeFrame = estimatorAnimationFrames.get(el);
  if (activeFrame) cancelAnimationFrame(activeFrame);

  const start = performance.now();
  const delta = next - prev;

  const tick = now => {
    const progress = Math.min((now - start) / ESTIMATOR_ANIMATION_MS, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = prev + delta * eased;
    el.textContent = formatPrice(current);

    if (progress < 1) {
      estimatorAnimationFrames.set(el, requestAnimationFrame(tick));
      return;
    }

    el.dataset.estimatorValue = String(next);
    estimatorAnimationFrames.delete(el);
  };

  estimatorAnimationFrames.set(el, requestAnimationFrame(tick));
}

function resetEstimatorPriceValue(el, emptyValue) {
  if (!el) return;

  const activeFrame = estimatorAnimationFrames.get(el);
  if (activeFrame) {
    cancelAnimationFrame(activeFrame);
    estimatorAnimationFrames.delete(el);
  }

  delete el.dataset.estimatorValue;
  el.textContent = emptyValue;
}

function animateEstimatorUpdate() {
  const breakdown = document.querySelector(".est-breakdown");
  const finalRow = document.querySelector(".est-breakdown .row.final");
  if (!breakdown || !finalRow) return;

  breakdown.classList.remove("is-updating");
  finalRow.classList.remove("is-updating");

  // Restart CSS animation when values change repeatedly.
  void breakdown.offsetWidth;

  breakdown.classList.add("is-updating");
  finalRow.classList.add("is-updating");

  setTimeout(() => {
    breakdown.classList.remove("is-updating");
    finalRow.classList.remove("is-updating");
  }, 300);
}

// ADVANCED CALCULATOR
function updateAdvancedCalc() {
  if (!currentPrices) return;
  const emptyValue = "-";

  const weight = parseFloat(document.getElementById("advWeight").value);
  const making = parseFloat(document.getElementById("makingCharge").value) || 0;
  const waste = parseFloat(document.getElementById("wastePercent").value) || 0;
  const gst = parseFloat(document.getElementById("gstPercent").value) || 0;
  const bdBase = document.getElementById("bdBase");
  const bdMaking = document.getElementById("bdMaking");
  const bdWaste = document.getElementById("bdWaste");
  const bdSubtotal = document.getElementById("bdSubtotal");
  const bdGst = document.getElementById("bdGst");
  const advancedResult = document.getElementById("advancedResult");
  if (!bdBase || !bdMaking || !bdWaste || !bdSubtotal || !bdGst || !advancedResult) return;

  if (!weight || weight <= 0) {
    resetEstimatorPriceValue(bdBase, emptyValue);
    resetEstimatorPriceValue(bdMaking, emptyValue);
    resetEstimatorPriceValue(bdWaste, emptyValue);
    resetEstimatorPriceValue(bdSubtotal, emptyValue);
    resetEstimatorPriceValue(bdGst, emptyValue);
    resetEstimatorPriceValue(advancedResult, emptyValue);
    return;
  }

  const karatBtn = document.querySelector(".purity-btn.active");
  const karat = karatBtn ? karatBtn.dataset.karat : "22K";
  const price = currentPrices[karat];

  const base = weight * price;
  const makingAmount = base * (making / 100);
  const wasteAmount = base * (waste / 100);

  const subtotal = base + makingAmount + wasteAmount;
  const gstAmount = subtotal * (gst / 100);
  const final = subtotal + gstAmount;

  animateEstimatorPriceValue(bdBase, base);
  animateEstimatorPriceValue(bdMaking, makingAmount);
  animateEstimatorPriceValue(bdWaste, wasteAmount);
  animateEstimatorPriceValue(bdSubtotal, subtotal);
  animateEstimatorPriceValue(bdGst, gstAmount);
  animateEstimatorPriceValue(advancedResult, final);
  animateEstimatorUpdate();
}

// Input listeners
document.addEventListener("input", e => {
  if (["advWeight","makingCharge","wastePercent","gstPercent"]
      .includes(e.target.id)) updateAdvancedCalc();
});

// Recalculate on karat switch
document.querySelectorAll(".karat-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    updateAdvancedCalc();
  });
});

document.getElementById("estimateJump")
?.addEventListener("click", () => {
  const estimator = document.getElementById("estimator");
  if (!estimator) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = estimator.getBoundingClientRect().top + window.scrollY - 16;

  window.scrollTo({
    top: Math.max(0, top),
    behavior: prefersReducedMotion ? "auto" : "smooth"
  });
});

document.querySelectorAll(".weight-presets button")
.forEach(btn=>{

btn.addEventListener("click",()=>{

const weightInput =
document.getElementById("weightInput") ||
document.getElementById("advWeight");

if (weightInput) {
  weightInput.value = btn.dataset.weight;
}

updateAdvancedCalc()

})

})

document.querySelectorAll(".purity-btn")
.forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".purity-btn")
      .forEach(b => b.classList.remove("active"));

    btn.classList.add("active");
    updateAdvancedCalc();
  });
});

document.querySelectorAll(".j-type")
.forEach(btn=>{

btn.addEventListener("click",()=>{

document.querySelectorAll(".j-type")
.forEach(b=>b.classList.remove("active"))

btn.classList.add("active")

document.getElementById("makingCharge").value=
btn.dataset.making

document.getElementById("wastePercent").value=
btn.dataset.waste

updateAdvancedCalc()

})

})

document.getElementById("copyEstimate")
  ?.addEventListener("click", () => {

  const final = document.getElementById("advancedResult").textContent;
  const weight = document.getElementById("advWeight").value;

  const text = `
Gold Estimate
Weight: ${weight}g
Final Amount: ${final}
`;

  navigator.clipboard.writeText(text.trim());
});

document.getElementById("shareEstimate")
  ?.addEventListener("click", () => {

  const final = document.getElementById("advancedResult").textContent;
  const weight = document.getElementById("advWeight").value;
  const activeKaratBtn = document.querySelector(".karat-btn.active");
  const activeKarat = activeKaratBtn ? activeKaratBtn.dataset.karat : "24K";

  const rate = activeKaratBtn
    ? currentPrices?.[activeKarat]
    : null;

  const html = `
  <div class="estimate-share-card">
    <div class="estimate-row">
      <span>Weight</span>
      <strong>${weight || "-"} g</strong>
    </div>

    <div class="estimate-row">
      <span>Gold Rate</span>
      <strong>₹${rate?.toLocaleString("en-IN") || "-"}/g</strong>
    </div>

    <div class="divider"></div>

    <div class="estimate-row final">
      <span>Estimated Price</span>
      <strong>${final}</strong>
    </div>

  </div>
  `;

  document.getElementById("shareCardContent").innerHTML = html;

  document.getElementById("estimateModal")
    .classList.remove("hidden");
});

document.getElementById("closeEstimate")
  ?.addEventListener("click", () => {
  document.getElementById("estimateModal")
    .classList.add("hidden");
});

document.getElementById("setAlert")
  ?.addEventListener("click", () => {
  if (!currentPrices) {
    alert("Alert feature coming soon.");
    return;
  }

  const karat = document.querySelector(".karat-btn.active").dataset.karat;
  const price = currentPrices[karat];

  console.log("Future alert hook:", {
    karat,
    threshold: price
  });

  alert("Alert feature coming soon.");
});
/* =========================
   INIT
========================= */

refreshBtn.addEventListener("click", () => fetchPrice({ forceRefresh: true }));

// document.addEventListener("DOMContentLoaded", () => {
//   const city =
//     getCityFromURL() ||
//     localStorage.getItem("lastCity") ||
//     "India";

//   cityInput.value = city;
//   fetchPrice();
// });

document.addEventListener("DOMContentLoaded", () => {
  clearOldCaches();
  ensureWeightToggle();
  ensureShareButton();
  let city;

  if (isHomePage()) {
    // Homepage must always show India
    city = "India";
  } else {
    // City pages derive city from URL
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

document.addEventListener("click", e => {
  const shareAction = e.target.closest(".share-action");
  if (!shareAction) {
    closeShareMenu();
  }
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
  const btn = document.getElementById("fbSubmit");
  const status = document.getElementById("fbStatus");
  const message = document.getElementById("fbMessage").value.trim();
  const city = getSelectedCity() || getCityFromURL() || "India";
  const payload = {
    city,
    helpful: feedbackHelpful,
    message,
    page_url: window.location.href,
    created_at: new Date().toISOString()
  };

  btn.textContent = "Saving...";
  btn.disabled = true;

  try {
    const queueRaw = localStorage.getItem("feedbackQueue");
    const queue = queueRaw ? JSON.parse(queueRaw) : [];
    queue.push(payload);
    localStorage.setItem("feedbackQueue", JSON.stringify(queue));
    status.textContent = "Thanks! Feedback saved locally.";
    btn.textContent = "Saved";
  } catch {
    status.textContent = "Could not save feedback.";
    btn.textContent = "Submit feedback";
    btn.disabled = false;
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

  const portfolioModal = document.getElementById("portfolioModal");
  if (
    portfolioModal &&
    !portfolioModal.classList.contains("hidden") &&
    e.target === portfolioModal
  ) {
    closePortfolioModal();
  }
});

bindPortfolioUi();
renderPortfolio();
initMainTabs();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .then(reg => console.log("Service Worker registered", reg))
      .catch(err => console.log("Service Worker failed", err));
  });
}

