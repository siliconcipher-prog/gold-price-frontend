const fs = require("fs");
const path = require("path");


const cities = [
  "Chennai",
  "Mumbai",
  "Delhi",
  "Bangalore",
  "Hyderabad",
  "Kolkata",
  "Pune",
  "Ahmedabad",
  "Jaipur",
  "Lucknow",
  "Chandigarh",
  "kanpur",
  "indore",
  "bhopal",
  "kochi",
  "trivandrum",
  "coimbatore"
];

const templatePath = path.join(__dirname, "../templates/city.html");
const template = fs.readFileSync(templatePath, "utf8");

// ✅ All city pages go here
const outDir = path.join(__dirname, "..", "cities");

// Ensure /cities exists
fs.mkdirSync(outDir, { recursive: true });


cities.forEach(city => {
  const slug = city.toLowerCase().replace(/\s+/g, "-");
  const dir = path.join(outDir, `${slug}-gold-rate`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const html = template
    .replace(/{{CITY}}/g, city)
    .replace(
      /{{TITLE}}/g,
      `${city} Gold Price Today (24K, 22K, 18K) – Live Rates in ${city}`
    )
    .replace(
      /{{DESCRIPTION}}/g,
      `Check today’s gold rate in ${city}. Live 24K, 22K & 18K gold prices per gram.`
    )
    .replace(
      /{{CANONICAL}}/g,
      `https://goldrateindia.co.in/${slug}-gold-rate`
    );

  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
  console.log(`✓ Generated ${slug}-gold-rate`);
});
