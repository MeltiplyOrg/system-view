/**
 * Provider database cabinet tests. They pin four genuinely different chassis
 * definitions, provider-specific heights, and the one-logo contract per skin.
 */
import { describe, expect, test } from "vite-plus/test";
import type { PlacedInstance } from "../src/design";
import {
  createProviderDatabaseDefinitions,
  createProviderDatabaseRack,
  databaseProviderHeight,
} from "../src/database-skins";
import { findProvider, providersFor } from "../src/providers";

/** Minimal placed database instance; each skin supplies the provider. */
const placed: PlacedInstance = {
  id: "db-skin",
  type: "database-rack",
  label: "Database Skin",
  position: { x: 0, y: 0, z: 0 },
  color: "#4169e1",
};

/** Providers that have a designed cabinet, in catalogue order. */
const providers = providersFor("database-rack");

describe("provider database skins", () => {
  test("renders four distinct chassis definitions", () => {
    const defs = createProviderDatabaseDefinitions();
    expect(defs.querySelector("#db-name-clip")).not.toBeNull();
    const rears = providers.map(
      (provider) => defs.querySelector(`#db-${provider.id}-rear`)?.innerHTML,
    );
    const fronts = providers.map(
      (provider) => defs.querySelector(`#db-${provider.id}-front`)?.innerHTML,
    );
    expect(rears.every(Boolean)).toBe(true);
    expect(fronts.every(Boolean)).toBe(true);
    expect(new Set(rears).size).toBe(providers.length);
    expect(new Set(fronts).size).toBe(providers.length);

    // Signature geometry, not just accents, must survive into each cabinet.
    expect(rears[0]).toContain("db-pg-rail");
    expect(rears[1]).toContain("db-mysql-fin");
    expect(rears[2]).toContain("db-sqlite-card");
    expect(rears[3]).toContain("db-mongo-blade");
  });

  test("publishes a provider-specific height for each cabinet", () => {
    expect(
      providers.map((provider) => databaseProviderHeight(provider.id)),
    ).toEqual([240, 205, 180, 182]);
    expect(databaseProviderHeight(undefined)).toBeNull();
    expect(databaseProviderHeight("redis")).toBeNull();
    expect(databaseProviderHeight("unknown")).toBeNull();
  });

  test("renders one contract-complete rack with exactly one mark", () => {
    for (const provider of providers) {
      const theme = findProvider(provider.id, "database-rack")!;
      const rack = createProviderDatabaseRack(
        { ...placed, provider: provider.id, color: theme.color },
        theme,
      )!;
      expect(rack.classList.contains("database-rack")).toBe(true);
      expect(rack.dataset.rendererType).toBe("database-rack");
      expect(rack.dataset.rendererProvider).toBe(provider.id);
      expect(rack.querySelectorAll(".component-static-base")).toHaveLength(1);
      expect(rack.querySelectorAll(".component-motion")).toHaveLength(1);
      expect(rack.querySelectorAll(".component-static-overlay")).toHaveLength(
        1,
      );
      expect(
        rack.querySelector(".component-static-base use")?.getAttribute("href"),
      ).toBe(`#db-${provider.id}-rear`);
      expect(
        rack
          .querySelector(".component-static-overlay use")
          ?.getAttribute("href"),
      ).toBe(`#db-${provider.id}-front`);
      expect(rack.querySelectorAll(".rack-provider-badge")).toHaveLength(1);
      expect(rack.querySelectorAll(".rack-provider-badge svg")).toHaveLength(1);
      expect(rack.querySelectorAll("svg")).toHaveLength(1);
      expect(rack.querySelector(".instance-label")?.textContent).toBe(
        "Database Skin",
      );
    }
  });

  test("returns null for a provider without a cabinet", () => {
    const redis = findProvider("redis", "cache")!;
    expect(createProviderDatabaseRack(placed, redis)).toBeNull();
  });

  test("keeps the product mark when a theme uses the shared enamel plate", () => {
    const { plate: _plate, ...theme } = findProvider(
      "postgresql",
      "database-rack",
    )!;
    const rack = createProviderDatabaseRack(placed, theme)!;
    expect(rack.querySelectorAll(".rack-provider-badge svg")).toHaveLength(1);
    expect(rack.getAttribute("aria-label")).toContain("PostgreSQL");
    expect(rack.querySelector(".instance-label")?.textContent).toBe(
      placed.label,
    );
  });
});
