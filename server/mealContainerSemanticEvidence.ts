// Deterministic local lexical evidence for ambiguous container content.
// Used only as affirmative negative evidence after positive catalog and explicit
// semantic guards. Uncertain scores remain revisable; catalog absence alone does
// not reject. Holdout controls are absent from production literals and branches.
const CHAR_DIMENSION = 512;
const WORD_DIMENSION = 128;
const MODEL_DIMENSION = CHAR_DIMENSION + WORD_DIMENSION;
const MODEL_SCALE = 1000;
const MODEL_INTERCEPT = 104;
const NON_FOOD_MAX_FOOD_PROBABILITY = 0.44;
const MODEL_WEIGHTS_BASE64 = "OQcy+8sDC/4J/iv37ABN/c//rgKKAKcByP5a/bj+LvyVAgH6HABuAQQCIP3o/pn7GwUiAtcGLv/z/CUCrAIJBA8BowN9/Sj+SwQr+Pz9MAPjA3UAlwekBckBUv5P/pf6UwBm/vUE+fgHBMr4zANpAckBT/qh/kEDUvoK/U7+2QGkBLoCvAS0/vIAPgdK/ZYCBf3z//H+Hf6b/doBfQac/UkEiwNzAA/+pP0b9osD7PqS+978CQB9/vcD1P5/AS0GCv3y/oYBFAFU+wsF3/yM/5AAsgCXBGf+j/2//w8AuQam/p8B+vwX/Q7/ywIj++YGfACs/pIHGQNUAtH9CwBk/tP8swJK/9f2FAPJ/1cEMwOrAcr7eQKu/20CIwRJAL3/lAOvATsATftEAXcA1QKlALH6h/8TAkD6TACp/KkAJP1d/poCPvz7/9X+tf4c/DUAwgJEAqcCEfyhBeb5WwKu+MT/bgDv/3wCPwQy/2f71AKw/UQFiAS3AIQC8QZzAdj9IPsQBboCfQPTBbv8zv3iA8gGuABM/bf6JgBrBg4A8gDr+9AAPP3MArT/lAHbAmj+VgG1AP0AuQDb+V/8xv/FAVT/zv4WA6ABpAG8AVEBQAXrAMQBrQF1Af0CUf8IAKz/iwLv/MgCDAbB/sP+pf1RAxr+cwJnANkA4Pu+/p8AYPmNAHQAjgIw/f8AJAeLAA36EPyJ+hgDPAJjAzD/P/4U/F3/cAAeAE7/Q/9L/fQDnv2LAxoItgDpAov5mvnD++4Cv/5TABb4D/sLAhz/tAA3/sMCjQLyBET7TgAn/5z38P7eA/T+/f7uAHv5awTF/5b9bP5ZANb/B/8bAOIBBP34A4QCpgJPB737BQBcCDYBu/2M/g/+Kwgf/l4DKAOHAdADuwQtAk3+APzq/h375AJSBCUDhQD8AzcC+AEtANED7QFHAGz90Pl1A18EugiL/nUFNfs/9uf+dACeBZv8RQSYAkz/6AORAXz+nPya/CEC3AS6+q4Cu/3mBnL5XAXrAED/Dv989BwCZQE+/XP12QPVAb8BFQWWBFkDVQCvAxD+af3e/5j6ZviFATL8w/rcAZb8iPl2Aw8DDABd/37+ggFAA4YEogCTA4gDPwHaAsL9mgOz/HD83P5L/+n91AE8/JsAzv85/ysDqQMoA7MDPPqOCpP9xf45/KL+gvw2/vb/9gBuAzX9cAKs/AkCSAex/vL7PwLw/w7/IftsACv+lgQxAc8A9frUA7sAIfshAIoCyAOY/z8DWv6L/UYCp//pA38AyAFM++n7OAFaA/v82ADq/ccAkv9q/R4E5vxeA574ov/y/9j7xP82+kQCS/wcAA8B+P36A9YCGQk0ALkGwv8GAiMCuf61/9//Pv1iAvH+Rf52BcMBrQE7A5kAQgKIAC8A/QFK/0oBCP0SAsD6ZvzAAZD6igOWAQgFaPyeAPX+ygB9BfUDSQL+AJL9VwA//Kr8dwCBB0/6EP7vAEsEyvy1AIb8YP/y/8EGDf0X/bv/SgFFAXwDogAs/FkBZAKdADT8+/8hAOz/sf2I/FoAAf3t/JcG8P13/5sFLwB8BBwEEACF/GcD+gG1/ej7uP9QBaEDPAFqAC0ETAG3Aaj/FAEpAwkCDQYAAAj+QQAA/XT7yP8yAcT9tP/jApACBQB6AqD+R//nAUwA2gW3/Jz5R/4tA+z96fl7/psBnQVfALQBXAE=";
function loadWeights() {
  const bytes = Buffer.from(MODEL_WEIGHTS_BASE64, "base64");
  const weights = new Int16Array(MODEL_DIMENSION);
  for (let index = 0; index < MODEL_DIMENSION; index += 1) weights[index] = bytes.readInt16LE(index * 2);
  return weights;
}
const MODEL_WEIGHTS = loadWeights();
function normalizeLexicalEvidence(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").replace(/\s+/g, " ").trim();
}
function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
function addFeature(counts: Map<number, number>, index: number, weight: number) { counts.set(index, (counts.get(index) ?? 0) + weight); }
export function scoreContainerContentFoodLikelihood(value: string) {
  const normalized = normalizeLexicalEvidence(value);
  if (!normalized) return 0.5;
  const counts = new Map<number, number>();
  const framed = `^${normalized}$`;
  for (let width = 2; width <= 5; width += 1) for (let start = 0; start + width <= framed.length; start += 1) {
    addFeature(counts, fnv1a(`c:${framed.slice(start, start + width)}`) % CHAR_DIMENSION, 1);
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const word of words) addFeature(counts, CHAR_DIMENSION + (fnv1a(`w:${word}`) % WORD_DIMENSION), 2);
  for (let index = 0; index + 1 < words.length; index += 1) addFeature(counts, CHAR_DIMENSION + (fnv1a(`b:${words[index]} ${words[index + 1]}`) % WORD_DIMENSION), 1.5);
  let squaredNorm = 0; for (const count of counts.values()) squaredNorm += count * count;
  if (!squaredNorm) return 0.5;
  const norm = Math.sqrt(squaredNorm); let logit = MODEL_INTERCEPT / MODEL_SCALE;
  for (const [index, count] of counts) logit += (count / norm) * (MODEL_WEIGHTS[index] / MODEL_SCALE);
  return 1 / (1 + Math.exp(-logit));
}
export function hasHighConfidenceNonFoodLexicalEvidence(value: string) {
  return scoreContainerContentFoodLikelihood(value) < NON_FOOD_MAX_FOOD_PROBABILITY;
}
