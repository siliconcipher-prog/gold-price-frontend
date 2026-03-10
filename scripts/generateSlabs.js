import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const outputPath = path.resolve("./data/slabs.json")

async function run() {

  console.log("Fetching slab price history...")

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const { data, error } = await supabase
    .from("gold_price_slabs")
    .select("slab_name, price_24k, price_22k, price_18k, recorded_on")
    .gte("recorded_on", ninetyDaysAgo.toISOString())
    .order("recorded_on", { ascending: false })

  if (error) {
    console.error("Supabase error:", error)
    process.exit(1)
  }

  const slabs = {}

  data.forEach(row => {

    const slab = row.slab_name

    if (!slabs[slab]) {

      slabs[slab] = {
        current: {
          "24K": row.price_24k,
          "22K": row.price_22k,
          "18K": row.price_18k
        },
        history: []
      }

    }

    slabs[slab].history.push({
      date: row.recorded_on,
      "24K": row.price_24k,
      "22K": row.price_22k,
      "18K": row.price_18k
    })

  })

  const result = {
    last_updated: new Date().toISOString(),
    slabs
  }

  const newJson = JSON.stringify(result, null, 2)

  let oldJson = ""

  if (fs.existsSync(outputPath)) {
    oldJson = fs.readFileSync(outputPath, "utf8")
  }

  if (newJson === oldJson) {
    console.log("No price changes detected.")
    return
  }

  fs.writeFileSync(outputPath, newJson)

console.log("slabs.json updated")

// Upload to Supabase Storage
const { error: uploadError } = await supabase.storage
  .from("data")
  .upload("slabs.json", newJson, {
    upsert: true,
    contentType: "application/json",
    cacheControl: "public, max-age=30, stale-while-revalidate=300"
  })

if (uploadError) {
  console.error("Upload failed:", uploadError)
  process.exit(1)
}

console.log("slabs.json uploaded to Supabase storage")  

  console.log("slabs.json updated")

}

run()
