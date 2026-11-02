import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PINNED, PINNED_STORAGE_KEY, loadPinned, moveId } from "@/app/pinned";

describe("loadPinned", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadPinned(localStorage)).toEqual([]);
  });

  it("migrates shard-favorites to shard-pinned once", () => {
    localStorage.setItem("shard-favorites", JSON.stringify(["a", "b", "a", 3]));
    expect(loadPinned(localStorage)).toEqual(["a", "b"]);
    expect(JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY)!)).toEqual(["a", "b"]);
    expect(localStorage.getItem("shard-favorites")).toBeNull();
    expect(loadPinned(localStorage)).toEqual(["a", "b"]);
  });

  it("prefers shard-pinned over old favorites", () => {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(["x"]));
    localStorage.setItem("shard-favorites", JSON.stringify(["a"]));
    expect(loadPinned(localStorage)).toEqual(["x"]);
  });

  it("falls back to the old favorites when shard-pinned is damaged", () => {
    localStorage.setItem(PINNED_STORAGE_KEY, "{not json");
    localStorage.setItem("shard-favorites", JSON.stringify(["a"]));
    expect(loadPinned(localStorage)).toEqual(["a"]);
    expect(JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY)!)).toEqual(["a"]);
  });

  it("caps the list at 12 and ignores garbage", () => {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(Array.from({ length: 20 }, (_, i) => `t${i}`)));
    expect(loadPinned(localStorage)).toHaveLength(MAX_PINNED);
    localStorage.setItem(PINNED_STORAGE_KEY, "{not json");
    expect(loadPinned(localStorage)).toEqual([]);
    expect(loadPinned(undefined)).toEqual([]);
  });
});

describe("moveId", () => {
  it("puts the id in the target's slot", () => {
    expect(moveId(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveId(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same list for unknown ids or itself", () => {
    const list = ["a", "b"];
    expect(moveId(list, "a", "a")).toBe(list);
    expect(moveId(list, "z", "a")).toBe(list);
  });
});
