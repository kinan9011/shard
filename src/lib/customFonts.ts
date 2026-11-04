import { BUILT_IN_FONTS, sanitizeFamily } from "@/utils/fonts";

/** Fonts the user added as files. They live in IndexedDB, so they work offline and in the browser preview alike. */
export const FONT_DB = "shard-fonts";
const STORE = "fonts";
export const MAX_FONT_BYTES = 10 * 1024 * 1024;
const EXTENSION = /\.(ttf|otf|woff2?)$/i;

interface StoredFont {
  family: string;
  data: ArrayBuffer;
}

const faces = new Map<string, FontFace>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FONT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "family" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function register(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data);
  await face.load();
  const old = faces.get(family);
  if (old) document.fonts.delete(old);
  document.fonts.add(face);
  faces.set(family, face);
}

export async function listFonts(): Promise<string[]> {
  const keys = await run("readonly", (store) => store.getAllKeys());
  return keys.map(String).sort((a, b) => a.localeCompare(b));
}

/** Registers every stored font with the page. Call once at start. A font that fails to load is skipped. */
export async function loadCustomFonts(): Promise<string[]> {
  if (typeof indexedDB === "undefined" || typeof FontFace === "undefined") return [];
  const stored = (await run("readonly", (store) => store.getAll())) as StoredFont[];
  const loaded: string[] = [];
  for (const font of stored) {
    try {
      await register(font.family, font.data);
      loaded.push(font.family);
    } catch (error) {
      console.error(`Failed to load font ${font.family}:`, error);
    }
  }
  return loaded.sort((a, b) => a.localeCompare(b));
}

/** Stores a font file and makes it available. Resolves to its family name, rejects with a message for the user. */
export async function addFontFile(file: File): Promise<string> {
  if (!EXTENSION.test(file.name)) throw new Error("Choose a .ttf, .otf, .woff or .woff2 file.");
  if (file.size > MAX_FONT_BYTES) throw new Error("This font file is larger than 10 MB.");
  const base = sanitizeFamily(file.name.replace(EXTENSION, "").replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").slice(0, 60)) ?? "Custom font";
  const taken = new Set([...(await listFonts()), ...BUILT_IN_FONTS.map((font) => font.family)]);
  let family = base;
  for (let n = 2; taken.has(family); n++) family = `${base} ${n}`;
  const data = await file.arrayBuffer();
  try {
    await register(family, data);
  } catch {
    throw new Error("This file is not a font the app can read.");
  }
  await run("readwrite", (store) => store.put({ family, data } satisfies StoredFont));
  return family;
}

export async function removeFont(family: string): Promise<void> {
  await run("readwrite", (store) => store.delete(family));
  const face = faces.get(family);
  if (face) document.fonts.delete(face);
  faces.delete(family);
}
