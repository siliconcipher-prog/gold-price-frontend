import fs from "fs"
import path from "path"

const citiesPath = path.resolve("./data/cities.json")
const sitemapPath = path.resolve("./sitemap.xml")

const cities = JSON.parse(fs.readFileSync(citiesPath))

const base = "https://goldrateindia.co.in"

let urls = []

// homepage
urls.push(`
<url>
<loc>${base}</loc>
<changefreq>daily</changefreq>
<priority>1.0</priority>
</url>
`)

// city pages
cities.forEach(city => {

const slug = city.toLowerCase().replace(/\s+/g,"-")

urls.push(`
<url>
<loc>${base}/${slug}-gold-rate</loc>
<changefreq>daily</changefreq>
<priority>0.9</priority>
</url>
`)

})

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`

fs.writeFileSync(sitemapPath, xml)

console.log("sitemap.xml generated")