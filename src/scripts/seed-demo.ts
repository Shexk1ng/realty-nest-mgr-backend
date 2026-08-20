// Wypełnia bazę danymi demonstracyjnymi: agencje, użytkownicy, oferty i powiązane rekordy

import dotenv from "dotenv";
import dns from "node:dns";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../models/users.js";
import { Company } from "../models/companies.js";
import { Property } from "../models/properties.js";
import { Contact } from "../models/contacts.js";
import { CalendarEvent } from "../models/events.js";
import { Enquiry } from "../models/enquiries.js";
import { PipelineLead } from "../models/leads.js";
import { Commission } from "../models/commissions.js";
import { Document } from "../models/documents.js";
import { Campaign } from "../models/campaigns.js";
import { ActivityLog } from "../models/logs.js";
import { PropShareOffer } from "../models/propshare-offers.js";
import { EnquiryAllocation } from "../models/enquiry-allocations.js";
import { Viewing } from "../models/viewings.js";
import { Task } from "../models/tasks.js";
import { Transaction } from "../models/transactions.js";
import { Backup } from "../models/backups.js";
import { connectDB } from "../config/db.js";
import {
  przygotujDokumentDoZapisu,
  dopuszczalneRodzaje,
  wybierzRodzaj,
  podsumowanieWysylki,
} from "./data/dokumenty.js";
import type { DokumentRodzaj } from "./data/dokumenty.js";
import {
  zbudujDwuskladnikowe,
  zbudujKopieZapasowe,
  zbudujDziennikBezpieczenstwa,
  podsumowanieKopii,
} from "./data/bezpieczenstwo.js";
import type { UczestnikDziennika, ZrzutBazy } from "./data/bezpieczenstwo.js";
import { NIERUCHOMOSCI_WARSZAWA } from "./data/nieruchomosci-warszawa.js";
import { NIERUCHOMOSCI_KRAKOW } from "./data/nieruchomosci-krakow.js";
import { NIERUCHOMOSCI_WROCLAW } from "./data/nieruchomosci-wroclaw.js";
import { NIERUCHOMOSCI_TROJMIASTO } from "./data/nieruchomosci-trojmiasto.js";

dotenv.config();

const zadaneResolwery = (process.env.SEED_DNS_SERVERS ?? "").trim();
if (zadaneResolwery && !/^(0|false|off|no)$/i.test(zadaneResolwery)) {
  const resolwery = /^(1|true|on|yes)$/i.test(zadaneResolwery)
    ? ["8.8.8.8", "1.1.1.1"]
    : zadaneResolwery.split(",").map((adres) => adres.trim()).filter(Boolean);
  try {
    dns.setServers(resolwery);
    console.log(`ℹ  DNS: resolwery ustawione na ${resolwery.join(", ")} (SEED_DNS_SERVERS).`);
  } catch (blad) {
    console.warn(
      `⚠  DNS: nie udało się ustawić resolwerów ${resolwery.join(", ")} — ${(blad as Error).message}. ` +
        "Zostają resolwery systemowe.",
    );
  }
}

const DEMO_PASSWORD = "DemoPass123!";
const SYSTEM_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "bartlomiejdejewski01@gmail.com";
const SYSTEM_ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Bartłomiej Dejewski";

function num(v: unknown): number {
  if (v instanceof mongoose.Types.Decimal128) return parseFloat(v.toString());
  return Number(v);
}

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[rand(0, arr.length - 1)]!;
const sample = <T>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(rand(0, copy.length - 1), 1)[0]!);
  return out;
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const daysAhead = (d: number, hour = 10) => {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() + d * 86_400_000 + hour * 3_600_000);
};

const DNI_WDROZENIA_PLATFORMY = 364;
const dniWdrozeniaAgencji = (i: number) => 363 - i * 6;

const KALENDARZ_ZATRUDNIENIA: readonly { poDniach: number; godzina: number; minuta: number }[] = [
  { poDniach: 0, godzina: 11, minuta: 5 },   // COMPANY_ADMIN — tego samego dnia co firma
  { poDniach: 1, godzina: 9,  minuta: 10 },  // MANAGER
  { poDniach: 1, godzina: 14, minuta: 30 },  // agent1
  { poDniach: 2, godzina: 9,  minuta: 20 },  // agent2
  { poDniach: 2, godzina: 15, minuta: 10 },  // agent3
  { poDniach: 3, godzina: 9,  minuta: 5 },   // agent4
  { poDniach: 3, godzina: 13, minuta: 40 },  // agent5
  { poDniach: 4, godzina: 10, minuta: 15 },  // agent6
  { poDniach: 4, godzina: 15, minuta: 25 },  // assistant1
  { poDniach: 5, godzina: 11, minuta: 30 },  // assistant2
];

const SEASON_END = new Date();
const SEASON_START = new Date(SEASON_END.getTime() - 338 * 86_400_000);

function seasonDate(): Date {
  const t = Math.pow(Math.random(), 0.65);
  const span = SEASON_END.getTime() - SEASON_START.getTime();
  return new Date(SEASON_START.getTime() + t * span);
}

function dniTemuOGodzinie(dni: number, godzina: number, minuta = 0): Date {
  const d = new Date(Date.now() - dni * 86_400_000);
  d.setHours(godzina, minuta, 0, 0);
  return d;
}

function najpozniejsza(...daty: (Date | null | undefined)[]): Date {
  let out = SEASON_START;
  for (const d of daty) if (d instanceof Date && d.getTime() > out.getTime()) out = d;
  return out;
}

function nieWPrzyszlosci(d: Date): Date {
  return d.getTime() > Date.now() ? new Date() : d;
}

function wRamachHistorii(kandydat: Date, najwczesniej: Date): Date {
  const teraz = Date.now();
  const dol = Math.min(najwczesniej.getTime() + 3_600_000, teraz);
  return new Date(Math.min(Math.max(kandydat.getTime(), dol), teraz));
}

function dataZPrzedzialu(od: Date, do_: Date): Date {
  const teraz = Date.now();
  const dol = Math.min(od.getTime(), teraz);
  const gora = Math.min(Math.max(do_.getTime(), dol), teraz);
  return new Date(dol + Math.random() * (gora - dol));
}

function poDacie(odniesienia: (Date | null | undefined)[], skos = 1.7): Date {
  const teraz = Date.now();
  const baza = najpozniejsza(...odniesienia).getTime();
  const luz = Math.max(teraz - baza, 0);
  if (luz < 60_000) return new Date(teraz);
  const od = baza + Math.min(3_600_000, luz / 4);
  return new Date(od + Math.pow(Math.random(), skos) * (teraz - od));
}

async function saveAs(doc: any, actor: any, createdAt?: Date): Promise<any> {
  doc.$locals = doc.$locals ?? {};
  doc.$locals.actor = actor;
  if (createdAt) {
    doc.createdAt = createdAt;
    doc.updatedAt = createdAt;
    doc.$locals.logAt = createdAt;
    return doc.save({ timestamps: false });
  }
  return doc.save();
}

async function updateAs(doc: any, actor: any, kiedy: Date): Promise<any> {
  doc.$locals = doc.$locals ?? {};
  doc.$locals.actor = actor;
  doc.$locals.logAt = kiedy;
  doc.updatedAt = kiedy;
  return doc.save({ timestamps: false });
}

interface PozycjaHistorii {
  kiedy: Date;
  wykonaj: () => Promise<unknown>;
}

async function odtworzHistorie(pozycje: PozycjaHistorii[]): Promise<void> {
  const uporzadkowane = [...pozycje].sort((a, b) => a.kiedy.getTime() - b.kiedy.getTime());
  for (const pozycja of uporzadkowane) await pozycja.wykonaj();
}


interface OfertaZKatalogu {
  title: string;
  price: number;
  location: string;
  transactionType: "SALE" | "RENT";
  propertyType: string;
  market: "PRIMARY" | "SECONDARY";
  status: "ACTIVE" | "PENDING" | "SOLD" | "WITHDRAWN";
  area?: number | null;
  plotArea?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  yearBuilt?: number | null;
  monthlyRent?: number | null;
  deposit?: number | null;
  ownership?: string | null;
  condition?: string | null;
  heating?: string | null;
  energyClass?: string | null;
  availableFrom?: string | null;
  features: readonly string[];
  address: {
    street: string;
    district: string;
    city: string;
    postalCode: string;
    country: string;
    lat: number;
    lng: number;
  };
  images: readonly string[];
  imageUrl: string;
  descriptionSections: {
    intro: string;
    layout: string | null;
    location: string;
    additional: string;
  };
  description: string;
}

const znakFirmowy = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg.replace(/\s+/g, " ").trim(), "utf8").toString("base64")}`;

const okladka = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=1600&h=500&fit=crop&auto=format&q=80`;

interface AgencyCfg {
  name: string;
  domain: string;
  city: string;
  street: string;
  postal: string;
  phone: string;
  nip: string;
  licenseNumber: string;
  logoUrl: string;
  coverImageUrl: string;
  oferty: readonly OfertaZKatalogu[];
}

const AGENCIES: AgencyCfg[] = [
  {
    name: "Nest Realty Warszawa",
    domain: "nestrealty.pl",
    city: "Warszawa",
    street: "ul. Puławska 2",
    postal: "02-566",
    phone: "+48 22 435 18 40",
    nip: "5251047384",
    licenseNumber: "PL-RE-18420",
    logoUrl: znakFirmowy(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#24527C"/><stop offset="1" stop-color="#0D2136"/>
        </linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#t)"/>
        <path d="M32 13 53 31v3h-6v18H17V34h-6v-3z" fill="#fff"/>
        <rect x="27" y="38" width="10" height="14" rx="1.5" fill="#24527C"/>
        <rect x="20" y="38" width="5" height="5" rx="1" fill="#24527C"/>
        <rect x="39" y="38" width="5" height="5" rx="1" fill="#24527C"/>
      </svg>`),
    coverImageUrl: okladka("1486406146926-c627a92ad1ab"),
    oferty: NIERUCHOMOSCI_WARSZAWA,
  },
  {
    name: "Kraków Premium Estates",
    domain: "krakowpremium.pl",
    city: "Kraków",
    street: "ul. Pawia 9",
    postal: "31-154",
    phone: "+48 12 397 26 15",
    nip: "6762714592",
    licenseNumber: "PL-RE-31047",
    logoUrl: znakFirmowy(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8E2135"/><stop offset="1" stop-color="#4C0F1C"/>
        </linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#t)"/>
        <path d="M13 44V23l9.5 8.5L32 16l9.5 15.5L51 23v21z" fill="#E3B667"/>
        <rect x="13" y="48" width="38" height="5" rx="2.5" fill="#E3B667"/>
        <circle cx="13" cy="21" r="3" fill="#E3B667"/>
        <circle cx="51" cy="21" r="3" fill="#E3B667"/>
        <circle cx="32" cy="13" r="3.5" fill="#E3B667"/>
      </svg>`),
    coverImageUrl: okladka("1497366754035-f200968a6e72"),
    oferty: NIERUCHOMOSCI_KRAKOW,
  },
  {
    name: "Wrocław City Homes",
    domain: "wroclawcity.pl",
    city: "Wrocław",
    street: "ul. Powstańców Śląskich 9",
    postal: "53-332",
    phone: "+48 71 340 62 08",
    nip: "8971823464",
    licenseNumber: "PL-RE-53119",
    logoUrl: znakFirmowy(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#12857C"/><stop offset="1" stop-color="#08423D"/>
        </linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#t)"/>
        <path d="M12 52V34l9-8 9 8v18z" fill="#fff" opacity=".62"/>
        <path d="M26 52V25l13-11 13 11v27z" fill="#fff"/>
        <rect x="35" y="34" width="8" height="18" rx="1" fill="#0D6A62"/>
      </svg>`),
    coverImageUrl: okladka("1479839672679-a46483c0e7c8"),
    oferty: NIERUCHOMOSCI_WROCLAW,
  },
  {
    name: "Baltic Coast Properties",
    domain: "balticcoast.pl",
    city: "Gdańsk",
    street: "al. Grunwaldzka 472",
    postal: "80-309",
    phone: "+48 58 732 41 90",
    nip: "5832946173",
    licenseNumber: "PL-RE-80264",
    logoUrl: znakFirmowy(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1A79AE"/><stop offset="1" stop-color="#093750"/>
        </linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#t)"/>
        <path d="M32 10 52 27h-6v12H18V27h-6z" fill="#fff"/>
        <path d="M11 48q5.5-5 11 0t11 0 11 0 11 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".92"/>
        <path d="M11 56q5.5-5 11 0t11 0 11 0 11 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".5"/>
      </svg>`),
    coverImageUrl: okladka("1600880292203-757bb62b4baf"),
    oferty: NIERUCHOMOSCI_TROJMIASTO,
  },
];

const FEMALE_FIRST = ["Anna", "Zofia", "Julia", "Katarzyna", "Magdalena", "Ewa", "Natalia", "Agnieszka", "Karolina", "Monika"];
const MALE_FIRST = ["Piotr", "Marek", "Tomasz", "Łukasz", "Grzegorz", "Rafał", "Michał", "Paweł", "Jakub", "Krzysztof"];
const LAST_GENDERED = ["Wiśniewski", "Lewandowski", "Szymański", "Kozłowski", "Zieliński", "Kamiński", "Dąbrowski", "Jankowski"];
const LAST_NEUTRAL = ["Nowak", "Wójcik", "Woźniak", "Mazur", "Kowalczyk", "Krawczyk", "Kaczmarek"];

function polishName(): { firstName: string; lastName: string } {
  const female = Math.random() < 0.5;
  const firstName = female ? pick(FEMALE_FIRST) : pick(MALE_FIRST);
  const useGendered = Math.random() < 0.55;
  const lastName = useGendered
    ? (female ? pick(LAST_GENDERED).replace(/ski$/, "ska").replace(/cki$/, "cka") : pick(LAST_GENDERED))
    : pick(LAST_NEUTRAL);
  return { firstName, lastName };
}

let userIdx = 0;
function makeUserSeeds(domain: string) {
  const mk = (role: string, jobTitle: string, handle: string) => {
    const female = userIdx % 2 === 0;
    const firstName = female
      ? FEMALE_FIRST[(userIdx * 3) % FEMALE_FIRST.length]!
      : MALE_FIRST[(userIdx * 3) % MALE_FIRST.length]!;
    const base = LAST_GENDERED[(userIdx * 5) % LAST_GENDERED.length]!;
    const lastName = female ? base.replace(/ski$/, "ska").replace(/cki$/, "cka") : base;
    userIdx++;
    return { role, jobTitle, firstName, lastName, email: `${handle}@${domain}`, phone: `+48 ${rand(500, 799)} ${rand(100, 999)} ${rand(100, 999)}` };
  };
  return [
    mk("COMPANY_ADMIN", "Broker prowadzący", "admin"),
    mk("MANAGER", "Kierownik sprzedaży", "manager"),
    mk("AGENT", "Agent nieruchomości", "agent1"),
    mk("AGENT", "Agent nieruchomości", "agent2"),
    mk("AGENT", "Agent nieruchomości", "agent3"),
    mk("AGENT", "Agent nieruchomości", "agent4"),
    mk("AGENT", "Agent nieruchomości", "agent5"),
    mk("AGENT", "Agent nieruchomości", "agent6"),
    mk("AGENT_ASSISTANT", "Asystent agenta", "assistant1"),
    mk("AGENT_ASSISTANT", "Asystent agenta", "assistant2"),
  ];
}

function ofertaZKatalogu(oferta: OfertaZKatalogu, agents: any[]) {
  return {
    title: oferta.title,
    price: oferta.price,
    location: oferta.location,
    transactionType: oferta.transactionType,
    propertyType: oferta.propertyType,
    market: oferta.market,
    status: oferta.status,
    area: oferta.area ?? null,
    plotArea: oferta.plotArea ?? null,
    rooms: oferta.rooms ?? null,
    bedrooms: oferta.bedrooms ?? null,
    bathrooms: oferta.bathrooms ?? null,
    floor: oferta.floor ?? null,
    totalFloors: oferta.totalFloors ?? null,
    yearBuilt: oferta.yearBuilt ?? null,
    monthlyRent: oferta.monthlyRent ?? null,
    deposit: oferta.deposit ?? null,
    ownership: oferta.ownership ?? null,
    condition: oferta.condition ?? null,
    heating: oferta.heating ?? null,
    energyClass: oferta.energyClass ?? null,
    availableFrom: oferta.availableFrom ? new Date(`${oferta.availableFrom}T12:00:00.000Z`) : null,
    features: [...oferta.features],
    address: { ...oferta.address },
    images: [...oferta.images],
    imageUrl: oferta.imageUrl,
    descriptionSections: { ...oferta.descriptionSections },
    description: oferta.description,
    agentId: pick(agents)._id,
  };
}

const ENQUIRY_NOTES = [
  "Klient dzwonił z portalu, prosi o prezentację w przyszłym tygodniu — najlepiej sobota rano.",
  "Zainteresowany, ale cena wydaje mu się wysoka. Pyta o możliwość negocjacji do 5%.",
  "Kupujący gotówkowy, chce sfinalizować do końca miesiąca. Priorytet.",
  "Potrzebuje kredytu — umówiony na spotkanie z doradcą finansowym w czwartek.",
  "Przeprowadza się z Wrocławia w związku ze zmianą pracy, termin dość pilny.",
  "Szuka pod inwestycję, pytał o wysokość czynszu i możliwy zwrot z najmu.",
  "Rozmowa krótka, klient prosił o przesłanie oferty mailem i kontakt za tydzień.",
  "Zainteresowany dwiema ofertami — chce zobaczyć obie tego samego dnia.",
  "Wymaga miejsca postojowego w cenie, bez tego rezygnuje.",
  "Klient po prezentacji u konkurencji, porównuje oferty. Warto zadzwonić szybko.",
  "Pyta o stan prawny i księgę wieczystą przed umówieniem oglądania.",
  "Rodzina z dziećmi, kluczowa jest szkoła w rejonie i cicha okolica.",
];

const TX_NOTES: Record<string, string[]> = {
  DRAFT: [
    "Warunki wstępnie uzgodnione ustnie, czekamy na potwierdzenie ceny przez właściciela.",
    "Przygotowywana umowa przedwstępna — do weryfikacji przez prawnika biura.",
  ],
  PENDING: [
    "Transakcja finansowana kredytem hipotecznym — oczekiwanie na decyzję banku.",
    "Zadatek wpłacony, termin aktu notarialnego ustalony na przyszły miesiąc.",
    "Trwa kompletowanie dokumentów: zaświadczenie ze spółdzielni i wypis z KW.",
    "Klient poprosił o przesunięcie terminu przekazania lokalu o dwa tygodnie.",
  ],
  COMPLETED: [
    "Akt notarialny podpisany, klucze przekazane. Rozliczenie prowizji wystawione.",
    "Transakcja zamknięta bez uwag. Klient zadowolony, obiecał polecenie.",
    "Przekazanie lokalu z protokołem i odczytem liczników. Sprawa zamknięta.",
  ],
  CANCELLED: [
    "Bank odmówił kredytu — kupujący wycofał się z transakcji.",
    "Sprzedający wstrzymał sprzedaż z powodów rodzinnych.",
  ],
  REFUNDED: [
    "Zadatek zwrócony zgodnie z umową po odstąpieniu w terminie.",
    "Odstąpienie za porozumieniem stron, wpłata zwrócona w całości.",
  ],
};

const KOLEKCJE_POZA_ZRZUTEM = new Set(["activitylogs", "counters"]);
const KOLEKCJA_KOPII = "backups";

async function przygotujZrzuty(): Promise<((kiedy: Date) => Promise<ZrzutBazy>) | undefined> {
  const db = mongoose.connection.db;
  if (!db) return undefined;

  const nazwy = (await db.listCollections().toArray())
    .map((k) => k.name)
    .filter((n) => !KOLEKCJE_POZA_ZRZUTEM.has(n.toLowerCase()));
  if (!nazwy.includes(KOLEKCJA_KOPII)) nazwy.push(KOLEKCJA_KOPII);

  const migawka = new Map<string, Record<string, unknown>[]>();
  for (const nazwa of nazwy) {
    if (nazwa === KOLEKCJA_KOPII) continue;
    migawka.set(nazwa, (await db.collection(nazwa).find({}).toArray()) as Record<string, unknown>[]);
  }

  const dataRekordu = (d: Record<string, unknown>): number => {
    const wartosc = (d.createdAt ?? d.allocatedAt) as Date | undefined;
    return wartosc instanceof Date ? wartosc.getTime() : Number.POSITIVE_INFINITY;
  };

  return async (kiedy: Date): Promise<ZrzutBazy> => {
    const granica = kiedy.getTime();
    const dump: Record<string, unknown[]> = {};
    let docCount = 0;

    for (const nazwa of nazwy) {
      const wszystkie =
        nazwa === KOLEKCJA_KOPII
          ? ((await db.collection(KOLEKCJA_KOPII).find({}).toArray()) as Record<string, unknown>[])
          : (migawka.get(nazwa) ?? []);
      const wiersze = wszystkie.filter((d) => dataRekordu(d) <= granica);
      dump[nazwa] = wiersze;
      docCount += wiersze.length;
    }

    const json = JSON.stringify({ exportedAt: kiedy.toISOString(), collections: dump });
    return { bytes: Buffer.from(json, "utf8"), docCount, collectionsCount: nazwy.length };
  };
}

async function buildAgency(cfg: AgencyCfg, administratorSystemu: any, indeks: number) {
  const wdrozenieDni = dniWdrozeniaAgencji(indeks);
  const historia: PozycjaHistorii[] = [];
  const zaplanuj = (kiedy: Date, wykonaj: () => Promise<unknown>) => {
    historia.push({ kiedy, wykonaj });
  };
  const zaplanujZapis = <T extends { createdAt?: Date; updatedAt?: Date }>(
    doc: T,
    actor: any,
    kiedy: Date,
  ): T => {
    (doc as any).createdAt = kiedy;
    (doc as any).updatedAt = kiedy;
    zaplanuj(kiedy, () => saveAs(doc, actor, kiedy));
    return doc;
  };

  const company = await saveAs(new Company({
    name: cfg.name,
    domain: cfg.domain,
    type: "REAL_ESTATE_COMPANY",
    isActive: true,
    logoUrl: cfg.logoUrl,
    coverImageUrl: cfg.coverImageUrl,
    settings: {
      phone: cfg.phone,
      email: `biuro@${cfg.domain}`,
      website: `https://${cfg.domain}`,
      nip: cfg.nip,
      address: { street: cfg.street, city: cfg.city, postalCode: cfg.postal, country: "PL" },
      licenseNumber: cfg.licenseNumber,
      timezone: "Europe/Warsaw",
      language: "pl",
      formDisclaimer: {
        pl: {
          text: "Wysyłając formularz, wyrażasz zgodę na przetwarzanie danych osobowych w celu kontaktu w sprawie oferty.",
          linkLabel: "Polityka prywatności",
          linkUrl: `https://${cfg.domain}/privacy`,
        },
        en: {
          text: "By submitting this form you consent to us processing your data to get in touch about this listing.",
          linkLabel: "Privacy policy",
          linkUrl: `https://${cfg.domain}/privacy`,
        },
      },
    },
  }), administratorSystemu, dniTemuOGodzinie(wdrozenieDni, 10, 20));
  const cid = company._id as string;

  const hashed = await bcrypt.hash(DEMO_PASSWORD, 12);
  const users: Record<string, any> = { AGENT: [] };
  const assistants: any[] = [];
  let agentQueueOrder = 1;
  const zalozeniaKont = makeUserSeeds(cfg.domain);
  for (let ui = 0; ui < zalozeniaKont.length; ui++) {
    const u = zalozeniaKont[ui]!;
    const pozycja = KALENDARZ_ZATRUDNIENIA[ui] ?? { poDniach: ui, godzina: 10, minuta: 0 };
    const dataKonta = dniTemuOGodzinie(
      wdrozenieDni - pozycja.poDniach,
      pozycja.godzina,
      pozycja.minuta,
    );
    const zakladajacy = ui === 0 ? administratorSystemu : users.COMPANY_ADMIN;
    const isQueueable = ["AGENT", "MANAGER"].includes(u.role);
    const isAgentLike = ["AGENT", "MANAGER", "COMPANY_ADMIN"].includes(u.role);
    const assignedAgentId =
      u.role === "AGENT_ASSISTANT" && !users.AGENT_ASSISTANT
        ? ((users.AGENT[0]?._id as string) ?? null)
        : null;
    const doc = await saveAs(new User({
      email: u.email, password: hashed, name: `${u.firstName} ${u.lastName}`,
      role: u.role, companyId: cid, isActive: true, assignedAgentId,
      profile: {
        firstName: u.firstName, lastName: u.lastName, phone: u.phone, jobTitle: u.jobTitle,
        avatarUrl: `https://i.pravatar.cc/300?u=${u.email}`,
        profilePictureUrl: `https://i.pravatar.cc/600?u=${u.email}`,
        bio: isAgentLike
          ? pick([
              `Specjalizuje się w nieruchomościach w ${cfg.city} i okolicach. Ceni sobie transparentną komunikację z klientem.`,
              `Na rynku nieruchomości od kilku lat, doradza klientom indywidualnym i inwestycyjnym w ${cfg.city}.`,
              `Skupia się na szybkiej i bezstresowej obsłudze transakcji — od pierwszego kontaktu po podpisanie umowy.`,
            ])
          : null,
        licenseNumber: isAgentLike ? `LIC-${rand(100_000, 999_999)}` : null,
        timezone: "Europe/Warsaw",
        language: "pl",
      },
      allocationEnabled: true,
      allocationQueueOrder: isQueueable ? agentQueueOrder++ : null,
    }), zakladajacy, dataKonta);
    if (u.role === "AGENT") users.AGENT.push(doc);
    else {
      if (u.role === "AGENT_ASSISTANT") assistants.push(doc);
      users[u.role] = doc;
    }
  }
  const admin = users.COMPANY_ADMIN;
  const manager = users.MANAGER;
  const agents = [...users.AGENT, manager, admin];

  const aktywne = cfg.oferty.map((o, i) => ({ o, i })).filter(({ o }) => o.status === "ACTIVE");
  const krokWspolpracy = Math.max(1, Math.floor(aktywne.length / 12));
  const doWspolpracy = new Set(
    Array.from(
      { length: Math.min(12, aktywne.length) },
      (_, k) => aktywne[(k * krokWspolpracy) % aktywne.length]!.i,
    ),
  );

  const properties: any[] = [];
  for (let i = 0; i < cfg.oferty.length; i++) {
    const wystawiono = seasonDate();
    const propShareListed = doWspolpracy.has(i);
    const propShareListedAt = propShareListed ? poDacie([wystawiono], 2.2) : null;
    const propShareNotes = propShareListed
      ? pick(["Oferta otwarta na współpracę. Wynagrodzenie prowizyjne do uzgodnienia.", "Klient preferuje szybką transakcję. Zapraszam do kontaktu.", "Nieruchomość na wyłączność. Dzielę prowizję 50/50."])
      : null;
    const contentApprovedAt = i % 5 === 0 ? null : poDacie([wystawiono], 3);
    properties.push(zaplanujZapis(new Property({
      ...ofertaZKatalogu(cfg.oferty[i]!, agents),
      companyId: cid, propShareListed, propShareListedAt, propShareNotes, contentApprovedAt,
    }), admin, wystawiono));
  }

  const ofertaSprzed = (kiedy: Date): any => {
    const dostepne = properties.filter((p: any) => p.createdAt.getTime() <= kiedy.getTime());
    return dostepne.length ? pick(dostepne) : properties[0]!;
  };

  const contactKinds = ["CLIENT", "CLIENT", "CLIENT", "PARTNER", "VENDOR"] as const;
  const contactSources = ["PORTAL", "REFERRAL", "DIRECT", "SOCIAL", "AGENCY"] as const;
  const contactNotes = [
    "Szuka mieszkania dwupokojowego blisko centrum, budżet elastyczny.",
    "Klient gotówkowy — decyzja możliwa w ciągu tygodnia od prezentacji.",
    "Sprzedaje mieszkanie po babci, wymaga wsparcia przy dokumentach spadkowych.",
    "Inwestor, szuka lokali pod wynajem krótkoterminowy. Interesuje go stopa zwrotu.",
    "Preferuje kontakt mailowy, w godzinach popołudniowych.",
    "Rodzina z dwójką dzieci — wymagana szkoła i przedszkole w okolicy.",
    "Potrzebuje kredytu hipotecznego, ma wstępną zdolność w dwóch bankach.",
    "Klient z polecenia — obsługiwaliśmy już transakcję jego brata.",
    "Zainteresowany domem z ogrodem, maksymalnie 30 minut od miasta.",
    "Wynajmuje obecnie, umowa kończy się na koniec kwartału.",
  ];
  const contacts: any[] = [];
  for (let i = 0; i < 60; i++) {
    const { firstName, lastName } = polishName();
    const email = `${firstName}.${lastName}@example.com`.toLowerCase();
    const zalozono = seasonDate();
    contacts.push(zaplanujZapis(new Contact({
      name: `${firstName} ${lastName}`,
      email,
      phone: `+48 ${rand(500, 799)} ${rand(100, 999)} ${rand(100, 999)}`,
      role: pick(["Kupujący", "Kupujący gotówkowy", "Inwestor", "Najemca", "Sprzedający"]),
      kind: pick(contactKinds),
      notes: pick(contactNotes),
      source: pick(contactSources),
      consentGivenAt: zalozono,
      ownerId: pick(agents)._id,
      companyId: cid,
    }), admin, zalozono));
  }

  const kontaktSprzed = (kiedy: Date): any => {
    const dostepne = contacts.filter((c: any) => c.createdAt.getTime() <= kiedy.getTime());
    return dostepne.length ? pick(dostepne) : contacts[0]!;
  };

  const enqSources = ["PORTAL", "REFERRAL", "DIRECT", "SOCIAL", "AGENCY"] as const;
  const enqPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
  const enqStatuses = ["NEW", "CONTACTED", "QUALIFIED", "NEGOTIATING"] as const;
  const enquiries: any[] = [];
  const queueableAgents = [...users.AGENT, manager];
  for (let i = 0; i < 45; i++) {
    const prop = pick(properties);
    const c = pick(contacts);
    const assignedAgent = queueableAgents[i % queueableAgents.length];
    const wplyneło = poDacie([prop.createdAt, c.createdAt]);
    const enq = zaplanujZapis(new Enquiry({
      name: c.name, email: c.email, phone: c.phone,
      propertyInterest: prop.propertyType, location: prop.location, budget: Math.round(num(prop.price) * (0.85 + Math.random() * 0.3)),
      source: pick(enqSources), priority: pick(enqPriorities), status: pick(enqStatuses),
      note: pick(ENQUIRY_NOTES),
      consentGivenAt: wplyneło,
      agentId: assignedAgent._id, propertyId: prop._id, companyId: cid,
    }), admin, wplyneło);
    enquiries.push(enq);
    const przydzielono = new Date(wplyneło.getTime() + rand(5, 90) * 1_000);
    zaplanuj(przydzielono, () =>
      new EnquiryAllocation({
        enquiryId: enq._id, agentId: assignedAgent._id, companyId: cid,
        method: "AUTO", allocatedAt: przydzielono,
      }).save(),
    );
  }

  const stages = ["NEW", "QUALIFYING", "SHOWING", "NURTURE", "OFFER", "CLOSED"] as const;
  const leads: any[] = [];
  for (let i = 0; i < 35; i++) {
    const prop = pick(properties);
    const c = pick(contacts);
    leads.push(zaplanujZapis(new PipelineLead({
      title: `${prop.title} — ${c.name}`,
      stage: pick(stages), source: pick(["Portal ogłoszeniowy", "Kontakt bezpośredni", "Media społecznościowe", "Inne biuro", "Polecenie"]),
      estValue: num(prop.price), agentId: prop.agentId, contactId: c._id, propertyId: prop._id,
      companyId: cid,
    }), pick(agents), poDacie([prop.createdAt, c.createdAt])));
  }

  const commStatuses = ["PENDING", "PROCESSING", "PAID", "DISPUTED"] as const;
  const saleProperties = properties.filter((p: any) => p.transactionType === "SALE");
  for (let i = 0; i < 25; i++) {
    const prop = pick(saleProperties.length ? saleProperties : properties);
    const rate = pick([1.5, 1.8, 2.0, 2.5, 3.0]);
    const status = pick(commStatuses);
    const dealDate = poDacie([prop.createdAt]);
    const paidDate =
      status === "PAID"
        ? dataZPrzedzialu(dealDate, new Date(dealDate.getTime() + rand(3, 21) * 86_400_000))
        : null;
    zaplanujZapis(new Commission({
      salePrice: num(prop.price), rate, amount: Math.round((num(prop.price) * rate) / 100),
      status, dealDate, paidDate,
      invoiceNumber: status === "PENDING" ? null : `FV/${dealDate.getFullYear()}/${String(rand(1, 999)).padStart(3, "0")}`,
      clientName: kontaktSprzed(dealDate).name, agentId: prop.agentId, propertyId: prop._id, companyId: cid,
    }), admin, dealDate);
  }

  const firmaDoDokumentow = {
    name: cfg.name,
    city: cfg.city,
    street: (company.settings as any)?.address?.street ?? null,
    postalCode: cfg.postal,
    nip: (company.settings as any)?.nip ?? null,
    phone: (company.settings as any)?.phone ?? null,
    email: (company.settings as any)?.email ?? null,
    website: (company.settings as any)?.website ?? null,
    licenseNumber: (company.settings as any)?.licenseNumber ?? null,
  };
  const agentPoId = new Map<string, any>(agents.map((a: any) => [String(a._id), a]));

  const pulaOfert = sample(properties, Math.min(9, properties.length));
  const planDokumentow: Array<{ prop: any; rodzaj: DokumentRodzaj; runda: number }> = [];
  for (let runda = 0; runda < 5 && planDokumentow.length < 22; runda++) {
    for (const oferta of pulaOfert) {
      if (planDokumentow.length >= 22) break;
      const dostepne = dopuszczalneRodzaje(oferta);
      if (runda < dostepne.length) planDokumentow.push({ prop: oferta, rodzaj: dostepne[runda]!, runda });
    }
  }
  while (planDokumentow.length < 22) {
    const oferta = pick(properties);
    planDokumentow.push({ prop: oferta, rodzaj: wybierzRodzaj(oferta, planDokumentow.length), runda: 0 });
  }

  const stronyOferty = new Map<string, { wlasciciel: any; drugaStrona: any; poczatek: Date; krok: number }>();
  const stronyDla = (oferta: any) => {
    const klucz = String(oferta._id);
    let wpis = stronyOferty.get(klucz);
    if (!wpis) {
      const poczatek = dataZPrzedzialu(
        oferta.createdAt,
        new Date(Math.max(oferta.createdAt.getTime(), Date.now() - 30 * 86_400_000)),
      );
      const dostepne = Math.max(Date.now() - poczatek.getTime(), 0);
      const krok = Math.max(Math.min(rand(18, 30) * 86_400_000, dostepne / 5), 3_600_000);
      const wlasciciel = kontaktSprzed(poczatek);
      const inni = contacts.filter(
        (c: any) => String(c._id) !== String(wlasciciel._id) && c.createdAt.getTime() <= poczatek.getTime(),
      );
      wpis = {
        wlasciciel,
        drugaStrona: inni.length ? pick(inni) : wlasciciel,
        poczatek,
        krok,
      };
      stronyOferty.set(klucz, wpis);
    }
    return wpis;
  };

  for (const { prop, rodzaj, runda } of planDokumentow) {
    const agentOferty = agentPoId.get(String(prop.agentId)) ?? pick(agents);
    const { wlasciciel, drugaStrona, poczatek, krok } = stronyDla(prop);
    const dataDokumentu = wRamachHistorii(new Date(poczatek.getTime() + runda * krok), poczatek);
    const pola = await przygotujDokumentDoZapisu({
      rodzaj,
      firma: firmaDoDokumentow,
      nieruchomosc: prop,
      agent: {
        name: agentOferty.name,
        email: agentOferty.email,
        phone: agentOferty.profile?.phone ?? null,
        licenseNumber: agentOferty.profile?.licenseNumber ?? null,
      },
      klient: { name: wlasciciel.name, email: wlasciciel.email, phone: wlasciciel.phone },
      kontrahent: { name: drugaStrona.name, email: drugaStrona.email, phone: drugaStrona.phone },
      data: dataDokumentu,
    });
    zaplanujZapis(new Document({
      name: pola.name,
      fileType: pola.fileType,
      category: pola.category,
      sizeBytes: pola.sizeBytes,
      mimeType: pola.mimeType,
      format: pola.format,
      originalName: pola.originalName,
      resourceType: pola.resourceType,
      deliveryType: pola.deliveryType,
      publicId: pola.publicId,
      url: pola.url,
      uploadedById: agentOferty._id, propertyId: prop._id, companyId: cid,
    }), agentOferty, dataDokumentu);
  }

  const channels = ["EMAIL", "SOCIAL", "PORTAL", "SEARCH", "DIRECT"] as const;
  const campStatuses = ["ACTIVE", "PAUSED", "ENDED", "DRAFT"] as const;
  for (let i = 0; i < 12; i++) {
    const prop = pick(properties);
    const budget = rand(1, 8) * 1000;
    const status = pick(campStatuses);
    const startDate = poDacie([prop.createdAt], 1.4);
    const endDate =
      status === "ENDED"
        ? dataZPrzedzialu(startDate, new Date(startDate.getTime() + rand(14, 45) * 86_400_000))
        : null;
    const powiazane = enquiries.filter((e: any) => e.createdAt.getTime() <= startDate.getTime());
    zaplanujZapis(new Campaign({
      name: pick(["Spring Push", "Exclusive Listing", "Retargeting", "Newsletter", "Open House"]) + ` — ${cfg.city}`,
      channel: pick(channels), status, budget, spent: Math.round(budget * Math.random()),
      impressions: rand(5, 50) * 1000, clicks: rand(200, 2000), leads: rand(3, 40),
      startDate, endDate,
      ownerId: admin._id, propertyId: prop._id, companyId: cid,
      enquiryId: i % 2 === 0 && powiazane.length > 0 ? pick(powiazane)._id : null,
    }), admin, startDate);
  }

  const kinds = ["VIEWING", "MEETING", "CALL", "INSPECTION", "OTHER"] as const;
  for (let i = 0; i < 25; i++) {
    const start = daysAhead(rand(-5, 14), rand(9, 17));
    const prop = ofertaSprzed(start);
    const c = kontaktSprzed(start);
    const umowiono = dataZPrzedzialu(
      najpozniejsza(prop.createdAt, c.createdAt, new Date(start.getTime() - 20 * 86_400_000)),
      new Date(start.getTime() - 2 * 86_400_000),
    );
    const kind = pick(kinds);
    zaplanujZapis(new CalendarEvent({
      title: `${pick(["Viewing", "Call", "Meeting", "Inspection"])} — ${prop.title}`,
      description: [
        `Spotkanie z klientem ${c.name} dot. oferty: ${prop.title}.`,
        pick([
          "Proszę o kontakt telefoniczny 15 minut przed spotkaniem.",
          "Przygotować dokumenty oferty, rzut lokalu i wycenę.",
          "Klient prosi o wejście od strony parkingu — brama otwierana domofonem.",
          "Po spotkaniu uzupełnić notatkę i status prezentacji w systemie.",
        ]),
      ].join(" "),
      kind, startAt: start, endAt: new Date(start.getTime() + (kind === "INSPECTION" ? 2 : 1) * 3_600_000),
      location: prop.location, agentId: prop.agentId, propertyId: prop._id, contactId: c._id, companyId: cid,
    }), pick(agents), umowiono);
  }

  const viewingStatuses = [
    "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED",
    "SCHEDULED", "SCHEDULED", "CONFIRMED",
    "NO_SHOW", "CANCELLED", "RESCHEDULED",
  ] as const;
  const viewingOutcomes = ["INTERESTED", "NOT_INTERESTED", "OFFER_MADE", "FOLLOW_UP", "UNDECIDED"] as const;
  const feedbackByOutcome: Record<string, string[]> = {
    INTERESTED: [
      "Klient zainteresowany, prosi o wyliczenie raty kredytu i drugi termin z małżonką.",
      "Bardzo pozytywne wrażenie — szczególnie spodobał się rozkład i nasłonecznienie.",
      "Pyta o możliwość wcześniejszego wydania lokalu. Zainteresowanie realne.",
    ],
    NOT_INTERESTED: [
      "Za mało miejsc parkingowych w okolicy — dla klienta warunek konieczny.",
      "Metraż okazał się mniejszy niż oczekiwał. Rezygnuje z tej oferty.",
      "Głośna ulica pod oknami, klient odpada. Szukamy czegoś w cichszej lokalizacji.",
    ],
    OFFER_MADE: [
      "Klient złożył ofertę na miejscu, poniżej ceny wywoławczej. Przekazane właścicielowi.",
      "Oferta złożona po prezentacji — czekamy na decyzję sprzedającego.",
      "Zdecydowany kupujący, oferta gotówkowa z krótkim terminem realizacji.",
    ],
    FOLLOW_UP: [
      "Prosi o kontakt za tydzień, po rozmowie z doradcą kredytowym.",
      "Chce jeszcze zobaczyć dwie inne oferty przed decyzją. Umówiony telefon.",
      "Wraca z rodziną na drugą prezentację — termin do potwierdzenia.",
    ],
    UNDECIDED: [
      "Potrzebuje więcej czasu na decyzję, waha się między dwoma lokalizacjami.",
      "Podoba się mieszkanie, ale odstrasza koszt remontu łazienki.",
      "Bez jednoznacznej reakcji. Warto wrócić z ofertą po obniżce ceny.",
    ],
  };
  const noShowFeedback = [
    "Klient nie stawił się i nie odbierał telefonu. Wysłana wiadomość z propozycją nowego terminu.",
    "Odwołane 10 minut przed spotkaniem — powód rodzinny. Przekładamy.",
  ];
  for (let i = 0; i < 30; i++) {
    const status = pick(viewingStatuses);
    const isPast = status === "COMPLETED" || status === "NO_SHOW";
    const scheduledAt = isPast ? daysAgo(rand(1, 45)) : daysAhead(rand(0, 21), rand(9, 18));
    const prop = ofertaSprzed(scheduledAt);
    const c = kontaktSprzed(scheduledAt);
    const umowiono = dataZPrzedzialu(
      najpozniejsza(prop.createdAt, c.createdAt, new Date(scheduledAt.getTime() - 21 * 86_400_000)),
      new Date(scheduledAt.getTime() - 2 * 86_400_000),
    );
    const done = status === "COMPLETED";
    const outcome = done ? pick(viewingOutcomes) : null;
    const ratingByOutcome: Record<string, number> = {
      OFFER_MADE: rand(4, 5), INTERESTED: rand(4, 5), FOLLOW_UP: rand(3, 4),
      UNDECIDED: rand(2, 4), NOT_INTERESTED: rand(1, 2),
    };
    zaplanujZapis(new Viewing({
      scheduledAt,
      durationMin: pick([30, 30, 45, 60]),
      status,
      outcome,
      rating: outcome ? ratingByOutcome[outcome] ?? rand(2, 5) : null,
      feedback: outcome
        ? pick(feedbackByOutcome[outcome]!)
        : status === "NO_SHOW"
          ? pick(noShowFeedback)
          : null,
      followUpAt:
        outcome === "FOLLOW_UP" || outcome === "INTERESTED" || outcome === "UNDECIDED"
          ? daysAhead(rand(1, 10), 10)
          : null,
      propertyId: prop._id,
      contactId: c._id,
      agentId: prop.agentId,
      companyId: cid,
    }), pick(agents), umowiono);
  }

  const txStatuses = ["DRAFT", "PENDING", "PENDING", "COMPLETED", "COMPLETED", "CANCELLED", "REFUNDED"] as const;
  const CHECKLIST_STEPS = [
    { key: "kw",        label: "Weryfikacja księgi wieczystej" },
    { key: "zaswiadcz", label: "Zaświadczenia (zameldowanie, zaległości, MPZP)" },
    { key: "przedwst",  label: "Umowa przedwstępna" },
    { key: "finans",    label: "Potwierdzenie finansowania nabywcy" },
    { key: "notariusz", label: "Termin u notariusza" },
    { key: "akt",       label: "Akt notarialny" },
    { key: "wydanie",   label: "Protokół zdawczo-odbiorczy" },
    { key: "pcc",       label: "Rozliczenie podatku PCC" },
  ] as const;
  for (let i = 0; i < 28; i++) {
    const status = pick(txStatuses);
    const isClosed = status === "COMPLETED";
    const signedAt = status === "DRAFT" ? null : daysAgo(rand(3, 90));
    const odniesienie = signedAt ?? SEASON_END;
    const prop = ofertaSprzed(odniesienie);
    const buyer = kontaktSprzed(odniesienie);
    const seller = kontaktSprzed(odniesienie);
    const zalozono = wRamachHistorii(
      signedAt
        ? new Date(signedAt.getTime() - rand(5, 40) * 86_400_000)
        : poDacie([prop.createdAt, buyer.createdAt, seller.createdAt]),
      najpozniejsza(prop.createdAt, buyer.createdAt, seller.createdAt),
    );
    const price = num(prop.price);
    zaplanujZapis(new Transaction({
      kind: prop.transactionType === "RENT" ? pick(["RENT", "LEASE"] as const) : "SALE",
      status,
      price,
      currency: "PLN",
      deposit: Math.round((price * pick([0, 0.05, 0.1])) / 100) * 100,
      signedAt,
      closedAt:
        isClosed && signedAt
          ? nieWPrzyszlosci(new Date(signedAt.getTime() + rand(7, 45) * 86_400_000))
          : null,
      buyerContactId: buyer._id,
      sellerContactId: seller._id,
      buyerName: buyer.name,
      sellerName: seller.name,
      propertyId: prop._id,
      agentId: prop.agentId,
      companyId: cid,
      notes: pick(TX_NOTES[status] ?? TX_NOTES.PENDING!),
      checklist: (() => {
        const done = status === "COMPLETED" ? CHECKLIST_STEPS.length
          : status === "DRAFT" ? 0
          : rand(2, CHECKLIST_STEPS.length - 1);
        return CHECKLIST_STEPS.map((step, idx) => ({
          key: step.key,
          label: step.label,
          done: idx < done,
          completedAt: idx < done && signedAt
            ? nieWPrzyszlosci(new Date(signedAt.getTime() + idx * 3 * 86_400_000))
            : null,
        }));
      })(),
    }), admin, zalozono);
  }

  const taskTitles = [
    "Zadzwonić do klienta po prezentacji",
    "Przygotować umowę pośrednictwa",
    "Zamówić sesję zdjęciową nieruchomości",
    "Zweryfikować księgę wieczystą",
    "Wysłać ofertę do portali ogłoszeniowych",
    "Umówić termin u notariusza",
    "Zebrać dokumenty do kredytu",
    "Zaktualizować cenę po analizie rynku",
    "Potwierdzić termin odbioru technicznego",
    "Przygotować raport dla właściciela",
  ];
  const taskStatuses = ["TODO", "TODO", "IN_PROGRESS", "IN_PROGRESS", "DONE", "DONE", "BLOCKED", "CANCELLED"] as const;
  const taskPriorities = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "URGENT"] as const;
  for (let i = 0; i < 32; i++) {
    const status = pick(taskStatuses);
    const isDone = status === "DONE";
    const utworzono = isDone ? daysAgo(rand(20, 60)) : daysAgo(rand(1, 30));
    const prop = ofertaSprzed(utworzono);
    const c = kontaktSprzed(utworzono);
    const completedAt = isDone
      ? wRamachHistorii(new Date(utworzono.getTime() + rand(1, 18) * 86_400_000), utworzono)
      : null;
    zaplanujZapis(new Task({
      title: pick(taskTitles),
      description: [
        `Dotyczy oferty: ${prop.title}.`,
        `Kontakt: ${c.name}, tel. ${c.phone}.`,
        pick([
          "Priorytet ustalony z menedżerem zespołu na porannej odprawie.",
          "Po wykonaniu zaktualizować status w CRM i powiadomić właściciela.",
          "Termin wynika z ustaleń z klientem podczas ostatniej rozmowy.",
          "Jeśli klient nie odbierze, wysłać wiadomość i ponowić próbę następnego dnia.",
        ]),
      ].join("\n"),
      status,
      priority: pick(taskPriorities),
      dueAt:
        isDone && completedAt
          ? new Date(completedAt.getTime() + rand(-3, 2) * 86_400_000)
          : daysAhead(rand(0, 21), rand(9, 17)),
      completedAt,
      checklist: sample(
        [
          "Zebrać dokumenty", "Potwierdzić termin", "Wysłać podsumowanie",
          "Zaktualizować CRM", "Uzgodnić cenę z właścicielem", "Przygotować zdjęcia",
        ],
        rand(2, 4),
      ).map((label, idx) => ({
        done: isDone || (status === "IN_PROGRESS" && idx === 0),
        label,
      })),
      assigneeId: pick(agents)._id,
      createdById: manager._id,
      relatedType: "Property",
      relatedId: prop._id,
      propertyId: prop._id,
      contactId: c._id,
      companyId: cid,
    }), pick(agents), utworzono);
  }

  const dojrzale = (saleProperties.length ? saleProperties : properties).filter(
    (p: any) => p.createdAt.getTime() <= daysAgo(200).getTime(),
  );
  const storyPool = dojrzale.length >= 2 ? dojrzale : saleProperties.length ? saleProperties : properties;
  const historieSprzedazy: { prop: any; zamkniete: Date }[] = [];
  for (let i = 0; i < Math.min(2, storyPool.length); i++) {
    const prop = storyPool[i]!;
    const wystawiono: Date = prop.createdAt;
    const dataZapytania = wRamachHistorii(new Date(wystawiono.getTime() + rand(5, 30) * 86_400_000), wystawiono);
    const dataPrezentacji = wRamachHistorii(new Date(dataZapytania.getTime() + rand(3, 14) * 86_400_000), dataZapytania);
    const dataUmowy = wRamachHistorii(new Date(dataPrezentacji.getTime() + rand(7, 21) * 86_400_000), dataPrezentacji);
    const dataZamkniecia = wRamachHistorii(new Date(dataUmowy.getTime() + rand(20, 45) * 86_400_000), dataUmowy);
    const dataWyplaty = wRamachHistorii(new Date(dataZamkniecia.getTime() + rand(3, 14) * 86_400_000), dataZamkniecia);
    const buyer = kontaktSprzed(dataZapytania);
    const agentId = prop.agentId ?? pick(agents)._id;

    const enq = zaplanujZapis(new Enquiry({
      name: buyer.name, email: buyer.email, phone: buyer.phone,
      propertyInterest: prop.propertyType, location: prop.location,
      budget: num(prop.price),
      source: pick(enqSources), priority: "HIGH", status: "NEGOTIATING",
      note: "Zapytanie zakończone transakcją — pełna historia dostępna w lejku sprzedażowym.",
      consentGivenAt: dataZapytania,
      agentId, propertyId: prop._id, companyId: cid,
    }), admin, dataZapytania);
    enquiries.push(enq);
    const przydzielono = new Date(dataZapytania.getTime() + rand(5, 90) * 1_000);
    zaplanuj(przydzielono, () =>
      new EnquiryAllocation({
        enquiryId: enq._id, agentId, companyId: cid,
        method: "AUTO", allocatedAt: przydzielono,
      }).save(),
    );

    leads.push(zaplanujZapis(new PipelineLead({
      title: `${prop.title} — ${buyer.name}`,
      stage: "CLOSED", source: "Kontakt bezpośredni",
      estValue: num(prop.price), agentId, contactId: buyer._id, propertyId: prop._id,
      companyId: cid,
    }), pick(agents), new Date(dataZapytania.getTime() + 20 * 60_000)));

    zaplanujZapis(new Viewing({
      scheduledAt: dataPrezentacji,
      durationMin: 45,
      status: "COMPLETED",
      outcome: "OFFER_MADE",
      rating: 5,
      feedback: pick(feedbackByOutcome.OFFER_MADE!),
      followUpAt: null,
      propertyId: prop._id,
      contactId: buyer._id,
      agentId,
      companyId: cid,
    }), pick(agents), wRamachHistorii(new Date(dataPrezentacji.getTime() - 3 * 86_400_000), dataZapytania));

    const price = num(prop.price);
    const signedAt = dataUmowy;
    const closedAt = dataZamkniecia;
    historieSprzedazy.push({ prop, zamkniete: closedAt });
    zaplanujZapis(new Transaction({
      kind: "SALE",
      status: "COMPLETED",
      price,
      currency: "PLN",
      deposit: Math.round((price * 0.1) / 100) * 100,
      signedAt,
      closedAt,
      buyerContactId: buyer._id,
      sellerContactId: null,
      buyerName: buyer.name,
      sellerName: null,
      propertyId: prop._id,
      agentId,
      companyId: cid,
      notes: "Transakcja zakończona pomyślnie — patrz historia w lejku sprzedażowym i prezentacjach.",
      checklist: CHECKLIST_STEPS.map((step, idx) => ({
        key: step.key,
        label: step.label,
        done: true,
        completedAt: nieWPrzyszlosci(new Date(signedAt.getTime() + idx * 3 * 86_400_000)),
      })),
    }), admin, wRamachHistorii(new Date(signedAt.getTime() - 5 * 86_400_000), dataPrezentacji));

    const rate = 2.5;
    zaplanujZapis(new Commission({
      salePrice: price, rate, amount: Math.round((price * rate) / 100),
      status: "PAID", dealDate: closedAt, paidDate: dataWyplaty,
      invoiceNumber: `FV/${closedAt.getFullYear()}/${String(rand(1, 999)).padStart(3, "0")}`,
      clientName: buyer.name, agentId, propertyId: prop._id, companyId: cid,
    }), admin, closedAt);
  }

  const historiaDoOznaczenia = historieSprzedazy.find(
    ({ prop }) => prop.status !== "SOLD" && !prop.propShareListed,
  );
  const doOznaczenia =
    historiaDoOznaczenia?.prop ?? properties.find((p) => p.status === "ACTIVE" && !p.propShareListed);
  if (doOznaczenia) {
    const kiedySprzedano = wRamachHistorii(
      new Date((historiaDoOznaczenia?.zamkniete ?? daysAgo(rand(3, 25))).getTime() + 2 * 3_600_000),
      doOznaczenia.createdAt,
    );
    zaplanuj(kiedySprzedano, async () => {
      doOznaczenia.status = "SOLD";
      await updateAs(doOznaczenia, admin, kiedySprzedano);
    });
  }

  const propShareProps = properties.filter((p) => p.propShareListed);
  return {
    company, properties: properties.length,
    historia,
    companyId: cid,
    agentIds: agents.map((a: any) => a._id as string),
    zespol: agents as any[],
    adminId: admin._id as string,
    adminUser: admin,
    managerUser: manager ?? admin,
    agentUser: users.AGENT[0] ?? admin,
    assistantUser: assistants[0] ?? admin,
    propShareProps,
    enquiries,
  };
}

async function seed() {
  await connectDB();

  const reset = process.argv.includes("--reset");
  const existing = await User.countDocuments();

  if (existing > 0 && !reset) {
    console.error(
      `\n❌  Database already has ${existing} user(s). Run on an empty DB, or pass --reset to wipe it first.\n`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (reset && existing > 0) {
    const dbName = mongoose.connection.name;
    const collections = await mongoose.connection.db!.collections();
    console.log(`\n⚠️   --reset: dropping ${collections.length} collection(s) from "${dbName}"…`);
    for (const c of collections) await c.deleteMany({});
    console.log("✔  Database cleared\n");
  }

  const platform = await saveAs(new Company({
    name: "Realty Nest", domain: "realtynest.io", type: "PLATFORM", isActive: true,
    settings: { website: "https://realtynest.io", email: "hello@realtynest.io" },
  }), null, dniTemuOGodzinie(DNI_WDROZENIA_PLATFORMY, 9, 15));

  const [adminFirstName, ...adminLastNameParts] = SYSTEM_ADMIN_NAME.split(" ");
  const adminLastName = adminLastNameParts.join(" ");
  const bartek = await saveAs(new User({
    email: SYSTEM_ADMIN_EMAIL,
    password: await bcrypt.hash(DEMO_PASSWORD, 12),
    name: SYSTEM_ADMIN_NAME,
    role: "SYSTEM_ADMIN",
    companyId: platform._id,
    isActive: true,
    profile: { firstName: adminFirstName, lastName: adminLastName, jobTitle: "Administrator platformy", phone: "+48 600 000 000", timezone: "Europe/Warsaw", language: "pl" },
  }), null, dniTemuOGodzinie(DNI_WDROZENIA_PLATFORMY, 9, 40));

  let totalProps = 0;
  const agencyResults: { name: string; props: number }[] = [];
  const agencyData: Awaited<ReturnType<typeof buildAgency>>[] = [];
  for (let i = 0; i < AGENCIES.length; i++) {
    const r = await buildAgency(AGENCIES[i]!, bartek, i);
    totalProps += r.properties;
    agencyResults.push({ name: AGENCIES[i]!.name, props: r.properties });
    agencyData.push(r);
  }

  const historia: PozycjaHistorii[] = agencyData.flatMap((a) => a.historia);

  const agencjaPoDomenie = new Map(AGENCIES.map((cfg, i) => [cfg.domain, agencyData[i]!]));
  const agencjaWarszawa = agencjaPoDomenie.get("nestrealty.pl")!;
  const agencjaKrakow = agencjaPoDomenie.get("krakowpremium.pl")!;
  const agencjaWroclaw = agencjaPoDomenie.get("wroclawcity.pl")!;
  const agencjaGdansk = agencjaPoDomenie.get("balticcoast.pl")!;

  const dostepDwuskladnikowy: string[] = [];
  let bladDwuskladnikowego: string | null = null;
  try {
    for (const rekord of await zbudujDwuskladnikowe()) {
      const wynik = await User.updateOne(
        { email: rekord.email },
        { $set: { twoFactor: rekord.twoFactor } },
      );
      if (wynik.matchedCount !== 1) {
        throw new Error(`konta ${rekord.email} nie ma w bazie (dopasowano ${wynik.matchedCount})`);
      }
      dostepDwuskladnikowy.push(
        `${rekord.email} — sekret ${rekord.sekretBase32}, kody zapasowe: ${rekord.kodyZapasowe.join(", ")}`,
      );
    }
  } catch (blad) {
    bladDwuskladnikowego = (blad as Error).message;
    console.warn(
      `\n  ⚠  Drugi składnik logowania NIE został włączony: ${bladDwuskladnikowego}` +
        "\n     Najczęstsza przyczyna to brak zmiennej TOTP_ENCRYPT_KEY (64 znaki szesnastkowe) w pliku .env." +
        "\n     Pozostałe dane demonstracyjne powstają normalnie.\n",
    );
  }

  const uczestnik = (u: any): UczestnikDziennika => ({
    id: String(u._id),
    shortId: Number(u.shortId),
    name: String(u.name),
    email: String(u.email),
    role: String(u.role),
    companyId: u.companyId ? String(u.companyId) : null,
  });
  const dziennikBezpieczenstwa = zbudujDziennikBezpieczenstwa({
    administratorWarszawa: uczestnik(agencjaWarszawa.adminUser),
    administratorKrakow: uczestnik(agencjaKrakow.adminUser),
    administratorWroclaw: uczestnik(agencjaWroclaw.adminUser),
    administratorGdansk: uczestnik(agencjaGdansk.adminUser),
    agentWarszawa: uczestnik(agencjaWarszawa.agentUser),
    agentKrakow: uczestnik(agencjaKrakow.agentUser),
    agentGdansk: uczestnik(agencjaGdansk.agentUser),
    kierownikWroclaw: uczestnik(agencjaWroclaw.managerUser),
    asystent: uczestnik(agencjaWarszawa.assistantUser),
  });
  for (const wpis of dziennikBezpieczenstwa) {
    historia.push({ kiedy: wpis.createdAt, wykonaj: () => new ActivityLog(wpis).save({ timestamps: false }) });
  }

  const OFFER_MESSAGES = [
    "Dzień dobry, mam klienta zainteresowanego tą nieruchomością. Proszę o kontakt w celu omówienia współpracy.",
    "Klient dysponuje gotówką i szuka pilnie. Czy możemy umówić się na prezentację?",
    "Oferuję standardową prowizję 50/50. Klient bardzo zainteresowany lokalizacją.",
    "Prowadzę kupującego z uruchomionym kredytem. Proszę o informację o dostępnych terminach oglądania.",
    "Klient poszukuje dokładnie takiego metrażu w tej dzielnicy. Otwarty na negocjację podziału prowizji.",
  ];

  const makeOffer = (opts: {
    sender: (typeof agencyData)[number];
    receiver: (typeof agencyData)[number];
    fromAgentId: string;
    property: any;
    status: string;
  }) => {
    const { sender, receiver, fromAgentId, property, status } = opts;

    const wystawiono: Date = property.propShareListedAt ?? property.createdAt;
    const sentAt = dataZPrzedzialu(wystawiono, new Date(wystawiono.getTime() + rand(6, 240) * 3_600_000));
    const opened = ["VIEWED", "ACCEPTED", "REJECTED"].includes(status);
    const answered = ["ACCEPTED", "REJECTED"].includes(status);
    const viewedAt = opened
      ? dataZPrzedzialu(sentAt, new Date(sentAt.getTime() + rand(1, 60) * 3_600_000))
      : null;
    const respondedAt =
      answered && viewedAt
        ? dataZPrzedzialu(viewedAt, new Date(viewedAt.getTime() + rand(1, 72) * 3_600_000))
        : null;
    const nadawca = sender.zespol.find((a: any) => String(a._id) === String(fromAgentId)) ?? null;
    const powiazaneZapytania = sender.enquiries.filter(
      (e: any) => e.createdAt.getTime() <= sentAt.getTime(),
    );

    const offer = new PropShareOffer({
      propertyId: property._id,
      fromAgentId,
      fromCompanyId: sender.companyId,
      toAgentId: property.agentId,
      toCompanyId: receiver.companyId,
      enquiryId: powiazaneZapytania.length ? pick(powiazaneZapytania)._id : null,
      status,
      message: pick(OFFER_MESSAGES),
      proposedCommission: pick([1.5, 2.0, 2.5, 3.0]),
      viewedAt,
      respondedAt,
      createdAt: sentAt,
      updatedAt: respondedAt ?? viewedAt ?? sentAt,
    });
    historia.push({
      kiedy: sentAt,
      wykonaj: async () => {
        offer.$locals = { ...(offer.$locals ?? {}), actor: nadawca, logAt: sentAt };
        await offer.save({ timestamps: false });
      },
    });
  };

  const offerStatuses = ["PENDING", "PENDING", "VIEWED", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const;

  for (let i = 0; i < agencyData.length; i++) {
    const sender = agencyData[i]!;

    for (let j = 1; j < agencyData.length; j++) {
      const receiver = agencyData[(i + j) % agencyData.length]!;
      if (!receiver.propShareProps.length || !sender.agentIds.length) continue;

      for (const property of sample(receiver.propShareProps, Math.min(3, receiver.propShareProps.length))) {
        makeOffer({
          sender,
          receiver,
          fromAgentId: pick(sender.agentIds),
          property,
          status: pick(offerStatuses),
        });
      }
    }

    const nextAgency = agencyData[(i + 1) % agencyData.length]!;
    if (nextAgency.propShareProps.length) {
      makeOffer({
        sender,
        receiver: nextAgency,
        fromAgentId: sender.adminId,
        property: pick(nextAgency.propShareProps),
        status: "PENDING",
      });
    }

    const ownListing = sender.propShareProps.find((p: any) => p.agentId === sender.adminId)
      ?? sender.propShareProps[0];
    if (ownListing && nextAgency.agentIds.length) {
      const original = ownListing.agentId;
      ownListing.agentId = sender.adminId;
      makeOffer({
        sender: nextAgency,
        receiver: sender,
        fromAgentId: pick(nextAgency.agentIds),
        property: ownListing,
        status: "PENDING",
      });
      ownListing.agentId = original;
    }
  }

  console.log(`\n  ⏳  Zapisuję ${historia.length} zdarzeń w kolejności chronologicznej…`);
  await odtworzHistorie(historia);
  console.log("  ✔  Historia zapisana\n");

  let licznikKopii = 0;
  const zrzutBazyNaDzien = await przygotujZrzuty();
  const kopieZapasowe = await zbudujKopieZapasowe({
    administratorSystemuId: String(bartek._id),
    administratorSystemuNazwa: String(bartek.name),
    zrzut: zrzutBazyNaDzien,
    zapisz: async (kopia) => {
      await new Backup(kopia).save({ timestamps: false });
      licznikKopii++;
      const rozmiar = (kopia.sizeBytes / 1_048_576).toFixed(2);
      console.log(
        `  • kopia ${licznikKopii}/16 — ${kopia.createdAt.toISOString().slice(0, 10)}, ` +
          `${kopia.docCount} dok., ${rozmiar} MB, ${kopia.status}` +
          (kopia.publicId ? ` → ${kopia.publicId}` : " (bez pliku w magazynie)"),
      );
    },
  });

  const counts = {
    companies: await Company.countDocuments(),
    users: await User.countDocuments(),
    properties: await Property.countDocuments(),
    contacts: await Contact.countDocuments(),
    enquiries: await Enquiry.countDocuments(),
    leads: await PipelineLead.countDocuments(),
    commissions: await Commission.countDocuments(),
    documents: await Document.countDocuments(),
    campaigns: await Campaign.countDocuments(),
    events: await CalendarEvent.countDocuments(),
    viewings: await Viewing.countDocuments(),
    transactions: await Transaction.countDocuments(),
    tasks: await Task.countDocuments(),
    logs: await ActivityLog.countDocuments(),
    propShareOffers: await PropShareOffer.countDocuments(),
    enquiryAllocations: await EnquiryAllocation.countDocuments(),
    backups: await Backup.countDocuments(),
  };

  const nieudaneKopie = kopieZapasowe.filter((k) => k.status === "FAILED").length;
  const kopie = podsumowanieKopii();
  const statusKopii = !kopie.skonfigurowane
    ? "bez plików w magazynie (brak zmiennych CLOUDINARY_*) — publicId = null, „Pobierz” zwróci 404"
    : kopie.wyslane > 0
      ? `${kopie.wyslane} plików zrzutu w magazynie${kopie.bledy ? `, ${kopie.bledy} nieudanych` : ""} — „Pobierz” działa`
      : `wysyłka do magazynu nie powiodła się (${kopie.bledy} prób) — publicId = null, „Pobierz” zwróci 404`;
  const blokBezpieczenstwa = [
    `    Kopie zapasowe: ${counts.backups} pozycji w rejestrze (w tym ${nieudaneKopie} nieudane — pokazują obsługę błędu)`,
    `      ${statusKopii}`,
    `    Dziennik incydentów: ${dziennikBezpieczenstwa.length} wpisów — masowe pobrania zatrzymane przez DLP,`,
    "      pułapki adresowe, ocena ryzyka logowania i logowania drugim składnikiem",
    bladDwuskladnikowego
      ? `    Drugi składnik: NIE włączony — ${bladDwuskladnikowego}`
      : "    Drugi składnik (TOTP) — hasło, a potem kod z aplikacji uwierzytelniającej:",
    ...(bladDwuskladnikowego ? [] : dostepDwuskladnikowy.map((w) => `      • ${w}`)),
  ].join("\n");

  const pliki = podsumowanieWysylki();
  const statusPlikow = pliki.skonfigurowane
    ? `${pliki.wyslane} plików PDF wysłano do magazynu${pliki.bledy ? `, ${pliki.bledy} nieudanych` : ""}`
    : "pliki PDF wygenerowano, ale nie wysłano — brak zmiennych CLOUDINARY_* (rekordy mają publicId = null)";

  console.log(`
✅  Demo data seeded successfully!

  Platform : ${platform.name}  (#${platform.shortId})
  SYSTEM_ADMIN → ${bartek.email}   (${bartek.name})

  Agencies:
${agencyResults.map((a) => `    • ${a.name} — ${a.props} properties`).join("\n")}

  Totals:
    Companies : ${counts.companies}    Users      : ${counts.users}
    Properties: ${counts.properties}    Contacts   : ${counts.contacts}
    Enquiries : ${counts.enquiries}    Leads      : ${counts.leads}
    Commissions: ${counts.commissions}   Documents  : ${counts.documents}
    Dokumenty  : ${statusPlikow}
    Campaigns : ${counts.campaigns}    Events     : ${counts.events}
    Viewings  : ${counts.viewings}    Transactions: ${counts.transactions}
    Tasks     : ${counts.tasks}    Backups     : ${counts.backups}
    PropShare offers: ${counts.propShareOffers}    Allocations: ${counts.enquiryAllocations}
    Activity logs: ${counts.logs}

  Bezpieczeństwo:
${blokBezpieczenstwa}

  Password for ALL accounts: ${DEMO_PASSWORD}

  Sign in:
    ${SYSTEM_ADMIN_EMAIL}   → SYSTEM_ADMIN (sees everything)
    admin@nestrealty.pl              → COMPANY_ADMIN (Nest Realty Warszawa)
    manager@ / agent1@…agent6@ / assistant1@ / assistant2@ <agency-domain> per agency.
    admin@wroclawcity.pl i admin@balticcoast.pl wymagają dodatkowo kodu z aplikacji
    uwierzytelniającej — sekret i kody zapasowe wypisano wyżej.

  ⚠️  Do not use these credentials in production.
`);

  await mongoose.disconnect();
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
