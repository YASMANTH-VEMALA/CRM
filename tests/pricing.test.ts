import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateSellPrice, effectiveMarginPercent, reorderQuantity } from "@/lib/pricing";

describe("calculateSellPrice", () => {
  test("FIXED uses the configured selling price and ignores cost and margin", () => {
    assert.equal(calculateSellPrice("fixed", 2500, 40, 5000), 5000);
    assert.equal(calculateSellPrice("fixed", 9999, 999, 5000), 5000);
  });

  test("COST_PLUS_MARGIN adds the margin percentage to the purchase cost", () => {
    assert.equal(calculateSellPrice("cost_plus_margin", 2500, 40, 0), 3500);
    assert.equal(calculateSellPrice("cost_plus_margin", 1000, 100, 0), 2000);
    assert.equal(calculateSellPrice("cost_plus_margin", 7200, 0, 0), 7200);
  });

  test("COST_PLUS_MARGIN rounds to whole currency units", () => {
    assert.equal(calculateSellPrice("cost_plus_margin", 333, 33.3, 0), 444);
  });

  test("a zero cost with a margin still yields zero, never a negative price", () => {
    assert.equal(calculateSellPrice("cost_plus_margin", 0, 50, 0), 0);
  });
});

describe("effectiveMarginPercent", () => {
  test("computes gross margin against the selling price", () => {
    assert.equal(effectiveMarginPercent(2500, 5000), 50);
    assert.equal(effectiveMarginPercent(0, 5000), 100);
  });

  test("returns zero rather than dividing by zero when nothing was sold", () => {
    assert.equal(effectiveMarginPercent(2500, 0), 0);
  });

  test("goes negative when an item is sold below cost", () => {
    assert.ok(effectiveMarginPercent(6000, 5000) < 0);
  });
});

describe("reorderQuantity", () => {
  test("uses restock target minus available quantity", () => {
    assert.equal(reorderQuantity(11, 90), 79);
    assert.equal(reorderQuantity(0, 200), 200);
  });

  test("never suggests a negative reorder when stock is above target", () => {
    assert.equal(reorderQuantity(250, 200), 0);
  });

  test("is zero when no restock target is configured", () => {
    assert.equal(reorderQuantity(5, 0), 0);
  });
});
