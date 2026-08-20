// Kontrola galerii ofert w czterech katalogach demonstracyjnych.

import { ZDJECIA, skalaDlaMetrazu } from "./data/zdjecia.js";
import type { Zdjecie } from "./data/zdjecia.js";
import { NIERUCHOMOSCI_WARSZAWA } from "./data/nieruchomosci-warszawa.js";
import { NIERUCHOMOSCI_KRAKOW } from "./data/nieruchomosci-krakow.js";
import { NIERUCHOMOSCI_WROCLAW } from "./data/nieruchomosci-wroclaw.js";
import { NIERUCHOMOSCI_TROJMIASTO } from "./data/nieruchomosci-trojmiasto.js";

const MAX_KROTNOSC = 3;

interface Oferta {
  readonly katalog: string;
  readonly title: string;
  readonly propertyType: string;
  readonly area: number | null;
  readonly images: readonly string[];
  readonly imageUrl: string;
}

const zebrane: readonly { nazwa: string; pozycje: readonly unknown[] }[] = [
  { nazwa: "Warszawa", pozycje: NIERUCHOMOSCI_WARSZAWA },
  { nazwa: "Kraków", pozycje: NIERUCHOMOSCI_KRAKOW },
  { nazwa: "Wrocław", pozycje: NIERUCHOMOSCI_WROCLAW },
  { nazwa: "Trójmiasto", pozycje: NIERUCHOMOSCI_TROJMIASTO },
];

const oferty: Oferta[] = zebrane.flatMap(({ nazwa, pozycje }) =>
  pozycje.map((p): Oferta => {
    const o = p as Record<string, unknown>;
    return {
      katalog: nazwa,
      title: String(o["title"]),
      propertyType: String(o["propertyType"]),
      area: typeof o["area"] === "number" ? o["area"] : null,
      images: (o["images"] as readonly string[]) ?? [],
      imageUrl: String(o["imageUrl"] ?? ""),
    };
  }),
);

const biblioteka = new Map<string, Zdjecie>(ZDJECIA.map((z) => [z.url, z]));
const bledy: string[] = [];

const krotnosc = new Map<string, number>();
const typyZdjecia = new Map<string, Set<string>>();
let sloty = 0;

for (const o of oferty) {
  sloty += o.images.length;
  if (o.images.length < 5 || o.images.length > 8)
    bledy.push(`galeria spoza zakresu 5-8 (${o.images.length}): ${o.katalog} — ${o.title}`);
  if (o.images[0] !== o.imageUrl)
    bledy.push(`imageUrl nie jest pierwszym zdjęciem galerii: ${o.katalog} — ${o.title}`);
  if (new Set(o.images).size !== o.images.length)
    bledy.push(`to samo zdjęcie dwa razy w jednej galerii: ${o.katalog} — ${o.title}`);

  for (const url of o.images) {
    krotnosc.set(url, (krotnosc.get(url) ?? 0) + 1);
    let typy = typyZdjecia.get(url);
    if (!typy) { typy = new Set(); typyZdjecia.set(url, typy); }
    typy.add(o.propertyType);
  }
}

const unikalne = krotnosc.size;
const powtarzane = [...krotnosc.values()].filter((n) => n > 1).length;
const maksKrotnosc = Math.max(...krotnosc.values());

const miedzyTypami = [...typyZdjecia].filter(([, typy]) => typy.size > 1);
for (const [url, typy] of miedzyTypami)
  bledy.push(`zdjęcie w ofertach różnych typów (${[...typy].join(", ")}): ${url}`);

const zaDuzeUjecia: string[] = [];
const spozaBiblioteki = new Set<string>();
let bezSkali = 0;

for (const o of oferty) {
  for (const url of o.images) {
    const z = biblioteka.get(url);
    if (!z) { spozaBiblioteki.add(url); continue; }
    if (z.skala === null) { bezSkali += 1; continue; }
    if (o.area !== null && o.area <= 40 && z.skala !== "MALY")
      zaDuzeUjecia.push(`${o.katalog} — ${o.title} (${o.area} m²): ujęcie ${z.skala} — ${z.opis}`);
  }
}
for (const url of spozaBiblioteki) bledy.push(`adres spoza biblioteki zdjecia.ts: ${url}`);
for (const w of zaDuzeUjecia) bledy.push(`ujęcie za duże do metrażu — ${w}`);

const odpowiednik: Record<string, string> = {
  APARTMENT: "APARTMENT", STUDIO: "APARTMENT", HOUSE: "HOUSE", ROOM: "ROOM",
  OFFICE: "OFFICE", COMMERCIAL: "COMMERCIAL", GARAGE: "GARAGE", PLOT: "PLOT",
};
let czesciWspolnePokoi = 0;
let pozaKategoria = 0;
for (const o of oferty)
  for (const url of o.images) {
    const z = biblioteka.get(url);
    if (!z || z.kategoria === odpowiednik[o.propertyType]) continue;
    const czescWspolna =
      o.propertyType === "ROOM" &&
      z.kategoria === "APARTMENT" &&
      z.skala === "MALY" &&
      ["kuchnia", "lazienka", "przedpokoj"].includes(z.ujecie);
    if (czescWspolna) czesciWspolnePokoi += 1;
    else {
      pozaKategoria += 1;
      bledy.push(`kategoria zdjęcia (${z.kategoria}) nie pasuje do typu oferty (${o.propertyType}): ${o.title}`);
    }
  }

let rolneNaBudowlanych = 0;
for (const o of oferty)
  if (o.propertyType === "PLOT")
    for (const url of o.images)
      if (biblioteka.get(url)?.parcela === "ROLNA") rolneNaBudowlanych += 1;
if (rolneNaBudowlanych > 0)
  bledy.push(`kadry rolne w ofertach działek budowlanych: ${rolneNaBudowlanych}`);

for (const [url, n] of krotnosc)
  if (n > MAX_KROTNOSC) bledy.push(`zdjęcie w ${n} ofertach (limit ${MAX_KROTNOSC}): ${url}`);

const dlugosci = new Map<number, number>();
for (const o of oferty) dlugosci.set(o.images.length, (dlugosci.get(o.images.length) ?? 0) + 1);

console.log("KONTROLA GALERII OFERT");
console.log("──────────────────────────────────────────────────────────────");
console.log(`ofert w czterech katalogach            ${oferty.length}`);
console.log(`slotów zdjęciowych                     ${sloty}`);
console.log(`unikalnych zdjęć                       ${unikalne}`);
console.log(`średnio zdjęć na ofertę                ${(sloty / oferty.length).toFixed(2)}`);
console.log(`rozkład długości galerii               ${[...dlugosci].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}→${n}`).join("  ")}`);
console.log("──────────────────────────────────────────────────────────────");
console.log(`zdjęć użytych w więcej niż jednej ofercie   ${powtarzane}`);
console.log(`maksymalna krotność jednego zdjęcia         ${maksKrotnosc}   (limit ${MAX_KROTNOSC})`);
console.log(`zdjęć wędrujących między typami ofert       ${miedzyTypami.length}   (ma być 0)`);
console.log(`ofert do 40 m² z ujęciem większej skali     ${zaDuzeUjecia.length}   (ma być 0)`);
console.log("──────────────────────────────────────────────────────────────");
console.log(`kadrów bez zadeklarowanej skali (elewacje, teren, garaże, lokale)  ${bezSkali}`);
console.log(`zdjęć o kategorii innej niż typ oferty      ${pozaKategoria}   (ma być 0)`);
console.log(`w tym kadry części wspólnych przy pokojach  ${czesciWspolnePokoi}   (dozwolone odstępstwo)`);
console.log(`kadrów rolnych w ofertach działek           ${rolneNaBudowlanych}`);
console.log(`adresów spoza biblioteki zdjecia.ts         ${spozaBiblioteki.size}`);

if (bledy.length > 0) {
  console.log("\nBŁĘDY:");
  for (const b of bledy.slice(0, 40)) console.log("  ·", b);
  if (bledy.length > 40) console.log(`  … i jeszcze ${bledy.length - 40}`);
  process.exitCode = 1;
} else {
  console.log("\nWszystkie warunki spełnione.");
}
