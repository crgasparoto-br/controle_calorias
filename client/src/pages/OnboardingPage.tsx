import { useAuth } from "@/_core/hooks/useAuth";
import PageIntro from "@/components/PageIntro";
import DashboardLayout from "@/components/DashboardLayout";
import ProfessionalProfileSettings from "@/components/ProfessionalProfileSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatNumberPtBr, parseDecimalInputPtBr } from "@/lib/numberFormat";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, Clock3, MessageCircle, Plus, Save, Stethoscope, Target, Trash2, UserRound } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const OBJECTIVE_OPTIONS = [
  { value: "emagrecer", label: "Emagrecer" },
  { value: "manter_peso", label: "Manter peso" },
  { value: "ganhar_massa", label: "Ganhar massa" },
  { value: "melhorar_habitos", label: "Melhorar hábitos" },
] as const;

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Pouca atividade" },
  { value: "light", label: "Leve" },
  { value: "moderate", label: "Moderada" },
  { value: "active", label: "Alta" },
  { value: "very_active", label: "Muito alta" },
] as const;

const EXPERIENCE_OPTIONS = [
  { value: "beginner", label: "Estou começando" },
  { value: "intermediate", label: "Já acompanhei antes" },
  { value: "advanced", label: "Tenho bastante prática" },
] as const;

const ROUTINE_OPTIONS = [
  { value: "cozinha_em_casa", label: "Cozinha em casa" },
  { value: "come_fora", label: "Come fora" },
  { value: "delivery", label: "Delivery" },
  { value: "marmita", label: "Marmita" },
  { value: "misto", label: "Misto" },
] as const;

const DIFFICULTY_OPTIONS = [
  { value: "fome", label: "Fome" },
  { value: "ansiedade", label: "Ansiedade" },
  { value: "falta_de_tempo", label: "Falta de tempo" },
  { value: "beliscos", label: "Beliscos" },
  { value: "doces", label: "Doces" },
  { value: "comer_fora", label: "Comer fora" },
  { value: "falta_de_planejamento", label: "Falta de planejamento" },
] as const;

const MEAL_LABEL_SUGGESTIONS = [
  "café da manhã",
  "almoço",
  "lanche da tarde",
  "pré-treino",
  "pós-treino",
  "jantar",
  "ceia",
  "outro",
] as const;

const DEFAULT_PHONE_COUNTRY_OPTION = "BR:55";

const COUNTRY_CODE_OPTIONS = [
  { value: DEFAULT_PHONE_COUNTRY_OPTION, label: "Brasil (+55)" },
  { value: "AF:93", label: "Afeganistão (+93)" },
  { value: "ZA:27", label: "África do Sul (+27)" },
  { value: "AL:355", label: "Albânia (+355)" },
  { value: "DE:49", label: "Alemanha (+49)" },
  { value: "AD:376", label: "Andorra (+376)" },
  { value: "AO:244", label: "Angola (+244)" },
  { value: "AI:1264", label: "Anguilla (+1264)" },
  { value: "AQ:672", label: "Antártida (+672)" },
  { value: "AG:1268", label: "Antígua e Barbuda (+1268)" },
  { value: "SA:966", label: "Arábia Saudita (+966)" },
  { value: "DZ:213", label: "Argélia (+213)" },
  { value: "AR:54", label: "Argentina (+54)" },
  { value: "AM:374", label: "Armênia (+374)" },
  { value: "AW:297", label: "Aruba (+297)" },
  { value: "AU:61", label: "Austrália (+61)" },
  { value: "AT:43", label: "Áustria (+43)" },
  { value: "AZ:994", label: "Azerbaijão (+994)" },
  { value: "BS:1242", label: "Bahamas (+1242)" },
  { value: "BH:973", label: "Bahrein (+973)" },
  { value: "BD:880", label: "Bangladesh (+880)" },
  { value: "BB:1246", label: "Barbados (+1246)" },
  { value: "BE:32", label: "Bélgica (+32)" },
  { value: "BZ:501", label: "Belize (+501)" },
  { value: "BJ:229", label: "Benin (+229)" },
  { value: "BM:1441", label: "Bermudas (+1441)" },
  { value: "BY:375", label: "Bielorrússia (+375)" },
  { value: "BO:591", label: "Bolívia (+591)" },
  { value: "BA:387", label: "Bósnia e Herzegovina (+387)" },
  { value: "BW:267", label: "Botsuana (+267)" },
  { value: "BN:673", label: "Brunei (+673)" },
  { value: "BG:359", label: "Bulgária (+359)" },
  { value: "BF:226", label: "Burkina Faso (+226)" },
  { value: "BI:257", label: "Burundi (+257)" },
  { value: "BT:975", label: "Butão (+975)" },
  { value: "CV:238", label: "Cabo Verde (+238)" },
  { value: "CM:237", label: "Camarões (+237)" },
  { value: "KH:855", label: "Camboja (+855)" },
  { value: "CA:1", label: "Canadá (+1)" },
  { value: "QA:974", label: "Catar (+974)" },
  { value: "KZ:7", label: "Cazaquistão (+7)" },
  { value: "TD:235", label: "Chade (+235)" },
  { value: "CL:56", label: "Chile (+56)" },
  { value: "CN:86", label: "China (+86)" },
  { value: "CY:357", label: "Chipre (+357)" },
  { value: "SG:65", label: "Cingapura (+65)" },
  { value: "CO:57", label: "Colômbia (+57)" },
  { value: "KM:269", label: "Comores (+269)" },
  { value: "CG:242", label: "Congo (+242)" },
  { value: "CD:243", label: "Congo, República Democrática (+243)" },
  { value: "KR:82", label: "Coreia do Sul (+82)" },
  { value: "KP:850", label: "Coreia do Norte (+850)" },
  { value: "CI:225", label: "Costa do Marfim (+225)" },
  { value: "CR:506", label: "Costa Rica (+506)" },
  { value: "HR:385", label: "Croácia (+385)" },
  { value: "CU:53", label: "Cuba (+53)" },
  { value: "CW:599", label: "Curaçao (+599)" },
  { value: "DK:45", label: "Dinamarca (+45)" },
  { value: "DJ:253", label: "Djibuti (+253)" },
  { value: "DM:1767", label: "Dominica (+1767)" },
  { value: "EG:20", label: "Egito (+20)" },
  { value: "SV:503", label: "El Salvador (+503)" },
  { value: "AE:971", label: "Emirados Árabes Unidos (+971)" },
  { value: "EC:593", label: "Equador (+593)" },
  { value: "ER:291", label: "Eritreia (+291)" },
  { value: "SK:421", label: "Eslováquia (+421)" },
  { value: "SI:386", label: "Eslovênia (+386)" },
  { value: "ES:34", label: "Espanha (+34)" },
  { value: "US:1", label: "Estados Unidos (+1)" },
  { value: "EE:372", label: "Estônia (+372)" },
  { value: "SZ:268", label: "Essuatíni (+268)" },
  { value: "ET:251", label: "Etiópia (+251)" },
  { value: "FJ:679", label: "Fiji (+679)" },
  { value: "PH:63", label: "Filipinas (+63)" },
  { value: "FI:358", label: "Finlândia (+358)" },
  { value: "FR:33", label: "França (+33)" },
  { value: "GA:241", label: "Gabão (+241)" },
  { value: "GM:220", label: "Gâmbia (+220)" },
  { value: "GH:233", label: "Gana (+233)" },
  { value: "GE:995", label: "Geórgia (+995)" },
  { value: "GI:350", label: "Gibraltar (+350)" },
  { value: "GD:1473", label: "Granada (+1473)" },
  { value: "GR:30", label: "Grécia (+30)" },
  { value: "GL:299", label: "Groenlândia (+299)" },
  { value: "GP:590", label: "Guadalupe (+590)" },
  { value: "GU:1671", label: "Guam (+1671)" },
  { value: "GT:502", label: "Guatemala (+502)" },
  { value: "GG:44", label: "Guernsey (+44)" },
  { value: "GY:592", label: "Guiana (+592)" },
  { value: "GF:594", label: "Guiana Francesa (+594)" },
  { value: "GN:224", label: "Guiné (+224)" },
  { value: "GQ:240", label: "Guiné Equatorial (+240)" },
  { value: "GW:245", label: "Guiné-Bissau (+245)" },
  { value: "HT:509", label: "Haiti (+509)" },
  { value: "HN:504", label: "Honduras (+504)" },
  { value: "HK:852", label: "Hong Kong (+852)" },
  { value: "HU:36", label: "Hungria (+36)" },
  { value: "YE:967", label: "Iêmen (+967)" },
  { value: "BV:47", label: "Ilha Bouvet (+47)" },
  { value: "CX:61", label: "Ilha Christmas (+61)" },
  { value: "IM:44", label: "Ilha de Man (+44)" },
  { value: "NF:672", label: "Ilha Norfolk (+672)" },
  { value: "AX:358", label: "Ilhas Åland (+358)" },
  { value: "KY:1345", label: "Ilhas Cayman (+1345)" },
  { value: "CC:61", label: "Ilhas Cocos (+61)" },
  { value: "CK:682", label: "Ilhas Cook (+682)" },
  { value: "FO:298", label: "Ilhas Faroe (+298)" },
  { value: "GS:500", label: "Ilhas Geórgia do Sul e Sandwich do Sul (+500)" },
  { value: "FK:500", label: "Ilhas Malvinas (+500)" },
  { value: "MP:1670", label: "Ilhas Marianas do Norte (+1670)" },
  { value: "MH:692", label: "Ilhas Marshall (+692)" },
  { value: "UM:1", label: "Ilhas Menores Distantes dos EUA (+1)" },
  { value: "PN:64", label: "Ilhas Pitcairn (+64)" },
  { value: "SB:677", label: "Ilhas Salomão (+677)" },
  { value: "TC:1649", label: "Ilhas Turcas e Caicos (+1649)" },
  { value: "VG:1284", label: "Ilhas Virgens Britânicas (+1284)" },
  { value: "VI:1340", label: "Ilhas Virgens dos EUA (+1340)" },
  { value: "IN:91", label: "Índia (+91)" },
  { value: "ID:62", label: "Indonésia (+62)" },
  { value: "IR:98", label: "Irã (+98)" },
  { value: "IQ:964", label: "Iraque (+964)" },
  { value: "IE:353", label: "Irlanda (+353)" },
  { value: "IS:354", label: "Islândia (+354)" },
  { value: "IL:972", label: "Israel (+972)" },
  { value: "IT:39", label: "Itália (+39)" },
  { value: "JM:1876", label: "Jamaica (+1876)" },
  { value: "JP:81", label: "Japão (+81)" },
  { value: "JE:44", label: "Jersey (+44)" },
  { value: "JO:962", label: "Jordânia (+962)" },
  { value: "XK:383", label: "Kosovo (+383)" },
  { value: "KW:965", label: "Kuwait (+965)" },
  { value: "LA:856", label: "Laos (+856)" },
  { value: "LS:266", label: "Lesoto (+266)" },
  { value: "LV:371", label: "Letônia (+371)" },
  { value: "LB:961", label: "Líbano (+961)" },
  { value: "LR:231", label: "Libéria (+231)" },
  { value: "LY:218", label: "Líbia (+218)" },
  { value: "LI:423", label: "Liechtenstein (+423)" },
  { value: "LT:370", label: "Lituânia (+370)" },
  { value: "LU:352", label: "Luxemburgo (+352)" },
  { value: "MO:853", label: "Macau (+853)" },
  { value: "MK:389", label: "Macedônia do Norte (+389)" },
  { value: "MG:261", label: "Madagascar (+261)" },
  { value: "YT:262", label: "Maiote (+262)" },
  { value: "MY:60", label: "Malásia (+60)" },
  { value: "MW:265", label: "Malawi (+265)" },
  { value: "MV:960", label: "Maldivas (+960)" },
  { value: "ML:223", label: "Mali (+223)" },
  { value: "MT:356", label: "Malta (+356)" },
  { value: "MA:212", label: "Marrocos (+212)" },
  { value: "MQ:596", label: "Martinica (+596)" },
  { value: "MU:230", label: "Maurício (+230)" },
  { value: "MR:222", label: "Mauritânia (+222)" },
  { value: "MX:52", label: "México (+52)" },
  { value: "FM:691", label: "Micronésia (+691)" },
  { value: "MZ:258", label: "Moçambique (+258)" },
  { value: "MD:373", label: "Moldávia (+373)" },
  { value: "MC:377", label: "Mônaco (+377)" },
  { value: "MN:976", label: "Mongólia (+976)" },
  { value: "ME:382", label: "Montenegro (+382)" },
  { value: "MS:1664", label: "Montserrat (+1664)" },
  { value: "MM:95", label: "Myanmar (+95)" },
  { value: "NA:264", label: "Namíbia (+264)" },
  { value: "NR:674", label: "Nauru (+674)" },
  { value: "NP:977", label: "Nepal (+977)" },
  { value: "NI:505", label: "Nicarágua (+505)" },
  { value: "NE:227", label: "Níger (+227)" },
  { value: "NG:234", label: "Nigéria (+234)" },
  { value: "NU:683", label: "Niue (+683)" },
  { value: "NO:47", label: "Noruega (+47)" },
  { value: "NC:687", label: "Nova Caledônia (+687)" },
  { value: "NZ:64", label: "Nova Zelândia (+64)" },
  { value: "OM:968", label: "Omã (+968)" },
  { value: "BQ:599", label: "Países Baixos Caribenhos (+599)" },
  { value: "NL:31", label: "Países Baixos (+31)" },
  { value: "PW:680", label: "Palau (+680)" },
  { value: "PS:970", label: "Palestina (+970)" },
  { value: "PA:507", label: "Panamá (+507)" },
  { value: "PG:675", label: "Papua-Nova Guiné (+675)" },
  { value: "PK:92", label: "Paquistão (+92)" },
  { value: "PY:595", label: "Paraguai (+595)" },
  { value: "PE:51", label: "Peru (+51)" },
  { value: "PF:689", label: "Polinésia Francesa (+689)" },
  { value: "PL:48", label: "Polônia (+48)" },
  { value: "PR:1787", label: "Porto Rico (+1787)" },
  { value: "PT:351", label: "Portugal (+351)" },
  { value: "KE:254", label: "Quênia (+254)" },
  { value: "KG:996", label: "Quirguistão (+996)" },
  { value: "KI:686", label: "Quiribati (+686)" },
  { value: "GB:44", label: "Reino Unido (+44)" },
  { value: "CF:236", label: "República Centro-Africana (+236)" },
  { value: "DO:1809", label: "República Dominicana (+1809)" },
  { value: "CZ:420", label: "República Tcheca (+420)" },
  { value: "RE:262", label: "Reunião (+262)" },
  { value: "RO:40", label: "Romênia (+40)" },
  { value: "RW:250", label: "Ruanda (+250)" },
  { value: "RU:7", label: "Rússia (+7)" },
  { value: "EH:212", label: "Saara Ocidental (+212)" },
  { value: "WS:685", label: "Samoa (+685)" },
  { value: "AS:1684", label: "Samoa Americana (+1684)" },
  { value: "SM:378", label: "San Marino (+378)" },
  { value: "SH:290", label: "Santa Helena (+290)" },
  { value: "LC:1758", label: "Santa Lúcia (+1758)" },
  { value: "BL:590", label: "São Bartolomeu (+590)" },
  { value: "KN:1869", label: "São Cristóvão e Névis (+1869)" },
  { value: "MF:590", label: "São Martinho (+590)" },
  { value: "PM:508", label: "São Pedro e Miquelão (+508)" },
  { value: "ST:239", label: "São Tomé e Príncipe (+239)" },
  { value: "VC:1784", label: "São Vicente e Granadinas (+1784)" },
  { value: "SN:221", label: "Senegal (+221)" },
  { value: "SL:232", label: "Serra Leoa (+232)" },
  { value: "RS:381", label: "Sérvia (+381)" },
  { value: "SC:248", label: "Seychelles (+248)" },
  { value: "SX:1721", label: "Sint Maarten (+1721)" },
  { value: "SY:963", label: "Síria (+963)" },
  { value: "SO:252", label: "Somália (+252)" },
  { value: "LK:94", label: "Sri Lanka (+94)" },
  { value: "SD:249", label: "Sudão (+249)" },
  { value: "SS:211", label: "Sudão do Sul (+211)" },
  { value: "SE:46", label: "Suécia (+46)" },
  { value: "CH:41", label: "Suíça (+41)" },
  { value: "SR:597", label: "Suriname (+597)" },
  { value: "SJ:47", label: "Svalbard e Jan Mayen (+47)" },
  { value: "TH:66", label: "Tailândia (+66)" },
  { value: "TW:886", label: "Taiwan (+886)" },
  { value: "TJ:992", label: "Tajiquistão (+992)" },
  { value: "TZ:255", label: "Tanzânia (+255)" },
  { value: "IO:246", label: "Território Britânico do Oceano Índico (+246)" },
  { value: "TF:262", label: "Territórios Franceses do Sul (+262)" },
  { value: "TL:670", label: "Timor-Leste (+670)" },
  { value: "TG:228", label: "Togo (+228)" },
  { value: "TK:690", label: "Tokelau (+690)" },
  { value: "TO:676", label: "Tonga (+676)" },
  { value: "TT:1868", label: "Trinidad e Tobago (+1868)" },
  { value: "TN:216", label: "Tunísia (+216)" },
  { value: "TM:993", label: "Turcomenistão (+993)" },
  { value: "TR:90", label: "Turquia (+90)" },
  { value: "TV:688", label: "Tuvalu (+688)" },
  { value: "UA:380", label: "Ucrânia (+380)" },
  { value: "UG:256", label: "Uganda (+256)" },
  { value: "UY:598", label: "Uruguai (+598)" },
  { value: "UZ:998", label: "Uzbequistão (+998)" },
  { value: "VU:678", label: "Vanuatu (+678)" },
  { value: "VA:39", label: "Vaticano (+39)" },
  { value: "VE:58", label: "Venezuela (+58)" },
  { value: "VN:84", label: "Vietnã (+84)" },
  { value: "WF:681", label: "Wallis e Futuna (+681)" },
  { value: "ZM:260", label: "Zâmbia (+260)" },
  { value: "ZW:263", label: "Zimbábue (+263)" },
] as const;

const DEFAULT_MEAL_SCHEDULES: MealScheduleState[] = [
  { mealLabel: "café da manhã", startTime: "05:00", endTime: "10:59", enabled: true },
  { mealLabel: "almoço", startTime: "11:00", endTime: "14:59", enabled: true },
  { mealLabel: "lanche da tarde", startTime: "15:00", endTime: "17:29", enabled: true },
  { mealLabel: "pré-treino", startTime: "17:30", endTime: "18:29", enabled: true },
  { mealLabel: "jantar", startTime: "18:30", endTime: "22:59", enabled: true },
  { mealLabel: "ceia", startTime: "23:00", endTime: "04:59", enabled: true },
];

const OPTIONAL_ONBOARDING_FALLBACK = {
  name: "Usuário",
  birthDate: "1990-01-01",
  heightCm: 170,
  currentWeightKg: 70,
} as const;

type MealScheduleState = {
  mealLabel: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

type FormState = {
  name: string;
  birthDate: string;
  heightCm: string;
  currentWeightKg: string;
  objective: typeof OBJECTIVE_OPTIONS[number]["value"];
  activityLevel: typeof ACTIVITY_OPTIONS[number]["value"];
  trackingExperience: typeof EXPERIENCE_OPTIONS[number]["value"];
  dietaryPreferences: string;
  dietaryRestrictions: string;
  eatingRoutine: typeof ROUTINE_OPTIONS[number]["value"];
  mainDifficulty: typeof DIFFICULTY_OPTIONS[number]["value"];
};

const initialForm: FormState = {
  name: "",
  birthDate: "",
  heightCm: "",
  currentWeightKg: "",
  objective: "melhorar_habitos",
  activityLevel: "moderate",
  trackingExperience: "beginner",
  dietaryPreferences: "",
  dietaryRestrictions: "",
  eatingRoutine: "misto",
  mainDifficulty: "falta_de_planejamento",
};

function splitList(value: string) {
  return value
    .split(/[,;\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function joinList(value: string[] | null | undefined) {
  return value?.join(", ") ?? "";
}

function parseOptionalDecimalInput(value: string) {
  if (!value.trim()) return undefined;
  return parseDecimalInputPtBr(value);
}

function parseHeightInputToCentimeters(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const directDecimal = trimmed.replace(/\s/g, "").replace(",", ".");
  const parsed = /^\d+(\.\d+)?$/.test(directDecimal)
    ? Number(directDecimal)
    : parseDecimalInputPtBr(trimmed);

  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  if (parsed < 3) return Math.round(parsed * 1000) / 10;
  return parsed;
}

function formatHeightInputFromCentimeters(value: number | null | undefined) {
  if (!value) return "";
  if (value >= 100) {
    return formatNumberPtBr(value / 100, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return formatNumberPtBr(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatWeightInput(value: number | null | undefined) {
  if (!value) return "";
  return formatNumberPtBr(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function calculateAgeYears(birthDate: string, referenceDate = new Date()) {
  if (!birthDate) return null;

  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year || !month || !day) return null;

  const parsedDate = new Date(year, month - 1, day);
  const isSameDate = parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
  if (!isSameDate || parsedDate.getTime() > referenceDate.getTime()) return null;

  let age = referenceDate.getFullYear() - year;
  const birthdayAlreadyHappened = referenceDate.getMonth() > month - 1 || (referenceDate.getMonth() === month - 1 && referenceDate.getDate() >= day);
  if (!birthdayAlreadyHappened) age -= 1;
  return age;
}

function hasInvalidScheduleTime(schedules: MealScheduleState[]) {
  return schedules.some(
    schedule => !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.endTime),
  );
}\n
function createNewMealSchedule(): MealScheduleState {
  return { mealLabel: "", startTime: "12:00", endTime: "12:59", enabled: true };
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function countryCallingCode(countryOption: string) {
  return countryOption.split(":")[1] ?? countryOption;
}

function normalizeNationalPhoneDigits(value: string, countryOption: string) {
  const countryCode = countryCallingCode(countryOption);
  const digits = phoneDigits(value);
  if (digits.startsWith(countryCode) && digits.length > Math.max(11, countryCode.length + 4)) {
    return digits.slice(countryCode.length);
  }

  return digits;
}

function buildWhatsappPhoneNumber(countryOption: string, nationalNumber: string) {
  const countryCode = countryCallingCode(countryOption);
  const nationalDigits = normalizeNationalPhoneDigits(nationalNumber, countryOption);
  return nationalDigits ? `${countryCode}${nationalDigits}` : "";
}

function hasValidNationalPhone(value: string, countryOption: string) {
  const countryCode = countryCallingCode(countryOption);
  const digits = normalizeNationalPhoneDigits(value, countryOption);
  if (countryCode === "55") return digits.length === 10 || digits.length === 11;

  const totalDigits = countryCode.length + digits.length;
  return digits.length >= 4 && totalDigits <= 15;
}

function formatPhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = phoneDigits(trimmed);
  if (!digits) return "";

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return trimmed;
}

export default function OnboardingPage() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [nameEdited, setNameEdited] = useState(false);
  const [savedProfileApplied, setSavedProfileApplied] = useState(false);
  const [schedulesApplied, setSchedulesApplied] = useState(false);
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_PHONE_COUNTRY_OPTION);
  const [phoneNationalNumber, setPhoneNationalNumber] = useState("");
  const [sendWhatsappGreeting, setSendWhatsappGreeting] = useState(false);
  const [acceptedOperationalWhatsappGreeting, setAcceptedOperationalWhatsappGreeting] = useState(false);
  const [mealSchedules, setMealSchedules] = useState<MealScheduleState[]>(DEFAULT_MEAL_SCHEDULES);
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    name: user?.name?.trim() ?? "",
  }));

  const whatsappStatusQuery = trpc.nutrition.whatsapp.status.useQuery();
  const savedProfileQuery = trpc.nutrition.onboarding.profile.useQuery();
  const mealSchedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const professionalProfileQuery = trpc.nutrition.professionals.profile.useQuery(undefined, { retry: false });
  const userName = user?.name?.trim() ?? "";
  const userEmail = user?.email?.trim() ?? "";
  const whatsappPhoneNumber = whatsappStatusQuery.data?.connection?.phoneNumber ?? "";
  const hasWhatsappConnection = Boolean(whatsappPhoneNumber);
  const canEditPhone = !hasWhatsappConnection;
  const pendingWhatsappPhoneNumber = buildWhatsappPhoneNumber(phoneCountryCode, phoneNationalNumber);
  const shouldAttachWhatsappPhone = canEditPhone && Boolean(phoneNationalNumber.trim());
  const contactPhoneNumber = formatPhoneNumber(hasWhatsappConnection ? whatsappPhoneNumber : pendingWhatsappPhoneNumber);

  useEffect(() => {
    const profile = savedProfileQuery.data;
    if (!profile || savedProfileApplied) return;

    setForm({
      name: profile.name || userName,
      birthDate: profile.birthDate ?? "",
      heightCm: formatHeightInputFromCentimeters(profile.heightCm),
      currentWeightKg: formatWeightInput(profile.currentWeightKg),
      objective: profile.objective,
      activityLevel: profile.activityLevel,
      trackingExperience: profile.trackingExperience,
      dietaryPreferences: joinList(profile.dietaryPreferences),
      dietaryRestrictions: joinList(profile.dietaryRestrictions),
      eatingRoutine: profile.eatingRoutine,
      mainDifficulty: profile.mainDifficulty,
    });
    setNameEdited(Boolean(profile.name));
    setSavedProfileApplied(true);
  }, [savedProfileApplied, savedProfileQuery.data, userName]);

  useEffect(() => {
    if (!nameEdited && userName && !form.name.trim()) {
      setForm(current => ({ ...current, name: userName }));
    }
  }, [form.name, nameEdited, userName]);

  useEffect(() => {
    if (!mealSchedulesQuery.data || schedulesApplied) return;
    setMealSchedules(mealSchedulesQuery.data as MealScheduleState[]);
    setSchedulesApplied(true);
  }, [mealSchedulesQuery.data, schedulesApplied]);

  useEffect(() => {
    setPhoneCountryCode(DEFAULT_PHONE_COUNTRY_OPTION);
    setPhoneNationalNumber(whatsappPhoneNumber ? normalizeNationalPhoneDigits(whatsappPhoneNumber, DEFAULT_PHONE_COUNTRY_OPTION) : "");
    if (!whatsappPhoneNumber) {
      setSendWhatsappGreeting(false);
      setAcceptedOperationalWhatsappGreeting(false);
    }
  }, [whatsappPhoneNumber]);

  const calculatedAgeYears = useMemo(() => calculateAgeYears(form.birthDate), [form.birthDate]);

  const parsed = useMemo(() => ({
    name: form.name.trim(),
    birthDate: form.birthDate,
    heightCm: parseHeightInputToCentimeters(form.heightCm),
    currentWeightKg: parseOptionalDecimalInput(form.currentWeightKg),
    objective: form.objective,
    activityLevel: form.activityLevel,
    trackingExperience: form.trackingExperience,
    dietaryPreferences: splitList(form.dietaryPreferences),
    dietaryRestrictions: splitList(form.dietaryRestrictions),
    eatingRoutine: form.eatingRoutine,
    mainDifficulty: form.mainDifficulty,
  }), [form]);

  const validationMessage = useMemo(() => {
    if (parsed.name && parsed.name.length < 2) return "Informe um nome com pelo menos 2 caracteres ou deixe o campo em branco.";
    if (parsed.birthDate && calculatedAgeYears === null) return "Informe uma data de nascimento válida ou deixe o campo em branco.";
    if (calculatedAgeYears !== null && (calculatedAgeYears < 13 || calculatedAgeYears > 120)) return "A idade calculada deve estar entre 13 e 120 anos.";
    if (form.heightCm.trim() && parsed.heightCm === undefined) return "Informe uma altura válida ou deixe o campo em branco.";
    if (parsed.heightCm !== undefined && (parsed.heightCm < 100 || parsed.heightCm > 250)) return "Informe uma altura válida entre 1,00 m e 2,50 m, ou deixe o campo em branco.";
    if (parsed.currentWeightKg !== undefined && (parsed.currentWeightKg < 25 || parsed.currentWeightKg > 350)) return "Informe um peso atual válido ou deixe o campo em branco.";
    if (shouldAttachWhatsappPhone && !hasValidNationalPhone(phoneNationalNumber, phoneCountryCode)) return "Informe um telefone válido para vincular ao WhatsApp.";
    if ((shouldAttachWhatsappPhone || sendWhatsappGreeting) && !acceptedOperationalWhatsappGreeting) return "Autorize o contato operacional pelo WhatsApp para receber a saudação.";
    return null;
  }, [acceptedOperationalWhatsappGreeting, calculatedAgeYears, form.heightCm, parsed, phoneCountryCode, phoneNationalNumber, sendWhatsappGreeting, shouldAttachWhatsappPhone]);

  const payload = useMemo(() => ({
    name: parsed.name || userName || OPTIONAL_ONBOARDING_FALLBACK.name,
    birthDate: parsed.birthDate || OPTIONAL_ONBOARDING_FALLBACK.birthDate,
    heightCm: parsed.heightCm ?? OPTIONAL_ONBOARDING_FALLBACK.heightCm,
    currentWeightKg: parsed.currentWeightKg ?? OPTIONAL_ONBOARDING_FALLBACK.currentWeightKg,
    objective: parsed.objective,
    activityLevel: parsed.activityLevel,
    trackingExperience: parsed.trackingExperience,
    dietaryPreferences: parsed.dietaryPreferences,
    dietaryRestrictions: parsed.dietaryRestrictions,
    eatingRoutine: parsed.eatingRoutine,
    mainDifficulty: parsed.mainDifficulty,
  }), [parsed, userName]);

  const sendWhatsappGreetingMutation = trpc.auth.sendWhatsappGreeting?.useMutation?.() ?? {
    isPending: false,
    mutateAsync: async () => ({ status: "skipped" as const, reason: "no_phone" as const, detail: "Saudação indisponível neste ambiente." }),
  };
  const saveWhatsappConnection = trpc.nutrition.whatsapp.upsertConnection.useMutation({
    onSuccess: async () => {
      await utils.nutrition.whatsapp.status.invalidate();
    },
  });

  async function sendGreetingToast() {
    const greeting = await sendWhatsappGreetingMutation.mutateAsync({ acceptedOperationalWhatsapp: true });
    if (greeting.status === "sent") {
      toast.success("Saudação enviada pelo WhatsApp.");
    } else if (greeting.reason === "duplicate") {
      toast.success("Saudação pelo WhatsApp já havia sido enviada.");
    } else {
      toast.error(greeting.detail || "Perfil salvo, mas a saudação não foi enviada pelo WhatsApp.");
    }
  }

  const completeOnboarding = trpc.nutrition.onboarding.complete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.nutrition.onboarding.profile.invalidate(),
        utils.nutrition.goals.get.invalidate(),
        utils.nutrition.dashboard.overview.invalidate(),
        utils.nutrition.dashboard.today.invalidate(),
        utils.nutrition.reports.weekly.invalidate(),
      ]);

      if (shouldAttachWhatsappPhone) {
        try {
          await saveWhatsappConnection.mutateAsync({
            phoneNumber: pendingWhatsappPhoneNumber,
            displayName: payload.name,
          });
          await sendGreetingToast();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Perfil salvo, mas não foi possível vincular o telefone ao WhatsApp.");
          return;
        }
      } else if (sendWhatsappGreeting && acceptedOperationalWhatsappGreeting && hasWhatsappConnection) {
        try {
          await sendGreetingToast();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Perfil salvo, mas a saudação não foi enviada pelo WhatsApp.");
        }
      }

      toast.success("Perfil salvo com sucesso.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar as configurações."),
  });

  const updateMealSchedules = trpc.nutrition.mealSchedules.update.useMutation({
    onSuccess: async () => {
      await utils.nutrition.mealSchedules.list.invalidate();
      toast.success("Refeições habituais salvas com sucesso.");
    },
    onError: error => toast.error(error.message || "Não foi possível salvar as refeições habituais."),
  });

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    if (field === "name") setNameEdited(true);
    setForm(current => ({ ...current, [field]: value }));
  }

  function updateSchedule<K extends keyof MealScheduleState>(index: number, field: K, value: MealScheduleState[K]) {
    setMealSchedules(current => current.map((schedule, currentIndex) => currentIndex === index ? { ...schedule, [field]: value } : schedule));
  }

  function handleSaveProfile() {
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    completeOnboarding.mutate(payload);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    handleSaveProfile();
  }

  function handleSaveMealSchedules() {
    const normalizedSchedules = mealSchedules.map(schedule => ({ ...schedule, mealLabel: schedule.mealLabel.trim() }));
    if (normalizedSchedules.some(schedule => !schedule.mealLabel)) {
      toast.error("Informe o nome de todas as refeições habituais.");
      return;
    }
    if (hasInvalidScheduleTime(normalizedSchedules)) {
      toast.error("Revise os horários das refeições habituais. Use o formato HH:mm.");
      return;
    }
    updateMealSchedules.mutate({ schedules: normalizedSchedules });
  }

  const activeSchedules = mealSchedules.filter(schedule => schedule.enabled).length;
  const professionalProfileActive = Boolean(professionalProfileQuery.data?.active);
  const isSavingProfile = completeOnboarding.isPending || saveWhatsappConnection.isPending || sendWhatsappGreetingMutation.isPending;
  const completionStats = (
    <div className="grid gap-3 sm:grid-cols-4">
      <IntroStat label="Perfil" value={form.name.trim() ? "preenchido" : "pendente"} helper={calculatedAgeYears === null ? "idade opcional" : `${calculatedAgeYears} anos`} />
      <IntroStat label="Objetivo" value={OBJECTIVE_OPTIONS.find(option => option.value === form.objective)?.label ?? "definido"} helper={ACTIVITY_OPTIONS.find(option => option.value === form.activityLevel)?.label ?? "rotina"} />
      <IntroStat label="Refeições" value={`${activeSchedules} ativas`} helper={`${mealSchedules.length} faixas configuradas`} />
      <IntroStat label="Profissional" value={professionalProfileActive ? "ativo" : "inativo"} helper="módulo nutricionista" />
    </div>
  );

  return (
    <DashboardLayout>
      <form className="mx-auto flex w-full max-w-7xl flex-col gap-6" onSubmit={handleSubmit}>
        <PageIntro
          eyebrow="Configurações"
          title="Ajuste seu perfil sem se perder em blocos longos"
          description="Organizamos a tela em etapas curtas para reduzir rolagem, facilitar revisões rápidas e deixar as refeições habituais mais simples de manter no dia a dia."
          stats={completionStats}
          actions={
            <Button className="h-11 rounded-full px-5" disabled={isSavingProfile} type="submit">
              {isSavingProfile ? "Salvando..." : "Salvar configurações"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          }
        />

        {validationMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {validationMessage}
          </div>
        ) : null}

        <Tabs defaultValue="perfil" className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-2xl bg-muted/60 p-2 md:grid-cols-4">
            <TabsTrigger className="min-h-11 rounded-xl" value="perfil">
              <UserRound className="h-4 w-4" />
              Perfil
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="objetivos">
              <Target className="h-4 w-4" />
              Objetivos e rotina
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="refeicoes">
              <Clock3 className="h-4 w-4" />
              Refeições habituais
            </TabsTrigger>
            <TabsTrigger className="min-h-11 rounded-xl" value="profissional">
              <Stethoscope className="h-4 w-4" />
              Profissional
            </TabsTrigger>
          </TabsList>

          <TabsContent value="perfil" className="space-y-4">
            <Card defaultOpen className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <UserRound className="h-5 w-5 text-primary" />
                  Identificação e base física
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <TextField label="Nome" value={form.name} onChange={value => updateField("name", value)} optional />
                  {canEditPhone ? (
                    <PhoneNumberField
                      countryCode={phoneCountryCode}
                      countryOptions={COUNTRY_CODE_OPTIONS}
                      nationalNumber={phoneNationalNumber}
                      onCountryCodeChange={setPhoneCountryCode}
                      onNationalNumberChange={setPhoneNationalNumber}
                      optional
                    />
                  ) : (
                    <ReadOnlyField label="Telefone" value={contactPhoneNumber || "Não informado"} />
                  )}
                  <ReadOnlyField label="E-mail" value={userEmail || "Não informado"} />
                  <TextField label="Data de nascimento" type="date" value={form.birthDate} onChange={value => updateField("birthDate", value)} optional />
                  <ReadOnlyField label="Idade calculada" value={calculatedAgeYears === null ? "Preencha se quiser calcular" : `${calculatedAgeYears} anos`} />
                  <TextField label="Altura" suffix="m ou cm" inputMode="decimal" value={form.heightCm} onChange={value => updateField("heightCm", value)} optional placeholder="Ex.: 1,72 ou 172" />
                  <TextField label="Peso atual" suffix="kg" inputMode="decimal" value={form.currentWeightKg} onChange={value => updateField("currentWeightKg", value)} optional placeholder="Ex.: 72,5" />
                </div>
                <div className="flex justify-end">
                  <Button type="button" className="rounded-full" disabled={isSavingProfile} onClick={handleSaveProfile}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSavingProfile ? "Salvando perfil..." : "Salvar perfil"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {hasWhatsappConnection || shouldAttachWhatsappPhone ? (
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessageCircle className="h-5 w-5 text-primary" />
                    Saudação pelo WhatsApp
                  </CardTitle>
                  <CardDescription>
                    {shouldAttachWhatsappPhone
                      ? "Ao salvar este telefone pela primeira vez, enviaremos uma mensagem única de boas-vindas para confirmar o canal."
                      : "Envie uma mensagem única de boas-vindas para reforçar que este é o canal rápido para registrar refeições, água e exercícios."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {hasWhatsappConnection ? (
                    <ConsentToggle
                      checked={sendWhatsappGreeting}
                      onChange={setSendWhatsappGreeting}
                      label="Enviar saudação de boas-vindas pelo WhatsApp após salvar."
                      description={`Será enviada para ${contactPhoneNumber}.`}
                    />
                  ) : null}
                  <ConsentToggle
                    checked={acceptedOperationalWhatsappGreeting}
                    disabled={hasWhatsappConnection && !sendWhatsappGreeting}
                    onChange={setAcceptedOperationalWhatsappGreeting}
                    label="Autorizo o contato operacional pelo WhatsApp para receber esta saudação."
                    description={shouldAttachWhatsappPhone ? `Será enviada para ${contactPhoneNumber}.` : "Este aceite é separado de marketing e não habilita disparos recorrentes."}
                  />
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="objetivos">
            <Card defaultOpen className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Activity className="h-5 w-5 text-primary" />
                  Objetivos, rotina e contexto alimentar
                </CardTitle>
                <CardDescription>
                  Agrupamos as decisões de rotina em uma única superfície para deixar a leitura mais rápida em desktop e tablet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <SelectField label="Objetivo" value={form.objective} options={OBJECTIVE_OPTIONS} onChange={value => updateField("objective", value as FormState["objective"])} />
                  <SelectField label="Nível de atividade física" value={form.activityLevel} options={ACTIVITY_OPTIONS} onChange={value => updateField("activityLevel", value as FormState["activityLevel"])} />
                  <SelectField label="Experiência com controle alimentar" value={form.trackingExperience} options={EXPERIENCE_OPTIONS} onChange={value => updateField("trackingExperience", value as FormState["trackingExperience"])} />
                  <SelectField label="Rotina alimentar" value={form.eatingRoutine} options={ROUTINE_OPTIONS} onChange={value => updateField("eatingRoutine", value as FormState["eatingRoutine"])} />
                  <SelectField label="Principal dificuldade" value={form.mainDifficulty} options={DIFFICULTY_OPTIONS} onChange={value => updateField("mainDifficulty", value as FormState["mainDifficulty"])} />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <TextAreaField label="Preferências alimentares" value={form.dietaryPreferences} onChange={value => updateField("dietaryPreferences", value)} placeholder="Ex.: comida caseira, vegetariano, café da manhã simples" optional />
                  <TextAreaField label="Restrições alimentares" value={form.dietaryRestrictions} onChange={value => updateField("dietaryRestrictions", value)} placeholder="Ex.: lactose, glúten, amendoim" optional />
                </div>
                <div className="flex justify-end">
                  <Button type="button" className="rounded-full" disabled={isSavingProfile} onClick={handleSaveProfile}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSavingProfile ? "Salvando objetivos..." : "Salvar objetivos e rotina"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="refeicoes">
            <Card defaultOpen className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Clock3 className="h-5 w-5 text-primary" />
                  Refeições habituais
                </CardTitle>
                <CardDescription>
                  Os horários foram compactados em linhas editáveis para evitar cartões dentro de cartões e reduzir rolagem desnecessária.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    Crie refeições com nomes livres, como “lanche da tarde”, “pré-treino”, “pós-treino” ou “ceia”. O registro usa esses horários para sugerir automaticamente a refeição mais adequada.
                  </div>
                  <div className="rounded-2xl border bg-background p-4">
                    <p className="text-sm font-medium tracking-tight">Resumo rápido</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <InlineMetric label="Faixas ativas" value={String(activeSchedules)} />
                      <InlineMetric label="Total configurado" value={String(mealSchedules.length)} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  {mealSchedules.map((schedule, index) => (
                    <div key={`${schedule.mealLabel}-${index}`} className="grid gap-3 rounded-2xl border bg-background p-4 lg:grid-cols-[minmax(0,1.2fr)_140px_140px_auto_auto] lg:items-center">
                      <div className="space-y-2">
                        <FieldLabel label={`Refeição ${index + 1}`} />
                        <Input
                          value={schedule.mealLabel}
                          onChange={event => updateSchedule(index, "mealLabel", event.target.value)}
                          placeholder="Ex.: lanche da tarde"
                          list="meal-label-suggestions"
                        />
                      </div>
                      <TextField compact label="Início" type="time" value={schedule.startTime} onChange={value => updateSchedule(index, "startTime", value)} />
                      <TextField compact label="Fim" type="time" value={schedule.endTime} onChange={value => updateSchedule(index, "endTime", value)} />
                      <label className="flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium">
                        <Checkbox checked={schedule.enabled} onCheckedChange={value => updateSchedule(index, "enabled", Boolean(value))} />
                        Ativa
                      </label>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-11 w-11 rounded-xl text-destructive hover:text-destructive"
                        disabled={mealSchedules.length <= 1}
                        onClick={() => setMealSchedules(current => current.filter((_, currentIndex) => currentIndex !== index))}
                        aria-label="Remover refeição habitual"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <datalist id="meal-label-suggestions">
                  {MEAL_LABEL_SUGGESTIONS.map(label => <option key={label} value={label} />)}
                </datalist>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setMealSchedules(current => [...current, createNewMealSchedule()])} disabled={mealSchedules.length >= 12}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar refeição
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setMealSchedules(DEFAULT_MEAL_SCHEDULES)}>
                    Restaurar padrão
                  </Button>
                  <Button type="button" className="rounded-full" disabled={updateMealSchedules.isPending} onClick={handleSaveMealSchedules}>
                    <Save className="mr-2 h-4 w-4" />
                    {updateMealSchedules.isPending ? "Salvando..." : "Salvar horários"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profissional">
            <ProfessionalProfileSettings />
          </TabsContent>
        </Tabs>
      </form>
    </DashboardLayout>
  );
}

function IntroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function FieldLabel({ label, optional = false }: { label: string; optional?: boolean }) {
  return (
    <Label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {optional ? <span className="text-xs font-normal text-muted-foreground">Opcional</span> : null}
    </Label>
  );
}

function ConsentToggle({ checked, onChange, label, description, disabled = false }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex gap-3 rounded-xl border bg-background p-4 text-sm ${disabled ? "opacity-60" : ""}`}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={value => onChange(Boolean(value))} />
      <span className="min-w-0">
        <span className="block font-medium leading-5">{label}</span>
        <span className="mt-1 block leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function TextField({ label, value, onChange, inputMode, suffix, type = "text", optional = false, placeholder, compact = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  suffix?: string;
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"];
  optional?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <div className={`min-w-0 space-y-2 rounded-2xl border ${compact ? "bg-muted/10 p-4" : "bg-background p-5"}`}>
      <FieldLabel label={label} optional={optional} />
      <div className="flex items-center gap-3">
        <Input type={type} inputMode={inputMode} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
        {suffix ? <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function PhoneNumberField({ countryCode, countryOptions, nationalNumber, onCountryCodeChange, onNationalNumberChange, optional = false }: {
  countryCode: string;
  countryOptions: readonly { value: string; label: string }[];
  nationalNumber: string;
  onCountryCodeChange: (value: string) => void;
  onNationalNumberChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
      <FieldLabel label="Telefone para WhatsApp" optional={optional} />
      <div className="grid gap-3 sm:grid-cols-[minmax(190px,0.8fr)_1fr]">
        <select
          aria-label="País e código do país"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={countryCode}
          onChange={event => onCountryCodeChange(event.target.value)}
        >
          {countryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <Input
          inputMode="tel"
          value={nationalNumber}
          onChange={event => onNationalNumberChange(event.target.value)}
          placeholder="Ex.: 11 99999-8888"
        />
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-muted/20 p-5">
      <Label>{label}</Label>
      <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function SelectField<T extends readonly { value: string; label: string }[]>({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: T;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
      <Label>{label}</Label>
      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder, optional = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  optional?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border bg-background p-5">
      <FieldLabel label={label} optional={optional} />
      <Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="min-h-28" />
    </div>
  );
}
