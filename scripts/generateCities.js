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

fs.mkdirSync(citiesDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

function slugify(city) {
  return city.toLowerCase().replace(/\s+/g, "-")
}

function renderCityPage(city) {
  const slug = slugify(city)
  return template
    .replace(/{{CITY}}/g, city)
    .replace(/{{CITY_SLUG}}/g, slug)
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

  const { cities, cityMap } = citiesData

  cities.forEach(city => {
    const slug = slugify(city)
    const dir = path.join(citiesDir, `${slug}-gold-rate`)
    fs.mkdirSync(dir, { recursive: true })

    const html = renderCityPage(city)
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
