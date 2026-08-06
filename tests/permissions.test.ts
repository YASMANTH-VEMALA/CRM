import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isOverridable,
  isPermission,
  isRole,
  NON_OVERRIDABLE_PERMISSIONS,
  PERMISSIONS,
  resolvePermissions,
} from "@/lib/permissions";

// Mirrors the role_permissions rows seeded by migration 0006.
const SALES_USER_DEFAULTS = ["view_products", "view_inventory", "create_sales", "apply_discount"];
const ENTITY_ADMIN_DEFAULTS = [
  "view_products",
  "create_products",
  "edit_products",
  "view_inventory",
  "view_purchase_cost",
  "view_profit",
  "view_management_reports",
  "manage_users",
];

/**
 * CRIT-2 regression: master-tier permissions are role-only. The database
 * refuses to store them as overrides (migration 0012) and has_perm ignores
 * them if one were ever present (migration 0011); resolvePermissions is the
 * app-side half of that guard and must behave identically.
 */
describe("master-tier permissions are never overridable", () => {
  test("the non-overridable list is exactly the master-tier permissions", () => {
    assert.deepEqual(
      [...NON_OVERRIDABLE_PERMISSIONS].sort(),
      ["access_multiple_entities", "manage_entities", "manage_users"]
    );
  });

  test("isOverridable agrees with the list", () => {
    for (const permission of PERMISSIONS) {
      const expected = !(NON_OVERRIDABLE_PERMISSIONS as readonly string[]).includes(permission);
      assert.equal(isOverridable(permission), expected, permission);
    }
  });

  test("an override cannot grant a master-tier permission", () => {
    for (const permission of NON_OVERRIDABLE_PERMISSIONS) {
      const resolved = resolvePermissions(SALES_USER_DEFAULTS, { [permission]: true });
      assert.ok(
        !resolved.includes(permission),
        `${permission} must not be grantable through an override`
      );
    }
  });

  test("an override cannot revoke a master-tier permission either", () => {
    const resolved = resolvePermissions(ENTITY_ADMIN_DEFAULTS, { manage_users: false });
    assert.ok(
      resolved.includes("manage_users"),
      "master-tier permissions follow the role template in both directions"
    );
  });

  test("a stale master-tier override does not widen access", () => {
    const resolved = resolvePermissions(SALES_USER_DEFAULTS, {
      manage_entities: true,
      access_multiple_entities: true,
      manage_users: true,
      view_profit: true,
    });
    assert.deepEqual(
      [...resolved].sort(),
      [...SALES_USER_DEFAULTS, "view_profit"].sort(),
      "only the overridable permission takes effect"
    );
  });
});

describe("resolvePermissions", () => {
  test("a role with no overrides gets exactly its template defaults", () => {
    const resolved = resolvePermissions(SALES_USER_DEFAULTS, {});
    assert.deepEqual([...resolved].sort(), [...SALES_USER_DEFAULTS].sort());
  });

  test("sales users do not receive purchase cost, profit or reports by default", () => {
    const resolved = resolvePermissions(SALES_USER_DEFAULTS, null);
    assert.ok(!resolved.includes("view_purchase_cost"));
    assert.ok(!resolved.includes("view_profit"));
    assert.ok(!resolved.includes("view_management_reports"));
    assert.ok(!resolved.includes("access_multiple_entities"));
  });

  test("an override of true grants a permission the role template lacks", () => {
    const resolved = resolvePermissions(SALES_USER_DEFAULTS, { view_purchase_cost: true });
    assert.ok(resolved.includes("view_purchase_cost"));
  });

  test("an override of false revokes a permission the role template grants", () => {
    const resolved = resolvePermissions(ENTITY_ADMIN_DEFAULTS, { view_profit: false });
    assert.ok(!resolved.includes("view_profit"));
    assert.ok(resolved.includes("view_purchase_cost"), "unrelated permissions stay intact");
  });

  test("unknown override keys are ignored rather than trusted", () => {
    const resolved = resolvePermissions(SALES_USER_DEFAULTS, {
      not_a_real_permission: true,
      "*": true,
    });
    assert.deepEqual([...resolved].sort(), [...SALES_USER_DEFAULTS].sort());
  });

  test("non-boolean override values neither grant nor revoke", () => {
    const resolved = resolvePermissions(SALES_USER_DEFAULTS, {
      view_purchase_cost: "yes",
      create_sales: 0,
    });
    assert.ok(!resolved.includes("view_purchase_cost"), "a truthy string does not grant");
    assert.ok(resolved.includes("create_sales"), "a falsy non-false value does not revoke");
  });

  test("unknown role defaults from the database are filtered out", () => {
    const resolved = resolvePermissions(["view_products", "legacy_permission"], {});
    assert.deepEqual(resolved, ["view_products"]);
  });

  test("resolution never produces duplicates", () => {
    const resolved = resolvePermissions(["view_products", "view_products"], { view_products: true });
    assert.equal(resolved.filter((p) => p === "view_products").length, 1);
  });
});

describe("permission and role vocabulary", () => {
  test("every permission required by Phase 1 exists", () => {
    const required = [
      "view_products",
      "create_products",
      "edit_products",
      "import_products",
      "view_inventory",
      "adjust_inventory",
      "create_stock_inward",
      "view_purchase_cost",
      "manage_suppliers",
      "create_sales",
      "apply_discount",
      "view_profit",
      "view_management_reports",
      "manage_users",
      "access_multiple_entities",
      "generate_exports",
    ];
    for (const permission of required) {
      assert.ok(isPermission(permission), `${permission} should be a known permission`);
    }
  });

  test("the four role templates are recognised and nothing else is", () => {
    for (const role of ["master_admin", "entity_admin", "inventory_user", "sales_user"]) {
      assert.ok(isRole(role));
    }
    assert.ok(!isRole("administrator"), "the pre-ERP role name is no longer valid");
    assert.ok(!isRole("superuser"));
  });

  test("the permission list has no duplicates", () => {
    assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  });
});
