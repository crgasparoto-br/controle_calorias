import sharp from "sharp";
import { extractWithAi } from "../server/mealAiExtraction";

const EXPECTED_BRAND = "Aurora Vale";
const EXPECTED_PRODUCT = "Lager";
const SMOKE_PROMPT =
  "Analise somente o produto consumível visível na imagem sintética. Preserve texto frontal legível, marca, linha e a contagem de unidades; não use suposições externas.";

function requireProviderConfiguration() {
  const provider = process.env.SMOKE_PROVIDER?.trim();
  const model = process.env.SMOKE_MODEL?.trim();
  if (!provider || !model) {
    throw new Error("SMOKE_PROVIDER and SMOKE_MODEL are required");
  }
  return { provider, model };
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function buildSyntheticPackagedProductImage() {
  const svg = `
    <svg width="900" height="620" viewBox="0 0 900 620" xmlns="http://www.w3.org/2000/svg">
      <rect width="900" height="620" fill="#eef2f5"/>
      <rect x="105" y="55" width="275" height="510" rx="42" fill="#d8dde2" stroke="#66717b" stroke-width="8"/>
      <rect x="520" y="55" width="275" height="510" rx="42" fill="#d8dde2" stroke="#66717b" stroke-width="8"/>
      <ellipse cx="242" cy="55" rx="108" ry="18" fill="#b8c0c7" stroke="#66717b" stroke-width="6"/>
      <ellipse cx="657" cy="55" rx="108" ry="18" fill="#b8c0c7" stroke="#66717b" stroke-width="6"/>
      <rect x="124" y="210" width="237" height="180" rx="18" fill="#194d77"/>
      <rect x="539" y="210" width="237" height="180" rx="18" fill="#194d77"/>
      <g fill="#ffffff" text-anchor="middle" font-family="Arial, sans-serif">
        <text x="242" y="260" font-size="30" font-weight="700">AURORA VALE</text>
        <text x="657" y="260" font-size="30" font-weight="700">AURORA VALE</text>
        <text x="242" y="320" font-size="48" font-weight="700">LAGER</text>
        <text x="657" y="320" font-size="48" font-weight="700">LAGER</text>
        <text x="242" y="360" font-size="23">PREMIUM BEVERAGE</text>
        <text x="657" y="360" font-size="23">PREMIUM BEVERAGE</text>
      </g>
      <text x="450" y="595" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#56616b">synthetic controlled fixture — no caption identity</text>
    </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function run() {
  const { provider, model } = requireProviderConfiguration();
  if (normalize(SMOKE_PROMPT).includes(normalize(EXPECTED_BRAND))) {
    throw new Error("MEAL_VISION smoke prompt must not reveal the expected brand");
  }
  if (normalize(SMOKE_PROMPT).includes(normalize(EXPECTED_PRODUCT))) {
    throw new Error("MEAL_VISION smoke prompt must not reveal the expected product");
  }

  const result = await extractWithAi({
    text: SMOKE_PROMPT,
    imageUrl: await buildSyntheticPackagedProductImage(),
  });
  if (!result) throw new Error("MEAL_VISION live smoke returned no functional result");

  const expectedBrand = normalize(EXPECTED_BRAND);
  const expectedProduct = normalize(EXPECTED_PRODUCT);
  const recognized = result.items.find(item => {
    const foodName = normalize(item.foodName);
    const brand = normalize(item.brand);
    return (foodName.includes(expectedBrand) || brand.includes(expectedBrand))
      && foodName.includes(expectedProduct);
  });
  if (!recognized) {
    throw new Error("MEAL_VISION live smoke did not preserve the synthetic package identity");
  }

  console.log(JSON.stringify({
    provider,
    model,
    itemCount: result.items.length,
    recognizedPackagedProduct: true,
    brandFieldPresent: Boolean(recognized.brand?.trim()),
    productFieldPresent: Boolean(recognized.foodName?.trim()),
    quantity: recognized.quantity,
    unit: recognized.unit,
  }));
}

await run();
