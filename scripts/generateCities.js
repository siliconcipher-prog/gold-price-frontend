import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"

// Use environment variables in GitHub Actions
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Template
const templatePath = path.resolve("./templates/city.html")
const template = fs.readFileSync(templatePath, "utf8")

// Output folders
const citiesDir = path.resolve("./cities")
const dataDir = path.resolve("./data")

fs.mkdirSync(citiesDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

async function run() {

  console.log("Fetching cities from Supabase...")

  const { data, error } = await supabase
    .from("city_slab_map")
    .select("city_name, slab_name")
    .order("city_name")

  if (error) {
    console.error("Database error:", error)
    process.exit(1)
  }

  const cities = []
  const cityMap = {}

  data.forEach(row => {

    const city = row.city_name.trim()
    const slug = city.toLowerCase().replace(/\s+/g, "-")

    cities.push(city)
    cityMap[slug] = row.slab_name

    const dir = path.join(citiesDir, `${slug}-gold-rate`)
    fs.mkdirSync(dir, { recursive: true })

    const html = template
      .replace(/{{CITY}}/g, city)
      .replace(
        /{{TITLE}}/g,
        `${city} Gold Rate Today – 24K, 22K, 18K Price`
      )
      .replace(
        /{{DESCRIPTION}}/g,
        `Check today's gold rate in ${city}. Live 24K, 22K & 18K gold prices per gram.`
      )
      .replace(
        /{{CANONICAL}}/g,
        `https://goldrateindia.co.in/${slug}-gold-rate`
      )

    fs.writeFileSync(path.join(dir, "index.html"), html)

    console.log(`Generated page for ${city}`)
  })

  // Sort cities for autocomplete UX
  cities.sort()

  const citiesPath = path.join(dataDir, "cities.json")
  const cityMapPath = path.join(dataDir, "city-slab-map.json")

  fs.writeFileSync(
    citiesPath,
    JSON.stringify(cities, null, 2)
  )

  fs.writeFileSync(
    cityMapPath,
    JSON.stringify(cityMap, null, 2)
  )

  console.log("cities.json generated")
  console.log("city-slab-map.json generated")

  // =========================
  // Upload to Supabase Storage
  // =========================

  console.log("Uploading JSON to Supabase Storage...")

  const citiesJson = fs.readFileSync(citiesPath)
  const cityMapJson = fs.readFileSync(cityMapPath)

  const { error: citiesUploadError } = await supabase.storage
    .from("data")
    .upload(
      "cities.json",
      citiesJson,
      { upsert: true, contentType: "application/json", cacheControl: "86400" }
    )

  if (citiesUploadError) {
    console.error("cities.json upload failed:", citiesUploadError)
  }

  const { error: mapUploadError } = await supabase.storage
    .from("data")
    .upload(
      "city-slab-map.json",
      cityMapJson,
      { upsert: true, contentType: "application/json", cacheControl: "86400" }
    )

  if (mapUploadError) {
    console.error("city-slab-map.json upload failed:", mapUploadError)
  }

  console.log("JSON uploaded to Supabase storage successfully")

}

run()