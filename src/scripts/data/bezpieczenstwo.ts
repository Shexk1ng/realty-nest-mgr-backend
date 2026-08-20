// Dane demonstracyjne trzech modułów bezpieczeństwa: drugiego składnika logowania (TOTP),
// rejestru kopii zapasowych oraz dziennika zdarzeń bezpieczeństwa — do pracy magisterskiej.

import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { generateURI } from "otplib";
import { encryptSecret } from "../../utils/totp.js";
import { bezpiecznyKatalog, czyCloudinarySkonfigurowane } from "./dokumenty.js";

const NAZWA_APLIKACJI = "Realty Nest";


function oDniTemu(teraz: Date, dni: number, godzina: number, minuta: number): Date {
  const d = new Date(teraz);
  d.setDate(d.getDate() - dni);
  d.setHours(godzina, minuta, 0, 0);
  if (d.getTime() > teraz.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

function oMinutTemu(teraz: Date, minut: number): Date {
  return new Date(teraz.getTime() - minut * 60_000);
}

function formaRekordow(n: number): string {
  const dziesiatki = n % 100;
  const jednosci = n % 10;
  if (dziesiatki >= 12 && dziesiatki <= 14) return "rekordów";
  return jednosci >= 2 && jednosci <= 4 ? "rekordy" : "rekordów";
}


export const DOMENY_AGENCJI = [
  "nestrealty.pl",
  "krakowpremium.pl",
  "wroclawcity.pl",
  "balticcoast.pl",
] as const;

const UCHWYTY_TESTOWE = [
  "manager",
  "agent1", "agent2", "agent3", "agent4", "agent5", "agent6",
  "assistant1", "assistant2",
] as const;

export const DOMYSLNY_EMAIL_ADMINISTRATORA_SYSTEMU = "bartlomiejdejewski01@gmail.com";

export const KONTA_ZAREZERWOWANE_DLA_TESTOW: readonly string[] = [
  ...DOMENY_AGENCJI.flatMap((domena) => UCHWYTY_TESTOWE.map((uchwyt) => `${uchwyt}@${domena}`)),
  "admin@nestrealty.pl",
  "admin@krakowpremium.pl",
];

export function czyKontoZarezerwowaneDlaTestow(email: string): boolean {
  const adres = email.trim().toLowerCase();
  const administratorSystemu = (
    process.env.SEED_ADMIN_EMAIL ?? DOMYSLNY_EMAIL_ADMINISTRATORA_SYSTEMU
  ).trim().toLowerCase();
  return adres === administratorSystemu || KONTA_ZAREZERWOWANE_DLA_TESTOW.includes(adres);
}

interface DefinicjaSekretu {
  email: string;
  sekretBase32: string;
  wlaczoneDniTemu: number;
  godzina: number;
  minuta: number;
  kodyZapasowe: readonly string[];
  opis: string;
}

const SEKRETY: readonly DefinicjaSekretu[] = [
  {
    email: "admin@wroclawcity.pl",
    sekretBase32: "WROCLAWCITYADMIN2FA7NESTREALTY55",
    wlaczoneDniTemu: 96,
    godzina: 10,
    minuta: 24,
    kodyZapasowe: [
      "4B7C-19DE", "A03F-6C21", "7E12-B8A4", "C5D0-3F97",
      "18AB-42EC", "9F63-D50A", "2C84-7BE1", "E6A9-051F",
    ],
    opis: "Broker prowadzący Wrocław City Homes — komplet ośmiu nieużytych kodów zapasowych.",
  },
  {
    email: "admin@balticcoast.pl",
    sekretBase32: "BALTICCOASTADMIN2FA7NESTREALTY66",
    wlaczoneDniTemu: 61,
    godzina: 15,
    minuta: 47,
    kodyZapasowe: [
      "5D1E-8AC0", "B274-F93A", "0C68-31DB",
      "AE95-7204", "63F1-D8B7", "1A40-9E52",
    ],
    opis:
      "Broker prowadzący Baltic Coast Properties — dwa z ośmiu kodów zapasowych zostały " +
      "zużyte (odpowiadają im wpisy AUTH_LOGIN metodą 2fa_backup w dzienniku).",
  },
];

export const KODY_ZAPASOWE_JAWNE: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(SEKRETY.map((s) => [s.email, s.kodyZapasowe])),
);

export const SEKRETY_JAWNE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SEKRETY.map((s) => [s.email, s.sekretBase32])),
);

export interface RekordDwuskladnikowy {
  email: string;
  twoFactor: {
    enabled: true;
    secret: string;
    backupCodes: string[];
    enabledAt: Date;
  };
  sekretBase32: string;
  otpauthUrl: string;
  kodyZapasowe: readonly string[];
  opis: string;
}

const WZORZEC_BASE32 = /^[A-Z2-7]{32}$/;
const WZORZEC_KODU = /^[0-9A-F]{4}-[0-9A-F]{4}$/;

export async function zbudujDwuskladnikowe(
  opcje: { teraz?: Date } = {},
): Promise<RekordDwuskladnikowy[]> {
  const teraz = opcje.teraz ?? new Date();

  const klucz = process.env.TOTP_ENCRYPT_KEY;
  if (!klucz || !/^[0-9a-fA-F]{64}$/.test(klucz)) {
    throw new Error(
      "bezpieczenstwo.ts: TOTP_ENCRYPT_KEY musi być ustawiony i mieć 64 znaki szesnastkowe " +
        "(32 bajty). Bez niego sekretu TOTP nie da się zaszyfrować tak, by serwer GraphQL " +
        "go odczytał.",
    );
  }

  const rekordy: RekordDwuskladnikowy[] = [];

  for (const def of SEKRETY) {
    if (czyKontoZarezerwowaneDlaTestow(def.email)) {
      throw new Error(
        `bezpieczenstwo.ts: konto ${def.email} jest używane przez pakiety testowe ` +
          "(test-blackbox.mjs / test-authz.ts / perf-login.k6.js), które logują się samym " +
          "hasłem. Włączenie drugiego składnika oblałoby te testy.",
      );
    }
    if (!WZORZEC_BASE32.test(def.sekretBase32)) {
      throw new Error(`bezpieczenstwo.ts: sekret dla ${def.email} nie jest poprawnym Base32.`);
    }

    const zleKody = def.kodyZapasowe.filter((kod) => !WZORZEC_KODU.test(kod));
    if (zleKody.length > 0) {
      throw new Error(
        `bezpieczenstwo.ts: kody zapasowe ${zleKody.join(", ")} (${def.email}) mają zły format.`,
      );
    }

    const backupCodes = await Promise.all(
      def.kodyZapasowe.map((kod) => bcrypt.hash(kod.replace(/-/g, "").toUpperCase(), 10)),
    );

    rekordy.push({
      email: def.email,
      twoFactor: {
        enabled: true,
        secret: encryptSecret(def.sekretBase32),
        backupCodes,
        enabledAt: oDniTemu(teraz, def.wlaczoneDniTemu, def.godzina, def.minuta),
      },
      sekretBase32: def.sekretBase32,
      otpauthUrl: generateURI({
        issuer: NAZWA_APLIKACJI,
        label: def.email,
        secret: def.sekretBase32,
      }),
      kodyZapasowe: def.kodyZapasowe,
      opis: def.opis,
    });
  }

  return rekordy;
}


export interface RekordKopiiZapasowej {
  publicId: string | null;
  status: "COMPLETE" | "FAILED";
  errorMessage: string | null;
  sizeBytes: number;
  collectionsCount: number;
  docCount: number;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PozycjaKopii {
  dniTemu: number;
  godzina: number;
  minuta: number;
  status: "COMPLETE" | "FAILED";
  docCount: number;
  sizeBytes: number;
  collectionsCount: number;
  automatyczna: boolean;
  errorMessage: string | null;
}

const HARMONOGRAM_KOPII: readonly PozycjaKopii[] = [
  { dniTemu: 63, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 6118, sizeBytes: 3_168_442, collectionsCount: 16, automatyczna: true,  errorMessage: null },
  { dniTemu: 58, godzina: 11, minuta: 20, status: "COMPLETE", docCount: 6240, sizeBytes: 3_231_908, collectionsCount: 17, automatyczna: false, errorMessage: null },
  { dniTemu: 56, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 6287, sizeBytes: 3_255_610, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  { dniTemu: 49, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 6402, sizeBytes: 3_314_977, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  { dniTemu: 45, godzina: 16, minuta: 5,  status: "COMPLETE", docCount: 6511, sizeBytes: 3_371_268, collectionsCount: 17, automatyczna: false, errorMessage: null },
  { dniTemu: 42, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 6588, sizeBytes: 3_410_553, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  {
    dniTemu: 35, godzina: 2, minuta: 15, status: "FAILED", docCount: 6744, sizeBytes: 3_490_111,
    collectionsCount: 17, automatyczna: true,
    errorMessage: "Request Timeout — przesyłanie zrzutu do magazynu przerwane po 60 s (Cloudinary: 499).",
  },
  { dniTemu: 34, godzina: 9,  minuta: 5,  status: "COMPLETE", docCount: 6751, sizeBytes: 3_494_088, collectionsCount: 17, automatyczna: false, errorMessage: null },
  { dniTemu: 28, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 6903, sizeBytes: 3_572_641, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  {
    dniTemu: 26, godzina: 14, minuta: 12, status: "FAILED", docCount: 7010, sizeBytes: 3_628_033,
    collectionsCount: 17, automatyczna: false,
    errorMessage: "Storage quota exceeded — magazyn kopii zapasowych osiągnął limit planu (Cloudinary: 420).",
  },
  { dniTemu: 21, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 7188, sizeBytes: 3_719_402, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  { dniTemu: 14, godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 7460, sizeBytes: 3_860_155, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  { dniTemu: 12, godzina: 9,  minuta: 40, status: "COMPLETE", docCount: 7604, sizeBytes: 3_934_690, collectionsCount: 17, automatyczna: false, errorMessage: null },
  { dniTemu: 7,  godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 7902, sizeBytes: 4_088_913, collectionsCount: 17, automatyczna: true,  errorMessage: null },
  { dniTemu: 3,  godzina: 18, minuta: 25, status: "COMPLETE", docCount: 8355, sizeBytes: 4_323_470, collectionsCount: 17, automatyczna: false, errorMessage: null },
  { dniTemu: 1,  godzina: 2,  minuta: 15, status: "COMPLETE", docCount: 8618, sizeBytes: 4_459_552, collectionsCount: 17, automatyczna: true,  errorMessage: null },
];

export const AUTOR_HARMONOGRAM = "Zadanie nocne (harmonogram)";

export interface ZrzutBazy {
  bytes: Buffer;
  docCount: number;
  collectionsCount: number;
}


let wyslaneKopie = 0;
let bledyKopii = 0;
let ostrzezenieOKopiach = false;

function podpiszParametryKopii(parametry: Record<string, string>, sekret: string): string {
  const doPodpisu = Object.keys(parametry)
    .sort()
    .map((klucz) => `${klucz}=${parametry[klucz]}`)
    .join("&");
  return createHash("sha1").update(`${doPodpisu}${sekret}`, "utf8").digest("hex");
}

export async function przeslijKopieDoCloudinary(
  zrzut: ZrzutBazy,
  nazwaPliku: string,
  opcje: { folder?: string | null; timeoutMs?: number } = {},
): Promise<{ publicId: string; sizeBytes: number } | null> {
  if (!czyCloudinarySkonfigurowane()) {
    if (!ostrzezenieOKopiach) {
      ostrzezenieOKopiach = true;
      console.warn(
        [
          "",
          "  ⚠ [kopie] Brak konfiguracji Cloudinary — pliki kopii zapasowych nie zostaną wysłane.",
          "    Rekordy powstaną z publicId = null, czyli tak jak dotychczas, a „Pobierz” zwróci 404.",
          "",
        ].join("\n"),
      );
    }
    return null;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;

  const parametryPodpisywane: Record<string, string> = {
    folder: bezpiecznyKatalog(opcje.folder ?? "backups"),
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "authenticated",
    unique_filename: "1",
    use_filename: "1",
  };
  const podpis = podpiszParametryKopii(parametryPodpisywane, apiSecret);

  const formularz = new FormData();
  for (const [klucz, wartosc] of Object.entries(parametryPodpisywane)) formularz.append(klucz, wartosc);
  formularz.append("api_key", apiKey);
  formularz.append("signature", podpis);
  formularz.append(
    "file",
    new Blob([new Uint8Array(zrzut.bytes)], { type: "application/json" }),
    nazwaPliku,
  );

  try {
    const odpowiedz = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
      method: "POST",
      body: formularz,
      signal: AbortSignal.timeout(opcje.timeoutMs ?? 120_000),
    });
    const tresc = (await odpowiedz.json()) as {
      public_id?: string;
      bytes?: number;
      error?: { message?: string };
    };

    if (!odpowiedz.ok || !tresc.public_id) {
      bledyKopii++;
      console.warn(
        `  ⚠ [kopie] Nie udało się wysłać „${nazwaPliku}”: ${tresc.error?.message ?? `HTTP ${odpowiedz.status}`}`,
      );
      return null;
    }

    wyslaneKopie++;
    return { publicId: tresc.public_id, sizeBytes: tresc.bytes ?? zrzut.bytes.length };
  } catch (blad) {
    bledyKopii++;
    console.warn(
      `  ⚠ [kopie] Błąd sieci przy wysyłce „${nazwaPliku}”: ${blad instanceof Error ? blad.message : String(blad)}`,
    );
    return null;
  }
}

export function podsumowanieKopii(): { wyslane: number; bledy: number; skonfigurowane: boolean } {
  return { wyslane: wyslaneKopie, bledy: bledyKopii, skonfigurowane: czyCloudinarySkonfigurowane() };
}

function nazwaPlikuKopii(kiedy: Date): string {
  return `backup-${kiedy.toISOString().replace(/[:.]/g, "-")}.json`;
}

export async function zbudujKopieZapasowe(opcje: {
  administratorSystemuId: string;
  administratorSystemuNazwa: string;
  teraz?: Date;
  zrzut?: ((kiedy: Date) => Promise<ZrzutBazy | null>) | undefined;
  zapisz?: (rekord: RekordKopiiZapasowej) => Promise<void>;
}): Promise<RekordKopiiZapasowej[]> {
  const teraz = opcje.teraz ?? new Date();
  const wysylkaMozliwa = Boolean(opcje.zrzut) && czyCloudinarySkonfigurowane();
  const rekordy: RekordKopiiZapasowej[] = [];

  for (const poz of HARMONOGRAM_KOPII) {
    const kiedy = oDniTemu(teraz, poz.dniTemu, poz.godzina, poz.minuta);

    let publicId: string | null = null;
    let sizeBytes = poz.sizeBytes;
    let docCount = poz.docCount;
    let collectionsCount = poz.collectionsCount;

    if (wysylkaMozliwa) {
      const zrzut = await opcje.zrzut!(kiedy);
      if (zrzut) {
        docCount = zrzut.docCount;
        collectionsCount = zrzut.collectionsCount;
        sizeBytes = zrzut.bytes.length;
        if (poz.status === "COMPLETE") {
          const wyslane = await przeslijKopieDoCloudinary(zrzut, nazwaPlikuKopii(kiedy));
          if (wyslane) {
            publicId = wyslane.publicId;
            sizeBytes = wyslane.sizeBytes;
          }
        }
      }
    }

    const rekord: RekordKopiiZapasowej = {
      publicId,
      status: poz.status,
      errorMessage: poz.errorMessage,
      sizeBytes,
      collectionsCount,
      docCount,
      createdById: poz.automatyczna ? null : opcje.administratorSystemuId,
      createdByName: poz.automatyczna ? AUTOR_HARMONOGRAM : opcje.administratorSystemuNazwa,
      createdAt: kiedy,
      updatedAt: kiedy,
    };
    rekordy.push(rekord);
    if (opcje.zapisz) await opcje.zapisz(rekord);
  }

  return rekordy;
}


export interface UczestnikDziennika {
  id: string;
  shortId: number;
  name: string;
  email: string;
  role: string;
  companyId: string | null;
}

export interface WpisDziennikaBezpieczenstwa {
  type: string;
  category: "AUTH" | "SYSTEM" | "CONTACT" | "USER" | "PROPERTY" | "ENQUIRY" | "DOCUMENT";
  messageKey: string;
  messageParams: Record<string, unknown>;
  fallbackText: string;
  actorId: string | null;
  actorShortId: number | null;
  actorName: string | null;
  actorRole: string | null;
  targetType: "User" | "None";
  targetId: string | null;
  targetShortId: number | null;
  userId: string | null;
  userShortId: number | null;
  companyId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const UA_PRZEGLADARKA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const UA_TELEFON =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const UA_SKANER = "python-requests/2.31.0";
const UA_CURL = "curl/8.7.1";

const IP_BIURO_WARSZAWA = "31.11.180.44";
const IP_BIURO_KRAKOW = "178.42.96.15";
const IP_BIURO_WROCLAW = "89.64.12.7";
const IP_BIURO_GDANSK = "213.5.208.19";
const IP_DOMOWY_AGENTA = "83.11.244.130";
const IP_OBCY = "185.243.115.24";
const IP_SKANERA = "45.148.10.92";
const IP_SKANERA_AZJA = "103.147.9.61";
const IP_SKANERA_TOR = "171.25.193.78";

interface KontekstWpisu {
  aktor: UczestnikDziennika | null;
  ip: string | null;
  ua: string | null;
  kiedy: Date;
}

function wpis(
  ctx: KontekstWpisu,
  dane: {
    type: string;
    category: WpisDziennikaBezpieczenstwa["category"];
    messageKey: string;
    messageParams: Record<string, unknown>;
    fallbackText: string;
    celUzytkownik?: UczestnikDziennika | null;
    companyId?: string | null;
  },
): WpisDziennikaBezpieczenstwa {
  const cel = dane.celUzytkownik ?? null;
  return {
    type: dane.type,
    category: dane.category,
    messageKey: dane.messageKey,
    messageParams: dane.messageParams,
    fallbackText: dane.fallbackText,
    actorId: ctx.aktor?.id ?? null,
    actorShortId: ctx.aktor?.shortId ?? null,
    actorName: ctx.aktor?.name ?? null,
    actorRole: ctx.aktor?.role ?? null,
    targetType: cel ? "User" : "None",
    targetId: cel?.id ?? null,
    targetShortId: cel?.shortId ?? null,
    userId: cel?.id ?? null,
    userShortId: cel?.shortId ?? null,
    companyId:
      dane.companyId !== undefined ? dane.companyId : (cel?.companyId ?? ctx.aktor?.companyId ?? null),
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
    createdAt: ctx.kiedy,
    updatedAt: ctx.kiedy,
  };
}

const PROGI_DLP = {
  contacts:   { ostrzezenie: 30, blokada: 50,  kategoria: "CONTACT"  as const, mnoga: "kontakty",   dopelniacz: "kontaktów"  },
  properties: { ostrzezenie: 60, blokada: 100, kategoria: "PROPERTY" as const, mnoga: "oferty",     dopelniacz: "ofert"      },
  enquiries:  { ostrzezenie: 40, blokada: 80,  kategoria: "ENQUIRY"  as const, mnoga: "zapytania",  dopelniacz: "zapytań"    },
  documents:  { ostrzezenie: 20, blokada: 50,  kategoria: "DOCUMENT" as const, mnoga: "dokumenty",  dopelniacz: "dokumentów" },
} as const;

type ModulDlp = keyof typeof PROGI_DLP;

function poLiczebniku(n: number, mnoga: string, dopelniacz: string): string {
  const dziesiatki = n % 100;
  const jednosci = n % 10;
  if (dziesiatki >= 12 && dziesiatki <= 14) return dopelniacz;
  return jednosci >= 2 && jednosci <= 4 ? mnoga : dopelniacz;
}

interface IncydentDlp {
  dniTemu: number;
  godzina: number;
  minuta: number;
  modul: ModulDlp;
  wZapytaniu: number;
  wOknie: number;
  ip: string;
  ua: string;
  powod: string;
}

export function zbudujDziennikBezpieczenstwa(opcje: {
  administratorWarszawa: UczestnikDziennika;
  administratorKrakow: UczestnikDziennika;
  administratorWroclaw: UczestnikDziennika;
  administratorGdansk: UczestnikDziennika;
  agentWarszawa: UczestnikDziennika;
  agentKrakow: UczestnikDziennika;
  agentGdansk: UczestnikDziennika;
  kierownikWroclaw: UczestnikDziennika;
  asystent: UczestnikDziennika;
  teraz?: Date;
}): WpisDziennikaBezpieczenstwa[] {
  const teraz = opcje.teraz ?? new Date();
  const {
    administratorWarszawa,
    administratorKrakow,
    administratorWroclaw,
    administratorGdansk,
    agentWarszawa,
    agentKrakow,
    agentGdansk,
    kierownikWroclaw,
    asystent,
  } = opcje;
  const wpisy: WpisDziennikaBezpieczenstwa[] = [];

  const incydentyDlp: { aktor: UczestnikDziennika; incydent: IncydentDlp }[] = [
    {
      aktor: agentKrakow,
      incydent: {
        dniTemu: 322, godzina: 16, minuta: 5, modul: "properties", wZapytaniu: 40, wOknie: 63,
        ip: IP_BIURO_KRAKOW, ua: UA_PRZEGLADARKA,
        powod: "przeglądanie katalogu ofert stronami po 40 pozycji przed spotkaniem z inwestorem",
      },
    },
    {
      aktor: asystent,
      incydent: {
        dniTemu: 288, godzina: 11, minuta: 40, modul: "documents", wZapytaniu: 12, wOknie: 24,
        ip: IP_BIURO_WARSZAWA, ua: UA_PRZEGLADARKA,
        powod: "kompletowanie teczek do archiwizacji kwartalnej",
      },
    },
    {
      aktor: kierownikWroclaw,
      incydent: {
        dniTemu: 241, godzina: 9, minuta: 12, modul: "contacts", wZapytaniu: 20, wOknie: 34,
        ip: IP_BIURO_WROCLAW, ua: UA_PRZEGLADARKA,
        powod: "raport skuteczności zespołu za poprzedni miesiąc",
      },
    },
    {
      aktor: agentGdansk,
      incydent: {
        dniTemu: 205, godzina: 20, minuta: 48, modul: "enquiries", wZapytaniu: 25, wOknie: 45,
        ip: IP_DOMOWY_AGENTA, ua: UA_TELEFON,
        powod: "wieczorne nadrabianie zaległych zapytań z telefonu",
      },
    },
    {
      aktor: agentKrakow,
      incydent: {
        dniTemu: 176, godzina: 13, minuta: 27, modul: "properties", wZapytaniu: 60, wOknie: 104,
        ip: IP_OBCY, ua: UA_CURL,
        powod: "seryjne zapytania z nieznanego adresu, w tempie nieosiągalnym dla przeglądarki",
      },
    },
    {
      aktor: administratorKrakow,
      incydent: {
        dniTemu: 141, godzina: 18, minuta: 2, modul: "documents", wZapytaniu: 30, wOknie: 52,
        ip: IP_BIURO_KRAKOW, ua: UA_PRZEGLADARKA,
        powod: "próba pobrania całego archiwum umów przed audytem wewnętrznym",
      },
    },
    {
      aktor: agentGdansk,
      incydent: {
        dniTemu: 96, godzina: 10, minuta: 31, modul: "contacts", wZapytaniu: 18, wOknie: 31,
        ip: IP_BIURO_GDANSK, ua: UA_PRZEGLADARKA,
        powod: "przewijanie kartoteki w poszukiwaniu klienta bez zapisanego numeru",
      },
    },
    {
      aktor: asystent,
      incydent: {
        dniTemu: 63, godzina: 22, minuta: 14, modul: "enquiries", wZapytaniu: 45, wOknie: 83,
        ip: IP_OBCY, ua: UA_SKANER,
        powod: "nocne pobieranie listy zapytań skryptem, spoza sieci biura",
      },
    },
    {
      aktor: agentWarszawa,
      incydent: {
        dniTemu: 38, godzina: 15, minuta: 56, modul: "properties", wZapytaniu: 35, wOknie: 71,
        ip: IP_BIURO_WARSZAWA, ua: UA_PRZEGLADARKA,
        powod: "porównywanie cen ofert z sąsiednich dzielnic",
      },
    },
  ];

  for (const { aktor, incydent } of incydentyDlp) {
    const prog = PROGI_DLP[incydent.modul];
    const zablokowany = incydent.wOknie >= prog.blokada;
    const poziom = zablokowany ? "HIGH" : "MEDIUM";
    const kiedy = oDniTemu(teraz, incydent.dniTemu, incydent.godzina, incydent.minuta);
    const ile = (n: number) => `${n} ${poLiczebniku(n, prog.mnoga, prog.dopelniacz)}`;

    wpisy.push(
      wpis(
        { aktor, ip: incydent.ip, ua: incydent.ua, kiedy },
        {
          type: incydent.modul === "contacts" ? "CONTACT_DATA_EXPORTED" : "SYSTEM_NOTE",
          category: prog.kategoria,
          messageKey: incydent.modul === "contacts" ? "log.contact.dataExported" : "log.system.dlpExport",
          messageParams: {
            dataType: incydent.modul,
            count: incydent.wZapytaniu,
            windowCount: incydent.wOknie,
            threshold: prog.ostrzezenie,
            blockThreshold: prog.blokada,
            blocked: zablokowany,
            severity: poziom,
          },
          fallbackText: zablokowany
            ? `Masowe pobranie danych: ${ile(incydent.wZapytaniu)} w jednym zapytaniu, łącznie ${ile(incydent.wOknie)} ` +
              `w oknie 5 minut — odpowiedź ZABLOKOWANA przez kontrolę DLP (próg blokady ${prog.blokada}). ` +
              `Konto ${aktor.email}, adres ${incydent.ip}; ${incydent.powod}`
            : `Masowe pobranie danych: ${ile(incydent.wZapytaniu)} w jednym zapytaniu, łącznie ${ile(incydent.wOknie)} ` +
              `w oknie 5 minut (próg ostrzegawczy ${prog.ostrzezenie}). ` +
              `Konto ${aktor.email}, adres ${incydent.ip}; ${incydent.powod}`,
          celUzytkownik: aktor,
          companyId: aktor.companyId,
        },
      ),
    );

    if (zablokowany) {
      wpisy.push(
        wpis(
          { aktor, ip: incydent.ip, ua: incydent.ua, kiedy: new Date(kiedy.getTime() + 60_000) },
          {
            type: "SYSTEM_NOTE",
            category: "SYSTEM",
            messageKey: "log.system.dlpBlock",
            messageParams: {
              dataType: incydent.modul,
              recordCount: incydent.wOknie,
              threshold: prog.blokada,
              severity: "HIGH",
            },
            fallbackText:
              `Kontrola DLP zablokowała odpowiedź: ${ile(incydent.wOknie)} pobrane w ciągu 5 minut ` +
              `z adresu ${incydent.ip} (próg blokady ${prog.blokada}) — konto ${aktor.email}`,
            celUzytkownik: aktor,
            companyId: aktor.companyId,
          },
        ),
      );
    }
  }

  const pulapkiHistoryczne: { dniTemu: number; godzina: number; minuta: number; endpoint: string; metoda: string; ip: string; ua: string }[] = [
    { dniTemu: 297, godzina: 2,  minuta: 18, endpoint: "/api/backup",        metoda: "GET",  ip: IP_SKANERA_AZJA, ua: UA_SKANER },
    { dniTemu: 297, godzina: 2,  minuta: 19, endpoint: "/api/users/dump",    metoda: "GET",  ip: IP_SKANERA_AZJA, ua: UA_SKANER },
    { dniTemu: 198, godzina: 23, minuta: 51, endpoint: "/api/admin/export",  metoda: "POST", ip: IP_SKANERA_TOR,  ua: UA_CURL   },
    { dniTemu: 112, godzina: 4,  minuta: 6,  endpoint: "/api/users/dump",    metoda: "GET",  ip: IP_SKANERA_TOR,  ua: UA_SKANER },
    { dniTemu: 54,  godzina: 1,  minuta: 33, endpoint: "/api/backup",        metoda: "GET",  ip: IP_SKANERA,      ua: UA_CURL   },
  ];
  for (const p of pulapkiHistoryczne) {
    wpisy.push(
      wpis(
        { aktor: null, ip: p.ip, ua: p.ua, kiedy: oDniTemu(teraz, p.dniTemu, p.godzina, p.minuta) },
        {
          type: "SYSTEM_NOTE",
          category: "SYSTEM",
          messageKey: "log.system.honeypot",
          messageParams: { endpoint: p.endpoint, method: p.metoda, ip: p.ip, severity: "CRITICAL" },
          fallbackText: `Pułapka bezpieczeństwa: ${p.metoda} ${p.endpoint} z adresu ${p.ip} (${p.ua}) — odpowiedziano fałszywym 404`,
          companyId: null,
        },
      ),
    );
  }

  const epizodyLogowania: {
    cel: UczestnikDziennika;
    dniTemu: number;
    godzina: number;
    minuta: number;
    proby: number;
    punkty: number;
    poziom: "MEDIUM" | "HIGH";
    ip: string;
    ipPoprawnego: string;
    uaPoprawnego: string;
    powody: string[];
    metodaPotwierdzenia: string;
    poMinutach: number;
    opisPotwierdzenia: string;
  }[] = [
    {
      cel: agentKrakow,
      dniTemu: 251, godzina: 12, minuta: 3, proby: 3, punkty: 55, poziom: "MEDIUM",
      ip: IP_SKANERA_AZJA, ipPoprawnego: IP_BIURO_KRAKOW, uaPoprawnego: UA_PRZEGLADARKA,
      powody: ["Nietypowa pora logowania", "3 nieudane próby w ostatnich 10 min"],
      metodaPotwierdzenia: "password",
      poMinutach: 16,
      opisPotwierdzenia: "kilkanaście minut po serii nieudanych prób, z komputera w biurze",
    },
    {
      cel: administratorGdansk,
      dniTemu: 118, godzina: 3, minuta: 41, proby: 4, punkty: 78, poziom: "HIGH",
      ip: IP_SKANERA_TOR, ipPoprawnego: IP_BIURO_GDANSK, uaPoprawnego: UA_PRZEGLADARKA,
      powody: ["Adres z sieci anonimizującej", "Logowanie poza godzinami pracy", "4 nieudane próby w ostatnich 12 min"],
      metodaPotwierdzenia: "email_otp",
      poMinutach: 305,
      opisPotwierdzenia: "tożsamość potwierdzona kodem z poczty dopiero rano, z komputera w biurze",
    },
    {
      cel: asystent,
      dniTemu: 3, godzina: 22, minuta: 58, proby: 5, punkty: 85, poziom: "HIGH",
      ip: IP_OBCY, ipPoprawnego: IP_DOMOWY_AGENTA, uaPoprawnego: UA_TELEFON,
      powody: ["Nowy adres IP", "5 nieudanych prób logowania w ostatnich 15 min"],
      metodaPotwierdzenia: "email_otp",
      poMinutach: 28,
      opisPotwierdzenia: "tożsamość potwierdzona kodem z poczty, adres znany z wcześniejszych logowań",
    },
  ];

  for (const e of epizodyLogowania) {
    for (let i = 0; i < e.proby; i++) {
      wpisy.push(
        wpis(
          { aktor: e.cel, ip: e.ip, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, e.dniTemu, e.godzina, e.minuta + i) },
          {
            type: "AUTH_LOGIN_FAILED",
            category: "AUTH",
            messageKey: "auth.loginFailed",
            messageParams: { email: e.cel.email, reason: "bad_password", attempt: i + 1, ip: e.ip },
            fallbackText: `Nieudane logowanie na konto ${e.cel.email} z adresu ${e.ip} (próba ${i + 1} z ${e.proby})`,
            celUzytkownik: e.cel,
          },
        ),
      );
    }
    wpisy.push(
      wpis(
        { aktor: e.cel, ip: e.ip, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, e.dniTemu, e.godzina, e.minuta + e.proby + 1) },
        {
          type: "SYSTEM_NOTE",
          category: "AUTH",
          messageKey: "log.system.riskAssessment",
          messageParams: {
            email: e.cel.email,
            ip: e.ip,
            score: e.punkty,
            level: e.poziom,
            factors: e.powody,
            stepUpRequired: true,
          },
          fallbackText:
            `Ocena ryzyka logowania: ${e.punkty} pkt (${e.poziom}) dla ${e.cel.email} — ` +
            `${e.powody.join(", ").toLowerCase()}; wymuszono dodatkowe potwierdzenie tożsamości`,
          celUzytkownik: e.cel,
        },
      ),
    );
    wpisy.push(
      wpis(
        {
          aktor: e.cel,
          ip: e.ipPoprawnego,
          ua: e.uaPoprawnego,
          kiedy: oDniTemu(teraz, e.dniTemu, e.godzina, e.minuta + e.poMinutach),
        },
        {
          type: "AUTH_LOGIN",
          category: "AUTH",
          messageKey: "auth.login",
          messageParams: { email: e.cel.email, method: e.metodaPotwierdzenia, ip: e.ipPoprawnego },
          fallbackText: `Poprawne logowanie na konto ${e.cel.email} z adresu ${e.ipPoprawnego} — ${e.opisPotwierdzenia}`,
          celUzytkownik: e.cel,
        },
      ),
    );
  }

  for (const sekret of SEKRETY) {
    const konto =
      sekret.email === administratorWroclaw.email
        ? administratorWroclaw
        : sekret.email === administratorGdansk.email
          ? administratorGdansk
          : null;
    if (!konto) continue;
    wpisy.push(
      wpis(
        {
          aktor: konto,
          ip: konto === administratorWroclaw ? IP_BIURO_WROCLAW : IP_BIURO_GDANSK,
          ua: UA_PRZEGLADARKA,
          kiedy: oDniTemu(teraz, sekret.wlaczoneDniTemu, sekret.godzina, sekret.minuta),
        },
        {
          type: "AUTH_2FA_ENABLED",
          category: "AUTH",
          messageKey: "auth.2faEnabled",
          messageParams: { email: konto.email, method: "totp", backupCodes: sekret.kodyZapasowe.length },
          fallbackText:
            `Włączono logowanie dwuskładnikowe (TOTP) na koncie ${konto.email} — ` +
            `pobrano ${sekret.kodyZapasowe.length} kodów zapasowych`,
          celUzytkownik: konto,
        },
      ),
    );
  }

  wpisy.push(
    wpis(
      { aktor: administratorGdansk, ip: IP_BIURO_GDANSK, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, 5, 8, 47) },
      {
        type: "AUTH_LOGIN",
        category: "AUTH",
        messageKey: "auth.login",
        messageParams: { email: administratorGdansk.email, method: "2fa_backup" },
        fallbackText: `Logowanie kodem zapasowym na koncie ${administratorGdansk.email} — telefon z aplikacją uwierzytelniającą był niedostępny`,
        celUzytkownik: administratorGdansk,
      },
    ),
  );

  const pulapki: { endpoint: string; metoda: string; minuta: number; ua: string; ip: string }[] = [
    { endpoint: "/api/users/dump", metoda: "GET", minuta: 41, ua: UA_SKANER, ip: IP_SKANERA },
    { endpoint: "/api/backup", metoda: "GET", minuta: 41, ua: UA_SKANER, ip: IP_SKANERA },
    { endpoint: "/api/admin/export", metoda: "POST", minuta: 43, ua: UA_CURL, ip: IP_SKANERA },
  ];
  for (const p of pulapki) {
    wpisy.push(
      wpis(
        { aktor: null, ip: p.ip, ua: p.ua, kiedy: oDniTemu(teraz, 4, 3, p.minuta) },
        {
          type: "SYSTEM_NOTE",
          category: "SYSTEM",
          messageKey: "log.system.honeypot",
          messageParams: { endpoint: p.endpoint, method: p.metoda, ip: p.ip, severity: "CRITICAL" },
          fallbackText: `Pułapka bezpieczeństwa: ${p.metoda} ${p.endpoint} z adresu ${p.ip} (${p.ua}) — odpowiedziano fałszywym 404`,
          companyId: null,
        },
      ),
    );
  }

  wpisy.push(
    wpis(
      { aktor: administratorWroclaw, ip: IP_BIURO_WROCLAW, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, 2, 3, 11) },
      {
        type: "AUTH_2FA_FAILED",
        category: "AUTH",
        messageKey: "auth.2faFailed",
        messageParams: { email: administratorWroclaw.email, reason: "bad_totp_code" },
        fallbackText: `Odrzucony kod TOTP przy logowaniu ${administratorWroclaw.email} — kod wygasł`,
        celUzytkownik: administratorWroclaw,
      },
    ),
  );
  wpisy.push(
    wpis(
      { aktor: administratorWroclaw, ip: IP_BIURO_WROCLAW, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, 2, 3, 12) },
      {
        type: "AUTH_LOGIN",
        category: "AUTH",
        messageKey: "auth.login",
        messageParams: { email: administratorWroclaw.email, method: "2fa_totp" },
        fallbackText: `Logowanie drugim składnikiem (TOTP) o 03:12 na koncie ${administratorWroclaw.email} — poza godzinami pracy`,
        celUzytkownik: administratorWroclaw,
      },
    ),
  );

  wpisy.push(
    wpis(
      { aktor: administratorGdansk, ip: IP_BIURO_GDANSK, ua: UA_TELEFON, kiedy: oDniTemu(teraz, 2, 19, 2) },
      {
        type: "AUTH_2FA_FAILED",
        category: "AUTH",
        messageKey: "auth.2faFailed",
        messageParams: { email: administratorGdansk.email, reason: "bad_totp_code" },
        fallbackText: `Odrzucony kod TOTP przy logowaniu ${administratorGdansk.email} — rozjechany zegar telefonu`,
        celUzytkownik: administratorGdansk,
      },
    ),
  );
  wpisy.push(
    wpis(
      { aktor: administratorGdansk, ip: IP_BIURO_GDANSK, ua: UA_TELEFON, kiedy: oDniTemu(teraz, 2, 19, 3) },
      {
        type: "AUTH_LOGIN",
        category: "AUTH",
        messageKey: "auth.login",
        messageParams: { email: administratorGdansk.email, method: "2fa_backup" },
        fallbackText: `Logowanie drugim kodem zapasowym na koncie ${administratorGdansk.email} (pozostało 6 z 8)`,
        celUzytkownik: administratorGdansk,
      },
    ),
  );

  const eksporty: { minuta: number; liczba: number; laczne: number; zablokowany: boolean }[] = [
    { minuta: 22, liczba: 30, laczne: 30, zablokowany: false },
    { minuta: 24, liczba: 28, laczne: 58, zablokowany: false },
    { minuta: 26, liczba: 16, laczne: 74, zablokowany: true },
  ];
  for (const e of eksporty) {
    wpisy.push(
      wpis(
        { aktor: agentWarszawa, ip: IP_DOMOWY_AGENTA, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, 1, 14, e.minuta) },
        {
          type: "CONTACT_DATA_EXPORTED",
          category: "CONTACT",
          messageKey: "log.contact.dataExported",
          messageParams: {
            count: e.liczba,
            windowCount: e.laczne,
            dataType: "contacts",
            threshold: PROGI_DLP.contacts.ostrzezenie,
            blockThreshold: PROGI_DLP.contacts.blokada,
            blocked: e.zablokowany,
            severity: e.zablokowany ? "HIGH" : "MEDIUM",
          },
          fallbackText: e.zablokowany
            ? `Eksport ${e.liczba} kontaktów, łącznie ${e.laczne} ${formaRekordow(e.laczne)} w 5 minut — odpowiedź ZABLOKOWANA przez kontrolę DLP (próg blokady 50). Konto ${agentWarszawa.email}`
            : `Eksport ${e.liczba} kontaktów, łącznie ${e.laczne} ${formaRekordow(e.laczne)} w oknie 5 minut (próg ostrzegawczy 30). Konto ${agentWarszawa.email}`,
          companyId: agentWarszawa.companyId,
        },
      ),
    );
  }
  wpisy.push(
    wpis(
      { aktor: agentWarszawa, ip: IP_DOMOWY_AGENTA, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, 1, 14, 27) },
      {
        type: "SYSTEM_NOTE",
        category: "SYSTEM",
        messageKey: "log.system.dlpBlock",
        messageParams: { dataType: "contacts", recordCount: 74, threshold: 50, severity: "HIGH" },
        fallbackText: `Kontrola DLP zablokowała odpowiedź: 74 unikalne kontakty pobrane w ciągu 5 minut z adresu ${IP_DOMOWY_AGENTA} (próg blokady 50)`,
        celUzytkownik: agentWarszawa,
        companyId: agentWarszawa.companyId,
      },
    ),
  );

  wpisy.push(
    wpis(
      { aktor: null, ip: IP_SKANERA, ua: UA_SKANER, kiedy: oMinutTemu(teraz, 47) },
      {
        type: "SYSTEM_NOTE",
        category: "SYSTEM",
        messageKey: "log.system.honeypot",
        messageParams: { endpoint: "/api/users/dump", method: "GET", ip: IP_SKANERA, severity: "CRITICAL" },
        fallbackText: `Pułapka bezpieczeństwa: GET /api/users/dump z adresu ${IP_SKANERA} (${UA_SKANER}) — odpowiedziano fałszywym 404`,
        companyId: null,
      },
    ),
  );

  wpisy.push(
    wpis(
      { aktor: administratorWarszawa, ip: IP_BIURO_WARSZAWA, ua: UA_PRZEGLADARKA, kiedy: oDniTemu(teraz, 1, 16, 10) },
      {
        type: "SYSTEM_NOTE",
        category: "SYSTEM",
        messageKey: "log.system.dlpReviewed",
        messageParams: { dataType: "contacts", recordCount: 74, outcome: "wyjaśnione", severity: "LOW" },
        fallbackText:
          `Przegląd blokady DLP z godziny 14:27 — pobranie 74 kontaktów okazało się przygotowaniem listy ` +
          `do kampanii mailowej. Konto ${agentWarszawa.email} pozostaje aktywne, progi bez zmian`,
        celUzytkownik: agentWarszawa,
        companyId: administratorWarszawa.companyId,
      },
    ),
  );

  return wpisy.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
