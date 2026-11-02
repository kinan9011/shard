// @peculiar/x509 reads decorator metadata through Reflect, which the test runtime does not have.
// Only tests use the library now (to make certificates to verify against), so the stand-in lives here.
type Reflected = typeof Reflect & Record<string, unknown>;

function installReflectMetadata() {
  const reflect = Reflect as Reflected;
  if (typeof reflect.getMetadata === "function") return;
  const store = new WeakMap<object, Map<unknown, unknown>>();
  const own = (target: object, create: boolean) => {
    let map = store.get(target);
    if (!map && create) store.set(target, (map = new Map()));
    return map;
  };
  reflect.defineMetadata = (key: unknown, value: unknown, target: object) => void own(target, true)?.set(key, value);
  reflect.getOwnMetadata = (key: unknown, target: object) => own(target, false)?.get(key);
  reflect.getMetadata = (key: unknown, target: object) => {
    for (let item: object | null = target; item; item = Object.getPrototypeOf(item)) {
      const map = own(item, false);
      if (map?.has(key)) return map.get(key);
    }
    return undefined;
  };
  reflect.metadata = (key: unknown, value: unknown) => (target: object) => void own(target, true)?.set(key, value);
}

export async function loadX509() {
  installReflectMetadata();
  const x509 = await import("@peculiar/x509");
  x509.cryptoProvider.set(globalThis.crypto);
  return x509;
}
