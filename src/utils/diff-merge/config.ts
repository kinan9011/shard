/** Bounds the diff so a huge or minified input stays responsive. Leaf module: no imports, so no cycles. */
export const DIFF_CONFIG = { scanLimit: 500, timeout: 1000 } as const;
