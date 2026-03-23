import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY)

const supabase = HAS_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

const templatePath = path.resolve("./templates/city.html")
const template = fs.readFileSync(templatePath, "utf8")

const citiesDir = path.resolve("./cities")
const dataDir = path.resolve("./data")
const localCitiesPath = path.join(dataDir, "cities.json")
const localCityMapPath = path.join(dataDir, "city-slab-map.json")
const localSlabsPath = path.join(dataDir, "slabs.json")

const FEATURED_CITY_SLUGS = ["chennai", "bangalore", "hyderabad", "mumbai", "delhi"]

const CITY_HUB_OVERRIDES = {
  ahmedabad: "CG Road, Manek Chowk, and satellite jewellery showrooms",
  bangalore: "Commercial Street, Jayanagar, and Malleshwaram",
  chennai: "T. Nagar, Mylapore, and major jewellery corridors",
  coimbatore: "Cross-Cut Road, Oppanakara Street, and RS Puram",
  delhi: "Karol Bagh, Chandni Chowk, and South Delhi jewellery stores",
  hyderabad: "Abids, Himayatnagar, and Jubilee Hills jewellery stores",
  jaipur: "Johari Bazaar, MI Road, and Vaishali Nagar",
  kochi: "MG Road, Broadway, and premium jewellery districts",
  kolkata: "Bowbazar, Gariahat, and central jewellery markets",
  mumbai: "Zaveri Bazaar, Dadar, and suburban jewellery hubs",
  pune: "Laxmi Road, Camp, and Kothrud jewellery stores",
  surat: "Ghod Dod Road, Varachha, and Athwa markets"
}

const MARKET_ROLE_BY_SLAB = {
  Chennai: "South Indian jewellery demand, festival buying, and steady retail turnover",
  Delhi: "wedding-led purchases, festive demand, and active retail trade",
  Mumbai: "retail investment demand, bridal buying, and strong bullion sentiment",
  Vadodara: "regional jewellery demand, family purchases, and steady festive activity",
  India: "national investment demand, festivals, and broad jewellery consumption"
}

fs.mkdirSync(citiesDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

function slugify(city) {
  return city.toLowerCase().replace(/\s+/g, "-")
}

function formatPrice(value) {
  const price = Number(value)
  if (!Number.isFinite(price)) return "0"
  return price.toLocaleString("en-IN", {
    maximumFractionDigits: 0
  })
}

function loadSlabsData() {
  if (!fs.existsSync(localSlabsPath)) {
    throw new Error(`Missing slab data: ${localSlabsPath}`)
  }

  const raw = JSON.parse(fs.readFileSync(localSlabsPath, "utf8"))
  return raw?.slabs || {}
}

function getCurrentPriceForCity(slug, cityMap, slabs) {
  const slabName = cityMap[slug] || "India"
  const slab = slabs[slabName] || slabs.India
  if (!slab) return "0"

  const latestHistory = Array.isArray(slab.history) && slab.history.length
    ? slab.history[0]
    : null

  const price22 = latestHistory?.["22K"] ?? slab.current?.["22K"] ?? 0
  return formatPrice(price22)
}

function getCityMarketParagraph(city, slug, cityMap) {
  const slabName = cityMap[slug] || "India"
  const marketRole =
    MARKET_ROLE_BY_SLAB[slabName] ||
    "weddings, festivals, and local jewellery traditions"

  return `${city} is one of the key gold markets in India, where demand is shaped by ${marketRole}. Buyers in ${city} often track daily rate changes before purchasing jewellery or coins.`
}

function getCityHubsParagraph(city, slug) {
  const hubs =
    CITY_HUB_OVERRIDES[slug] ||
    `major shopping hubs and trusted local jewellery stores across ${city}`

  return `Popular jewellery areas in ${city} include ${hubs}, where final gold prices can vary slightly because of making charges, design complexity, and local demand.`
}

function getNearbyCitySlugs(city, slug, cities, cityMap) {
  const slabName = cityMap[slug] || "India"
  const sameSlab = cities
    .map(name => ({ name, slug: slugify(name) }))
    .filter(entry => entry.slug !== slug && (cityMap[entry.slug] || "India") === slabName)
    .slice(0, 4)
    .map(entry => entry.slug)

  if (sameSlab.length >= 4) return sameSlab

  const filler = FEATURED_CITY_SLUGS
    .filter(featuredSlug => featuredSlug !== slug && !sameSlab.includes(featuredSlug))
    .slice(0, 4 - sameSlab.length)

  return [...sameSlab, ...filler]
}

function formatCityLabel(slug) {
  return slug
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function buildNearbyCityLinks(nearbySlugs) {
  return nearbySlugs
    .map(nearbySlug => `<li><a href="/${nearbySlug}-gold-rate">Gold Rate in ${formatCityLabel(nearbySlug)}</a></li>`)
    .join("\n")
}

function buildAllCityLinks(slug) {
  const slugs = FEATURED_CITY_SLUGS.includes(slug)
    ? FEATURED_CITY_SLUGS
    : [slug, ...FEATURED_CITY_SLUGS.filter(item => item !== slug)].slice(0, 5)

  return slugs
    .map(linkSlug => `<a href="/${linkSlug}-gold-rate">Gold Rate in ${formatCityLabel(linkSlug)}</a>`)
    .join(" | ")
}

function renderCityPage(city, cities, cityMap, slabs) {
  const slug = slugify(city)
  const price = getCurrentPriceForCity(slug, cityMap, slabs)
  const nearbyCitySlugs = getNearbyCitySlugs(city, slug, cities, cityMap)
  const allCityLinkSlugs = FEATURED_CITY_SLUGS.includes(slug)
    ? FEATURED_CITY_SLUGS
    : [slug, ...FEATURED_CITY_SLUGS.filter(item => item !== slug)].slice(0, 5)

  return template
    .replace(/{{CITY}}/g, city)
    .replace(/{{CITY_SLUG}}/g, slug)
    .replace(/{{PRICE}}/g, price)
    .replace(/{{CITY_MARKET_PARAGRAPH}}/g, getCityMarketParagraph(city, slug, cityMap))
    .replace(/{{CITY_HUBS_PARAGRAPH}}/g, getCityHubsParagraph(city, slug))
    .replace(/{{NEARBY_CITY_LINKS}}/g, buildNearbyCityLinks(nearbyCitySlugs))
    .replace(/{{ALL_CITY_LINKS}}/g, buildAllCityLinks(slug))
    .replace(/{{NEARBY_CITY_DATA}}/g, JSON.stringify(nearbyCitySlugs))
    .replace(/{{CITY_LINK_DATA}}/g, JSON.stringify(allCityLinkSlugs))
}

function loadLocalCityData() {
  if (!fs.existsSync(localCitiesPath)) {
    throw new Error(`Missing local city list: ${localCitiesPath}`)
  }

  const cities = JSON.parse(fs.readFileSync(localCitiesPath, "utf8"))
  const cityMap = fs.existsSync(localCityMapPath)
    ? JSON.parse(fs.readFileSync(localCityMapPath, "utf8"))
    : {}

  return { cities, cityMap }
}

async function loadRemoteCityData() {
  const { data, error } = await supabase
    .from("city_slab_map")
    .select("city_name, slab_name")
    .order("city_name")

  if (error) {
    throw error
  }

  const cities = []
  const cityMap = {}

  data.forEach(row => {
    const city = row.city_name.trim()
    const slug = slugify(city)

    cities.push(city)
    cityMap[slug] = row.slab_name
  })

  return { cities, cityMap }
}

async function run() {
  let citiesData

  if (HAS_SUPABASE) {
    console.log("Fetching cities from Supabase...")
    citiesData = await loadRemoteCityData()
  } else {
    console.log("SUPABASE credentials not found. Regenerating from local data files...")
    citiesData = loadLocalCityData()
  }

  const slabs = loadSlabsData()
  const { cities, cityMap } = citiesData

  cities.forEach(city => {
    const slug = slugify(city)
    const dir = path.join(citiesDir, `${slug}-gold-rate`)
    fs.mkdirSync(dir, { recursive: true })

    const html = renderCityPage(city, cities, cityMap, slabs)
    fs.writeFileSync(path.join(dir, "index.html"), html)
    console.log(`Generated page for ${city}`)
  })

  cities.sort()

  const citiesPath = path.join(dataDir, "cities.json")
  const cityMapPath = path.join(dataDir, "city-slab-map.json")

  fs.writeFileSync(citiesPath, JSON.stringify(cities, null, 2))
  fs.writeFileSync(cityMapPath, JSON.stringify(cityMap, null, 2))

  console.log("cities.json generated")
  console.log("city-slab-map.json generated")

  if (!HAS_SUPABASE) {
    console.log("Local regeneration complete; skipping Supabase upload.")
    return
  }

  console.log("Uploading JSON to Supabase Storage...")

  const citiesJson = fs.readFileSync(citiesPath)
  const cityMapJson = fs.readFileSync(cityMapPath)

  const { error: citiesUploadError } = await supabase.storage
    .from("data")
    .upload(
      "cities.json",
      citiesJson,
      {
        upsert: true,
        contentType: "application/json",
        cacheControl: "public, max-age=3600"
      }
    )

  if (citiesUploadError) {
    console.error("cities.json upload failed:", citiesUploadError)
  }

  const { error: mapUploadError } = await supabase.storage
    .from("data")
    .upload(
      "city-slab-map.json",
      cityMapJson,
      {
        upsert: true,
        contentType: "application/json",
        cacheControl: "public, max-age=3600"
      }
    )

  if (mapUploadError) {
    console.error("city-slab-map.json upload failed:", mapUploadError)
  }

  console.log("JSON uploaded to Supabase storage successfully")
}

run().catch(error => {
  console.error("City generation failed:", error)
  process.exit(1)
})
