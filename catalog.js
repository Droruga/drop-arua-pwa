/* Drop catalog data boundary.
 * The owner supplies /catalog.json. This module validates and exposes that
 * file without creating, editing, or substituting product data.
 */
(function (global) {
  "use strict";

  const AVAILABILITY = new Set(["in_stock", "seasonal", "order_in", "out_of_stock"]);
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const isText = value => typeof value === "string" && value.trim().length > 0;
  const isPrice = value => Number.isSafeInteger(value) && value >= 0;

  function fail(path, message) {
    throw new Error("Catalog data is invalid at " + path + ": " + message);
  }

  function validateCatalog(data) {
    if (!isRecord(data)) fail("root", "expected a JSON object.");
    if (data.schemaVersion !== 1) fail("schemaVersion", "expected version 1.");
    if (data.currency !== "UGX") fail("currency", "expected UGX.");
    if (!Array.isArray(data.categories)) fail("categories", "expected an array.");

    const categoryIds = new Set();
    const productIds = new Set();

    data.categories.forEach((category, categoryIndex) => {
      const categoryPath = "categories[" + categoryIndex + "]";
      if (!isRecord(category)) fail(categoryPath, "expected an object.");
      if (!isText(category.id)) fail(categoryPath + ".id", "expected a non-empty string.");
      if (categoryIds.has(category.id)) fail(categoryPath + ".id", "duplicate category id.");
      categoryIds.add(category.id);
      if (!isText(category.name)) fail(categoryPath + ".name", "expected a non-empty string.");
      if (!Array.isArray(category.subcategories)) fail(categoryPath + ".subcategories", "expected an array.");

      const subcategoryIds = new Set();
      category.subcategories.forEach((subcategory, subcategoryIndex) => {
        const subcategoryPath = categoryPath + ".subcategories[" + subcategoryIndex + "]";
        if (!isRecord(subcategory)) fail(subcategoryPath, "expected an object.");
        if (!isText(subcategory.id)) fail(subcategoryPath + ".id", "expected a non-empty string.");
        if (subcategoryIds.has(subcategory.id)) fail(subcategoryPath + ".id", "duplicate subcategory id within category.");
        subcategoryIds.add(subcategory.id);
        if (!isText(subcategory.name)) fail(subcategoryPath + ".name", "expected a non-empty string.");
        if (!Array.isArray(subcategory.products)) fail(subcategoryPath + ".products", "expected an array.");

        subcategory.products.forEach((product, productIndex) => {
          const productPath = subcategoryPath + ".products[" + productIndex + "]";
          if (!isRecord(product)) fail(productPath, "expected an object.");
          if (!isText(product.id)) fail(productPath + ".id", "expected a non-empty string.");
          if (productIds.has(product.id)) fail(productPath + ".id", "duplicate product id.");
          productIds.add(product.id);
          if (!isText(product.name)) fail(productPath + ".name", "expected a non-empty string.");
          if (!isText(product.unit)) fail(productPath + ".unit", "expected a non-empty string.");
          if (!isPrice(product.price_min)) fail(productPath + ".price_min", "expected a non-negative integer UGX amount.");
          if (!isPrice(product.price_max)) fail(productPath + ".price_max", "expected a non-negative integer UGX amount.");
          if (product.price_min > product.price_max) fail(productPath, "price_min cannot exceed price_max.");
          if (hasOwn(product, "price_note") && typeof product.price_note !== "string") {
            fail(productPath + ".price_note", "expected text when provided.");
          }
          if (!AVAILABILITY.has(product.availability)) {
            fail(productPath + ".availability", "expected in_stock, seasonal, order_in, or out_of_stock.");
          }
          if (typeof product.age_restricted !== "boolean") fail(productPath + ".age_restricted", "expected true or false.");
          if (typeof product.rx_required !== "boolean") fail(productPath + ".rx_required", "expected true or false.");
        });
      });
    });

    return data;
  }

  async function load(options) {
    const settings = options || {};
    const url = settings.url || "/catalog.json";
    const fetcher = settings.fetch || global.fetch.bind(global);
    let response;
    try {
      response = await fetcher(url, { cache: "no-cache" });
    } catch (error) {
      throw new Error("Drop could not reach the product catalog. Check your connection and try again.");
    }
    if (!response || !response.ok) {
      throw new Error("Drop's product catalog is not available yet. Please try again later.");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error("Drop's product catalog could not be read. Please contact support.");
    }
    return validateCatalog(data);
  }

  global.DropCatalog = Object.freeze({
    load: load,
    validate: validateCatalog,
    availability: Object.freeze(Array.from(AVAILABILITY))
  });
})(window);
