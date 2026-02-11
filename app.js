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
let isLoading = false;
let lastWeightToggleAt = 0;

const WEIGHT_TOGGLE_DEBOUNCE_MS = 220;
const PRICE_ANIMATION_MS = 340;
const CHART_ANIMATION_MS = 360;
const WEIGHT_TOGGLE_LOCK_MS = CHART_ANIMATION_MS + 80;
const priceAnimationFrames = new WeakMap();
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
  isLoading = flag;
  refreshBtn.disabled = flag;
  refreshBtn.classList.toggle("loading", flag);
  setWeightToggleDisabled(flag || isWeightToggleLocked);
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

  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  return coarsePointer || mobileUA;
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

  menu.appendChild(shareXBtn);
  menu.appendChild(copyLinkBtn);
  shareAction.appendChild(btn);
  shareAction.appendChild(note);
  shareAction.appendChild(menu);
  actions.insertAdjacentElement("afterbegin", shareAction);
}
function showSkeleton() {
  document.getElementById("prices").classList.remove("hidden");
  const chartWrapper = document.getElementById("chartWrapper");
  chartWrapper.classList.remove("hidden");
  chartWrapper.classList.add("chart-loading");
}

function hideSkeleton() {
  document.getElementById("chartWrapper").classList.remove("chart-loading");
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

    // show skeleton immediately
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



/* =========================
   FETCH
========================= */
async function fetchPrice() {
  closeAutocomplete();
  if (cityAbortController) cityAbortController.abort();

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

  setLoading(true);
  setStatus("Loading latest prices...");
  showSkeleton();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const insightEl = document.getElementById("insight");
  insightEl.textContent = "Checking today's gold price...";
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

    // 2) URL update (India = root)
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
    insightEl.textContent =
      generateDailyInsight(data.city, data.history, "24K");
  }
  insightEl.classList.remove("hidden");

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
      el.className = "change up";
    } else {
      const scaledDiff = scalePrice(Math.abs(change.diff));
      el.textContent =
        `\u2193 ${formatRupee(scaledDiff)} (-${Math.abs(change.percent)}%)`;
      el.className = "change down";
    }
  });

  renderCurrentChart();

  document.getElementById("updated").innerHTML =
    `<span class="updated-main">Updated: ${formatUpdatedTimestamp(data.last_updated)}</span>` +
    `<span class="updated-sub">Unit: ${currentWeight}g</span>`;
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

function buildRelativeDayLabels(historyLength) {
  const labels = [];

  for (let i = 0; i < historyLength; i++) {
    const daysAgo = historyLength - 1 - i;
    labels.push(daysAgo === 0 ? "Today" : `${daysAgo}d`);
  }

  return labels;
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
  renderChart(getScaledHistory(currentData.history, currentKarat));
}

function renderChart(history) {
  if (!history || history.length < 2) return;

  document.getElementById("chartWrapper").classList.remove("hidden");
  ensureChartUnitLabel();

  const ctx = document.getElementById("historyChart").getContext("2d");
  const prices = history.map(h => h.price);
  const bounds = computeYAxisBounds(prices);
  const labels = buildRelativeDayLabels(history.length);

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
              autoSkip: false,
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
  chart.options.scales.x.ticks.autoSkip = false;
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
      renderCurrentChart();
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
      "Thanks! Your feedback helps improve the site.";

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
  btn.textContent = "Sending...";
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

    btn.textContent = "Sent";
    document.getElementById("fbStatus").textContent =
      "Thanks! Your feedback helps improve the site.";
  } catch {
    btn.textContent = "Submit feedback";
    btn.disabled = false;
    document.getElementById("fbStatus").textContent =
      "Could not submit feedback. Try again.";
  }
};
