/**
 * Provider registry tests. They pin the database provider catalogue, the
 * type gate, and the self-contained exact marks consumed by the tooltip and
 * the printed database badge.
 */
import { describe, expect, test } from "vite-plus/test";
import { findProvider, providersFor, PROVIDERS } from "../src/providers";

describe("database providers", () => {
  test("registers one skin per database product", () => {
    expect(providersFor("database-rack").map(({ id }) => id)).toEqual([
      "postgresql",
      "mysql",
      "sqlite",
      "mongodb",
    ]);
    expect(providersFor("database-rack").map(({ label }) => label)).toEqual([
      "PostgreSQL",
      "MySQL",
      "SQLite",
      "MongoDB",
    ]);
  });

  test("gates each provider to database racks", () => {
    for (const provider of providersFor("database-rack")) {
      expect(findProvider(provider.id, "database-rack")).toBe(provider);
      expect(findProvider(provider.id, "cache")).toBeNull();
    }
    expect(findProvider("redis", "database-rack")).toBeNull();
    expect(findProvider("POSTGRESQL", "database-rack")?.id).toBe("postgresql");
  });

  test("uses dark enamel plates instead of a white backing", () => {
    for (const [id, plate] of [
      ["postgresql", "#14243a"],
      ["mysql", "#0b1a1e"],
      ["sqlite", "#101c24"],
      ["mongodb", "#0b1a12"],
    ] as const)
      expect(findProvider(id, "database-rack")?.plate).toBe(plate);
  });

  test("ships unique hex accents and one self-contained mark each", () => {
    const databaseProviders = providersFor("database-rack");
    expect(new Set(databaseProviders.map(({ color }) => color)).size).toBe(
      databaseProviders.length,
    );
    for (const provider of databaseProviders) {
      expect(provider.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(provider.logo.match(/<svg\b/g)).toHaveLength(1);
      expect(provider.logo).toContain("</svg>");
      expect(provider.logo).toMatch(/viewBox="[^"]+"/);
    }
  });

  test("keeps the full catalogue free of duplicate ids", () => {
    expect(new Set(PROVIDERS.map(({ id }) => id)).size).toBe(PROVIDERS.length);
  });
});
