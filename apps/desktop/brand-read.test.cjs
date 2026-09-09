const assert = require("node:assert/strict");
const { dirname, join } = require("node:path");
const { parseBrand, loadBrandFromResources, DEFAULT_BRAND } = require("./brand-read.cjs");

const kemenkeu = parseBrand({
  productName: "Kemenkeu AI",
  gatewayName: "AIHub",
  gatewayBaseUrl: "https://aihub.metranet.co.id/v1/",
});
assert.equal(kemenkeu.productName, "Kemenkeu AI");
assert.equal(kemenkeu.gatewayName, "AIHub");
assert.equal(kemenkeu.gatewayBaseUrl, "https://aihub.metranet.co.id/v1");

const metranet = parseBrand({
  productName: "AIHub Metranet",
  gatewayName: "AIHub",
  gatewayBaseUrl: "https://aihub.metranet.co.id/v1",
});
assert.equal(metranet.productName, "AIHub Metranet");

const empty = parseBrand({}, DEFAULT_BRAND);
assert.equal(empty.productName, "DPSBuddy");
assert.equal(empty.gatewayName, "Toko Token");

const fromDisk = loadBrandFromResources(join(__dirname, "resources"), __dirname);
assert.equal(fromDisk.productName, "DPSBuddy");
assert.equal(fromDisk.gatewayName, "Toko Token");

console.log("brand-read.test.cjs: ok");
