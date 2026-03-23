/* =========================
   CONFIG
========================= */

let slabsData = null;
let citySlabMap = null;
let citiesList = null;
let slabsLastUpdated = "";

let chart;
let portfolioTypeChart;
let portfolioPurityChart;
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
const PORTFOLIO_TYPE_META = {
  ring: { icon: "💍", label: "Ring" },
  coin: { icon: "🪙", label: "Coin" },
  chain: { icon: "📿", label: "Chain" },
  bangle: { icon: "⭕", label: "Bangle" },
  bar: { icon: "🟨", label: "Bar" },
  biscuit: { icon: "▭", label: "Biscuit" },
  necklace: { icon: "📿", label: "Necklace" },
  earring: { icon: "✦", label: "Earring" },
  pendant: { icon: "🜂", label: "Pendant" },
  bracelet: { icon: "⛓", label: "Bracelet" },
  digital: { icon: "▣", label: "Digital" },
  other: { icon: "◦", label: "Other" }
};
const portfolioCenterTextPlugin = {
  id: "portfolioCenterText",
  afterDraw(chart) {
    const centerText = chart?.options?.plugins?.centerText;
    if (!centerText?.value) return;

    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;

    const x = meta.data[0].x;
    const y = meta.data[0].y;

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(centerText.label || "Total", x, y - 6);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 18px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(centerText.value, x, y + 14);
    ctx.restore();
  }
};
if (typeof Chart !== "undefined" && Chart.registry && !Chart.registry.plugins.get("portfolioCenterText")) {
  Chart.register(portfolioCenterTextPlugin);
}

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

function formatWeight(value) {
  const num = Number(value || 0);
  return `${num.toLocaleString("en-IN", {
    minimumFractionDigits: num % 1 ? 2 : 0,
    maximumFractionDigits: 2
  })}g`;
}

function formatPercent(value, decimals = 0, includeSign = false) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const sign = includeSign && num > 0 ? "+" : "";
  return `${sign}${num.toFixed(decimals)}%`;
}

function calculatePosition(current, low, high) {
  const currentValue = Number(current);
  const lowValue = Number(low);
  const highValue = Number(high);
  const range = highValue - lowValue;

  if (
    !Number.isFinite(currentValue) ||
    !Number.isFinite(lowValue) ||
    !Number.isFinite(highValue) ||
    range <= 0
  ) {
    return {
      position: 50,
      label: "Mid Range",
      signal: {
        label: "Neutral",
        tone: "neutral",
        note: "Price in mid range"
      }
    };
  }

  const position = Math.max(
    2,
    Math.min(98, Math.round(((currentValue - lowValue) / range) * 100))
  );

  if (position < 30) {
    return {
      position,
      label: "Near Low",
      signal: {
        label: "Good Time to Buy",
        tone: "good",
        note: "Price near monthly low"
      }
    };
  }

  if (position > 70) {
    return {
      position,
      label: "Near High",
      signal: {
        label: "Expensive / Wait",
        tone: "high",
        note: "Price near monthly high"
      }
    };
  }

  return {
    position,
    label: "Mid Range",
    signal: {
      label: "Neutral",
      tone: "neutral",
      note: "Price in mid range"
    }
  };
}

function getTrend(change) {
  const value = Number(change);
  if (!Number.isFinite(value) || value === 0) {
    return { label: "→ Stable", tone: "" };
  }

  if (value < 0) {
    return { label: `↓ Falling (${formatRupee(Math.abs(value))})`, tone: "down" };
  }

  return { label: `↑ Rising (${formatRupee(value)})`, tone: "up" };
}

function getDistanceLabel(position) {
  const value = Number(position);
  if (!Number.isFinite(value)) return "Mid range";
  if (value < 5) return "At monthly bottom";
  if (value < 30) return "Near low";
  if (value > 70) return "Near high";
  return "Mid range";
}

function getReasonChips(stats) {
  const reasons = [];
  const position = Number(stats?.currentPositionPercent);
  const monthlyChange = Number(stats?.change);
  const rangePercent = Number(stats?.rangePercent);

  if (Number.isFinite(position)) {
    if (position < 30) reasons.push("Near monthly low");
    if (position > 70) reasons.push("Near monthly high");
    if (position < 35 && monthlyChange < 0) reasons.push("Value zone");
  }

  if (Number.isFinite(monthlyChange)) {
    if (monthlyChange < 0) reasons.push("Falling trend");
    if (monthlyChange > 0) reasons.push("Uptrend ongoing");
  }

  if (Number.isFinite(rangePercent) && rangePercent > 15) {
    reasons.push("High volatility month");
  }

  return reasons;
}

function getConfidenceScore(stats) {
  let confidence = 50;
  const position = Number(stats?.currentPositionPercent);
  const monthlyChange = Number(stats?.change);
  const rangePercent = Number(stats?.rangePercent);

  if (Number.isFinite(position)) {
    if (position < 30) confidence += 20;
    if (position > 70) confidence -= 20;
  }

  if (Number.isFinite(monthlyChange)) {
    if (monthlyChange < 0) confidence += 10;
    if (monthlyChange > 0) confidence -= 10;
  }

  if (Number.isFinite(rangePercent) && rangePercent > 15) confidence += 5;

  return Math.max(0, Math.min(100, confidence));
}

function findLastTimePriceWasNearCurrent(history, karat, currentPrice) {
  if (!Array.isArray(history) || !Number.isFinite(Number(currentPrice))) return null;

  const current = Number(currentPrice);
  const threshold = Math.max(current * 0.01, 20);
  const rows = history
    .slice()
    .sort((a, b) =>
      new Date(a.date || a.recorded_on || a.recorded_at) -
      new Date(b.date || b.recorded_on || b.recorded_at)
    );
  const latestRow = rows.at(-1);
  const latestRowDate = latestRow
    ? new Date(latestRow.date || latestRow.recorded_on || latestRow.recorded_at)
    : null;
  if (!latestRowDate || Number.isNaN(latestRowDate.getTime())) return null;

  for (let i = rows.length - 2; i >= 0; i--) {
    const row = rows[i];
    const dt = new Date(row.date || row.recorded_on || row.recorded_at);
    const price = getKaratValue(row, karat);
    if (Number.isNaN(dt.getTime()) || !Number.isFinite(price)) continue;
    if (Math.abs(price - current) <= threshold) {
      const daysAgo = Math.max(1, Math.round((latestRowDate - dt) / 86400000));
      return daysAgo;
    }
  }

  return null;
}

function formatPortfolioDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
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
    <div class="monthly-stats-head">
      <div>
        <h3>Should I Buy Gold Today?</h3>
        <p id="statsSubtitle">India • 24K • per gram</p>
      </div>
    </div>

    <div class="gold-signal neutral" id="mSignalCard">
      <span class="signal-label">Smart Signal</span>
      <strong id="mSignal">Neutral</strong>
      <p id="mSignalNote">Price in mid range</p>
    </div>

    <div class="reason-chips" id="mReasons"></div>

    <div class="buy-zone-meter" aria-label="Monthly buy zone meter">
      <div class="buy-zone-labels" aria-hidden="true">
        <span><i class="signal-dot signal-dot-low"></i>LOW</span>
        <span>HIGH<i class="signal-dot signal-dot-high"></i></span>
      </div>
      <div class="buy-zone-track">
        <div class="buy-zone-fill" id="mMeterFill"></div>
        <div class="buy-zone-marker meter-dot" id="mMeterMarker"></div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card stat-card-emphasis">
        <span>Current Position</span>
        <strong id="mPosition">-</strong>
      </div>
      <div class="stat-card">
        <span>Trend Direction</span>
        <strong id="mTrend">-</strong>
      </div>
      <div class="stat-card">
        <span>Range Spread</span>
        <strong id="mRange">-</strong>
      </div>
      <div class="stat-card">
        <span>Distance from Low</span>
        <strong id="mDistance">-</strong>
      </div>
      <div class="stat-card">
        <span>Average</span>
        <strong id="mAvg">-</strong>
      </div>
    </div>

    <div class="monthly-trust">
      <p id="mConfidence" class="trust-confidence">Confidence: -</p>
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

    <div id="portfolioAnalytics" class="portfolio-analytics hidden">
      <div class="chart-card chart-card-wide">
        <h3>Invested vs Current Value</h3>
        <div class="value-row">
          <span>Invested</span>
          <strong id="investedValue">₹0</strong>
          <div class="bar">
            <div id="investedBar"></div>
          </div>
        </div>
        <div class="value-row">
          <span>Current Value</span>
          <strong id="currentValue">₹0</strong>
          <div class="bar">
            <div id="currentBar"></div>
          </div>
        </div>
      </div>

      <div class="chart-card">
        <h3>Allocation by Item Type</h3>
        <div class="chart-shell">
          <div class="chart-canvas-wrap">
            <canvas id="typeChart"></canvas>
          </div>
          <div id="typeLegend" class="chart-legend"></div>
        </div>
      </div>

      <div class="chart-card">
        <h3>Value by Purity</h3>
        <div class="chart-shell">
          <div class="chart-canvas-wrap">
            <canvas id="purityChart"></canvas>
          </div>
          <div id="purityLegend" class="chart-legend"></div>
        </div>
      </div>
    </div>

    <div id="portfolioList" class="portfolio-list"></div>
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
          <span>Item Type</span>
          <select id="portfolioType" required>
            <option value="ring">💍 Ring</option>
            <option value="coin">🪙 Coin</option>
            <option value="chain">📿 Chain</option>
            <option value="bangle">⭕ Bangle</option>
            <option value="bar">🟨 Bar</option>
            <option value="biscuit">▭ Biscuit</option>
            <option value="necklace">📿 Necklace</option>
            <option value="earring">✦ Earring</option>
            <option value="pendant">🜂 Pendant</option>
            <option value="bracelet">⛓ Bracelet</option>
            <option value="digital">▣ Digital</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          <span>Name</span>
          <input id="portfolioName" type="text" placeholder="Optional name">
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
          <input id="portfolioBuyPrice" type="text" inputmode="decimal" placeholder="6200" required>
        </label>
        <p id="portfolioCurrentRateHint" class="portfolio-form-hint"></p>

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
      <button class="tab-btn" data-tab="portfolio" type="button">Portfolio <span class="tab-beta">Beta</span></button>
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
    weeklyLow,
    weeklyHigh
  } = data;

  const dailyChange = currentPrice - yesterdayPrice;

  if (currentPrice <= weeklyLow) {
    return "🟢 Gold hits a 7-day low";
  }

  if (currentPrice >= weeklyHigh) {
    return "🔴 Gold reaches a weekly high";
  }

  if (Math.abs(dailyChange) < 0.001) {
    return "⚪ Gold moves little today";
  }

  if (dailyChange > 0) {
    return "🔴 Gold rises today";
  }

  if (dailyChange < 0) {
    return "🟢 Gold falls today";
  }

  return "⚪ Gold moves little today";
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
    insightEl.textContent = generateMarketSummary(analysis);
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
  const positionInfo = calculatePosition(endPrice, low, high);
  const rangePercent = low > 0 ? (range / low) * 100 : null;
  const distanceFromLow = endPrice - low;
  const distancePercent = low > 0 ? (distanceFromLow / low) * 100 : null;
  const lastSeenDaysAgo = findLastTimePriceWasNearCurrent(
    monthRows,
    karat,
    endPrice
  );
  const confidence = getConfidenceScore({
    currentPositionPercent: positionInfo.position,
    change,
    rangePercent
  });

  return {
    high,
    low,
    avg,
    change,
    range,
    rangePercent,
    current: endPrice,
    currentPositionPercent: positionInfo.position,
    currentPositionLabel: positionInfo.label,
    signal: positionInfo.signal,
    distanceFromLow,
    distancePercent,
    distanceLabel: getDistanceLabel(positionInfo.position),
    reasons: getReasonChips({
      currentPositionPercent: positionInfo.position,
      change,
      rangePercent
    }),
    confidence,
    lastSeenDaysAgo
  };
}

function updateMonthlyStats(history) {
  ensureMonthlyStatsSection();

  const subtitleEl = document.getElementById("statsSubtitle");
  const signalCardEl = document.getElementById("mSignalCard");
  const signalEl = document.getElementById("mSignal");
  const signalNoteEl = document.getElementById("mSignalNote");
  const reasonsEl = document.getElementById("mReasons");
  const meterFillEl = document.getElementById("mMeterFill");
  const meterMarkerEl = document.getElementById("mMeterMarker");
  const positionEl = document.getElementById("mPosition");
  const trendEl = document.getElementById("mTrend");
  const rangeEl = document.getElementById("mRange");
  const distanceEl = document.getElementById("mDistance");
  const avgEl = document.getElementById("mAvg");
  const confidenceEl = document.getElementById("mConfidence");

  if (
    !subtitleEl ||
    !signalCardEl ||
    !signalEl ||
    !signalNoteEl ||
    !reasonsEl ||
    !meterFillEl ||
    !meterMarkerEl ||
    !positionEl ||
    !trendEl ||
    !rangeEl ||
    !distanceEl ||
    !avgEl ||
    !confidenceEl
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
    signalCardEl.className = "gold-signal neutral";
    signalEl.textContent = "Neutral";
    signalNoteEl.textContent = "No monthly data";
    reasonsEl.innerHTML = "";
    meterFillEl.style.width = "50%";
    meterMarkerEl.style.left = "50%";
    meterMarkerEl.style.color = "var(--gold)";
    positionEl.textContent = "-";
    trendEl.textContent = "-";
    rangeEl.textContent = "-";
    distanceEl.textContent = "-";
    avgEl.textContent = "-";
    confidenceEl.textContent = "Confidence: -";
    return;
  }

  avgEl.textContent = formatRupee(stats.avg);

  const trend = getTrend(stats.change);
  const signal = stats.signal || {
    label: "Neutral",
    tone: "neutral",
    note: "Price in mid range"
  };
  const reasonChips = Array.isArray(stats.reasons) ? stats.reasons : [];

  signalCardEl.className = `gold-signal ${signal.tone}`;
  signalEl.textContent = signal.label;
  signalNoteEl.textContent = signal.note;
  reasonsEl.innerHTML = reasonChips.length
    ? reasonChips.map(reason => `<span class="reason-chip">${reason}</span>`).join("")
    : `<span class="reason-chip muted">Balanced setup</span>`;

  meterFillEl.style.width = `${stats.currentPositionPercent}%`;
  meterMarkerEl.style.left = `${stats.currentPositionPercent}%`;
  meterMarkerEl.style.color =
    signal.tone === "good"
      ? "var(--green)"
      : signal.tone === "high"
        ? "var(--red)"
        : "var(--gold)";

  positionEl.textContent = `${formatPercent(stats.currentPositionPercent, 0)} (${stats.currentPositionLabel})`;
  trendEl.textContent = trend.label;
  rangeEl.textContent = `${formatRupee(stats.range)} (${formatPercent(stats.rangePercent, 0)})`;
  distanceEl.textContent = stats.distanceLabel;
  confidenceEl.textContent = `Confidence: ${stats.confidence}%`;
}

function generatePortfolioItemId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `portfolio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function destroyPortfolioCharts() {
  if (portfolioTypeChart) {
    portfolioTypeChart.destroy();
    portfolioTypeChart = null;
  }

  if (portfolioPurityChart) {
    portfolioPurityChart.destroy();
    portfolioPurityChart = null;
  }
}

function createChartLegend(containerId, items, valueFormatter) {
  const legendEl = document.getElementById(containerId);
  if (!legendEl) return;

  const total = items.reduce((sum, item) => sum + item.value, 0);
  const visibleItems = items.filter(item => item.value > 0);

  if (!visibleItems.length || total <= 0) {
    legendEl.innerHTML = `<div class="chart-empty">No portfolio data</div>`;
    return;
  }

  legendEl.innerHTML = visibleItems.map(item => {
    const percent = Math.round((item.value / total) * 100);
    return `
      <div class="legend-item">
        <span class="legend-dot" style="background:${item.color}"></span>
        <div class="legend-copy">
          <span class="legend-label">${item.label}</span>
          <strong>${valueFormatter(item.value)}</strong>
          <em>(${percent}%)</em>
        </div>
      </div>
    `;
  }).join("");
}

function renderPortfolioAnalyticsCharts(groupedTypes, purityValues, totalWeight, totalCurrentValue) {
  const typeCanvas = document.getElementById("typeChart");
  const purityCanvas = document.getElementById("purityChart");

  if (!typeCanvas || !purityCanvas) {
    return;
  }

  destroyPortfolioCharts();

  const typeLegendItems = [
    { label: "Coins", value: groupedTypes.coins, color: "#f4c430" },
    { label: "Jewellery", value: groupedTypes.jewellery, color: "#d4af37" },
    { label: "Bars", value: groupedTypes.bars, color: "#b9872f" },
    { label: "Digital", value: groupedTypes.digital, color: "#9aa7bd" },
    { label: "Other", value: groupedTypes.other, color: "#5f6b7a" }
  ];

  const purityLegendItems = [
    { label: "24K Gold", value: purityValues.value24K, color: "#f4c430" },
    { label: "22K Gold", value: purityValues.value22K, color: "#d4af37" },
    { label: "18K Gold", value: purityValues.value18K, color: "#b9872f" }
  ];

  createChartLegend("typeLegend", typeLegendItems, value => formatWeight(value));
  createChartLegend("purityLegend", purityLegendItems, value => formatRupee(value));

  portfolioTypeChart = new Chart(typeCanvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: typeLegendItems.map(item => item.label),
      datasets: [{
        data: typeLegendItems.map(item => item.value),
        backgroundColor: typeLegendItems.map(item => item.color),
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          display: false
        },
        centerText: {
          label: "Total",
          value: formatWeight(totalWeight)
        }
      }
    }
  });

  portfolioPurityChart = new Chart(purityCanvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: purityLegendItems.map(item => item.label),
      datasets: [{
        data: purityLegendItems.map(item => item.value),
        backgroundColor: purityLegendItems.map(item => item.color),
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          display: false
        },
        centerText: {
          label: "Total",
          value: formatRupee(totalCurrentValue)
        }
      }
    }
  });
}

function renderPortfolioAnalytics({ totalInvestment, totalCurrentValue, groupedTypes, purityValues, totalWeight, showCharts }) {
  const analyticsWrap = document.getElementById("portfolioAnalytics");
  const investedValueEl = document.getElementById("investedValue");
  const currentValueEl = document.getElementById("currentValue");
  const investedBarEl = document.getElementById("investedBar");
  const currentBarEl = document.getElementById("currentBar");

  if (!analyticsWrap || !investedValueEl || !currentValueEl || !investedBarEl || !currentBarEl) {
    return;
  }

  if (!showCharts) {
    destroyPortfolioCharts();
    analyticsWrap.classList.add("hidden");
    return;
  }

  analyticsWrap.classList.remove("hidden");
  investedValueEl.textContent = formatRupee(totalInvestment);
  currentValueEl.textContent = formatRupee(totalCurrentValue);
  const maxValue = Math.max(totalInvestment, totalCurrentValue, 1);
  investedBarEl.style.width = `${(totalInvestment / maxValue) * 100}%`;
  currentBarEl.style.width = `${(totalCurrentValue / maxValue) * 100}%`;
  renderPortfolioAnalyticsCharts(groupedTypes, purityValues, totalWeight, totalCurrentValue);
}

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_PORTFOLIO_STORAGE_KEY);
      if (!legacy) return [];
      const parsedLegacy = JSON.parse(legacy);
      if (Array.isArray(parsedLegacy)) {
        const normalizedLegacy = parsedLegacy.map(normalizePortfolioItem);
        localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(normalizedLegacy));
        return normalizedLegacy;
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizePortfolioItem) : [];
  } catch {
    return [];
  }
}

function savePortfolio(items) {
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(items));
}

function normalizePortfolioType(type) {
  const key = String(type || "other").toLowerCase();
  return Object.prototype.hasOwnProperty.call(PORTFOLIO_TYPE_META, key)
    ? key
    : "other";
}

function normalizePortfolioItem(item) {
  return {
    ...item,
    name: typeof item?.name === "string" ? item.name.trim() : "",
    type: normalizePortfolioType(item?.type)
  };
}

function getPortfolioMarkup(item) {
  const normalizedItem = normalizePortfolioItem(item);
  const typeMeta = PORTFOLIO_TYPE_META[normalizedItem.type];
  const itemName = normalizedItem.name;
  const title = itemName || typeMeta.label;
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
      ? `${profit > 0 ? "+" : ""}${formatRupee(profit)}`
      : "-";
  const profitSubtext =
    typeof profitPercent === "number"
      ? `${profitPercent > 0 ? "+" : ""}${Math.round(profitPercent)}%`
      : "";

  return `
    <article class="portfolio-card" data-id="${item.id}">
      <div class="portfolio-card-head">
        <div class="portfolio-item-meta">
          <h4>${title}</h4>
          <p>${formatWeight(item.weight)} • ${item.karat}</p>
          <p class="portfolio-item-date">Bought on ${formatPortfolioDate(item.buyDate)}</p>
        </div>
        <div class="portfolio-card-side">
          <div class="portfolio-card-profit-pill ${profitClass}">
            <strong>${profitText}</strong>
            ${profitSubtext ? `<span>${profitSubtext}</span>` : ""}
          </div>
          <button class="portfolio-delete-btn" type="button" data-id="${item.id}" aria-label="Delete ${title}">Delete</button>
        </div>
      </div>
      <div class="portfolio-card-rates">
        <div class="portfolio-rate-block">
          <span>Bought @</span>
          <strong>${formatRupee(item.buyPrice)}/g</strong>
        </div>
        <div class="portfolio-rate-block portfolio-rate-block-current">
          <span>Now @</span>
          <strong>${typeof currentPrice === "number" ? `${formatRupee(currentPrice)}/g` : "-"}</strong>
        </div>
      </div>
    </article>
  `;
}

function renderPortfolio() {
  ensurePortfolioSection();

  const listEl = document.getElementById("portfolioList");
  const analyticsWrap = document.getElementById("portfolioAnalytics");
  const totalWeightEl = document.getElementById("portfolioTotalWeight");
  const totalInvestmentEl = document.getElementById("portfolioTotalInvestment");
  const currentValueEl = document.getElementById("portfolioCurrentValue");
  const totalProfitEl = document.getElementById("portfolioProfitLoss");
  const totalProfitPercentEl = document.getElementById("portfolioProfitPercent");
  const todayChangeEl = document.getElementById("portfolioTodayChange");

  if (
    !listEl || !analyticsWrap ||
    !totalWeightEl || !totalInvestmentEl || !currentValueEl ||
    !totalProfitEl || !totalProfitPercentEl || !todayChangeEl
  ) {
    return;
  }

  const items = loadPortfolio();
  if (!items.length) {
    destroyPortfolioCharts();
    analyticsWrap.classList.add("hidden");
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
    return;
  }

  let totalWeight = 0;
  let totalInvestment = 0;
  let totalCurrentValue = 0;
  const hasLivePrices = Boolean(currentPrices);
  const purityValues = {
    value24K: 0,
    value22K: 0,
    value18K: 0
  };
  const groupedTypes = {
    coins: 0,
    jewellery: 0,
    bars: 0,
    digital: 0,
    other: 0
  };

  items.forEach(item => {
    const normalizedType = normalizePortfolioType(item.type);
    totalWeight += Number(item.weight) || 0;
    totalInvestment += (Number(item.weight) || 0) * (Number(item.buyPrice) || 0);

    if (normalizedType === "coin") {
      groupedTypes.coins += Number(item.weight) || 0;
    } else if (["ring", "chain", "bangle", "necklace", "earring", "pendant", "bracelet"].includes(normalizedType)) {
      groupedTypes.jewellery += Number(item.weight) || 0;
    } else if (["bar", "biscuit"].includes(normalizedType)) {
      groupedTypes.bars += Number(item.weight) || 0;
    } else if (normalizedType === "digital") {
      groupedTypes.digital += Number(item.weight) || 0;
    } else {
      groupedTypes.other += Number(item.weight) || 0;
    }

    if (typeof currentPrices?.[item.karat] === "number") {
      const currentValue = (Number(item.weight) || 0) * currentPrices[item.karat];
      totalCurrentValue += currentValue;
      if (item.karat === "24K") purityValues.value24K += currentValue;
      if (item.karat === "22K") purityValues.value22K += currentValue;
      if (item.karat === "18K") purityValues.value18K += currentValue;
    }
  });

  const totalProfit = totalCurrentValue - totalInvestment;
  const totalProfitPercent =
    totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;
  let todayChange = 0;
  const history = Array.isArray(currentData?.history) ? currentData.history : [];
  const hasTodayChange = history.length >= 2;
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

  listEl.innerHTML = items.map(getPortfolioMarkup).join("");

  renderPortfolioAnalytics({
    totalInvestment,
    totalCurrentValue,
    groupedTypes,
    purityValues,
    totalWeight,
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
  updatePortfolioRateHint();
  updatePortfolioBuyRateWarning();
}

function closePortfolioModal() {
  document.getElementById("portfolioModal")?.classList.add("hidden");
}

function parsePortfolioNumberInput(value) {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return NaN;
  return Number(normalized);
}

function updatePortfolioRateHint() {
  const hintEl = document.getElementById("portfolioCurrentRateHint");
  const karat = document.getElementById("portfolioKarat")?.value;
  const weight = Number(document.getElementById("portfolioWeight")?.value);
  const currentPrice = karat ? currentPrices?.[karat] : null;

  if (!hintEl) return;

  if (typeof currentPrice === "number") {
    const parts = [`Live ${karat} rate: ${formatRupee(currentPrice)}/g`];
    if (Number.isFinite(weight) && weight > 0) {
      parts.push(`Current value for ${formatWeight(weight)}: ${formatRupee(weight * currentPrice)}`);
    }
    hintEl.textContent = parts.join(" • ");
    return;
  }

  hintEl.textContent = "";
}

function updatePortfolioBuyRateWarning() {
  const warningEl = document.getElementById("portfolioFormWarning");
  const karat = document.getElementById("portfolioKarat")?.value;
  const buyPrice = parsePortfolioNumberInput(document.getElementById("portfolioBuyPrice")?.value);
  const currentPrice = karat ? currentPrices?.[karat] : null;

  if (!warningEl) return;

  if (
    typeof currentPrice === "number" &&
    Number.isFinite(buyPrice) &&
    buyPrice > currentPrice * 3
  ) {
    warningEl.textContent =
      "Buy Rate looks unusually high compared to the current live rate. Please check the value before saving.";
    warningEl.classList.remove("hidden");
    return;
  }

  warningEl.textContent = "";
  warningEl.classList.add("hidden");
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
    ?.addEventListener("change", () => {
      updatePortfolioRateHint();
      updatePortfolioBuyRateWarning();
    });
  document.getElementById("portfolioWeight")
    ?.addEventListener("input", updatePortfolioRateHint);
  document.getElementById("portfolioBuyPrice")
    ?.addEventListener("input", updatePortfolioBuyRateWarning);

  document.getElementById("portfolioForm")
    ?.addEventListener("submit", event => {
      event.preventDefault();

      const type = document.getElementById("portfolioType")?.value;
      const name = document.getElementById("portfolioName")?.value.trim();
      const weight = Number(document.getElementById("portfolioWeight")?.value);
      const karat = document.getElementById("portfolioKarat")?.value;
      const buyPrice = parsePortfolioNumberInput(document.getElementById("portfolioBuyPrice")?.value);
      const buyDate = document.getElementById("portfolioBuyDate")?.value;

      if (!type || !weight || weight <= 0 || !karat || !Number.isFinite(buyPrice) || buyPrice <= 0 || !buyDate) {
        return;
      }

      addPortfolioItem({
        id: generatePortfolioItemId(),
        type: normalizePortfolioType(type),
        name: name || "",
        weight,
        karat,
        buyPrice,
        buyDate
      });

      event.target.reset();
      const typeField = document.getElementById("portfolioType");
      if (typeField) typeField.value = "ring";
      const karatField = document.getElementById("portfolioKarat");
      if (karatField) karatField.value = "22K";
      updatePortfolioRateHint();
      updatePortfolioBuyRateWarning();
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

