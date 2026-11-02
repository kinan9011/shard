import { describe, expect, it } from "vitest";
import { detectLanguageName, isProbablyBinary, languageForFile, languageLabel } from "@/utils/diff-merge/language";

describe("diff-merge language", () => {
  it("finds a language by file name", () => {
    expect(languageForFile("check_invoices.py")?.name).toBe("Python");
    expect(languageForFile("notes")).toBeNull();
  });

  it("detects a language from content", () => {
    expect(detectLanguageName('{"a": 1}')).toBe("JSON");
    expect(detectLanguageName("#!/usr/bin/env bash\necho")).toBe("Shell");
    expect(detectLanguageName("<?php echo 1;")).toBe("PHP");
    expect(detectLanguageName("import pandas as pd\ndef f():\n  pass")).toBe("Python");
    expect(detectLanguageName("package main\nfunc main() {}")).toBe("Go");
    expect(detectLanguageName("hello world")).toBeNull();
  });

  it("falls back to Plain text", () => expect(languageLabel(null)).toBe("Plain text"));

  it("flags binary bytes", () => {
    expect(isProbablyBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true);
    expect(isProbablyBinary(new TextEncoder().encode("plain ü text"))).toBe(false);
  });

  it("only scans the first 8,000 bytes for a NUL", () => {
    const bytes = new Uint8Array(9000).fill(65);
    bytes[8500] = 0;
    expect(isProbablyBinary(bytes)).toBe(false);
  });
});

describe("diff-merge language sniffing edge cases", () => {
  it("does not call ES-module imports Python", () => {
    expect(detectLanguageName("import React from 'react'\nexport default 1")).toBeNull();
  });
  it("only treats real shells as Shell", () => {
    expect(detectLanguageName("#!/usr/bin/env pwsh\nWrite-Host")).toBeNull();
    expect(detectLanguageName("#!/bin/sh\necho")).toBe("Shell");
  });
});
