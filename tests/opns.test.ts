import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { OneSatContext } from "@1sat/actions";
import { HttpError } from "@1sat/client";
import {
	executeOwnedOpnsOperation,
	normalizeOpnsName,
	OPNS_CONTENT_TYPE,
	type OpnsClients,
	opnsFailureMessage,
	opnsSearchHref,
	parseOpnsCursor,
	resolveOpnsDetail,
	searchOpnsListings,
} from "@/lib/opns";
import { MARKET_PAGE_SIZE } from "@/lib/ordinal-marketplace";
import { LISTING_CREATE_OFF } from "@/lib/ordlock-listing";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ORIGIN = `${"ab".repeat(32)}.0`;
const LISTING = `${"cd".repeat(32)}.1`;

function clients(overrides: Partial<OpnsClients> = {}): OpnsClients {
	return {
		opns: {
			getOrigin: async (name) => ({ name, outpoint: ORIGIN }),
			getMine: async () => ({ domain: "one", outpoint: ORIGIN }),
		},
		market: {
			getListingByOrigin: async () =>
				({
					outpoint: LISTING,
					score: 10,
					data: {
						ordlock: {
							origin: ORIGIN,
							name: "one",
							content_type: OPNS_CONTENT_TYPE,
							price: "10000",
						},
					},
				}) as never,
			searchListings: async () => [],
		},
		ordfs: {
			getMetadata: async () => ({
				outpoint: ORIGIN,
				sequence: 0,
				contentType: OPNS_CONTENT_TYPE,
				contentLength: 42,
			}),
		},
		...overrides,
	};
}

describe("typed OpNS discovery", () => {
	it("normalizes bounded UTF-8 names and score cursors", () => {
		assert.equal(normalizeOpnsName("  One  "), "one");
		assert.equal(normalizeOpnsName("💩".repeat(16)), "💩".repeat(16));
		assert.equal(normalizeOpnsName("💩".repeat(17)), null);
		assert.equal(parseOpnsCursor("12.5"), 12.5);
		assert.equal(parseOpnsCursor("-1"), undefined);
		assert.equal(opnsSearchHref("one sat", 12.5), "/opns?q=one+sat&from=12.5");
	});

	it("combines registered origin, ORDFS metadata, and exact active OpNS listing", async () => {
		const detail = await resolveOpnsDetail(
			"One",
			["opns", "ordfs", "market"],
			clients(),
		);
		assert.equal(detail?.origin.status, "ready");
		assert.equal(detail?.metadata.status, "ready");
		assert.equal(detail?.listing.status, "ready");
		if (detail?.listing.status === "ready") {
			assert.equal(detail.listing.data.price, 10_000);
		}
		assert.equal(detail?.profile.status, "unavailable");
	});

	it("exposes only the typed mining status when a name has no registered origin", async () => {
		let marketCalled = false;
		const detail = await resolveOpnsDetail(
			"open",
			["opns", "ordfs", "market"],
			clients({
				opns: {
					getOrigin: async () => {
						throw new HttpError(404, "not found");
					},
					getMine: async () => ({ domain: "ope", outpoint: ORIGIN }),
				},
				market: {
					getListingByOrigin: async () => {
						marketCalled = true;
						throw new Error("must not run");
					},
					searchListings: async () => [],
				},
			}),
		);
		assert.equal(detail?.origin.status, "not-found");
		assert.deepEqual(
			detail?.mine.status === "ready" ? detail.mine.data : null,
			{ domain: "ope", outpoint: ORIGIN },
		);
		assert.equal(marketCalled, false);
	});

	it("rejects a market row whose advertised origin differs", async () => {
		const detail = await resolveOpnsDetail(
			"one",
			["opns", "market"],
			clients({
				market: {
					getListingByOrigin: async () =>
						({
							outpoint: LISTING,
							score: 10,
							data: {
								ordlock: {
									origin: `${"ef".repeat(32)}.0`,
									content_type: OPNS_CONTENT_TYPE,
									price: 100,
								},
							},
						}) as never,
					searchListings: async () => [],
				},
			}),
		);
		assert.equal(detail?.listing.status, "not-found");
	});

	it("fixes market searches to active OpNS rows with cursor pagination", async () => {
		let received: unknown;
		const result = await searchOpnsListings(
			["market"],
			{
				searchListings: async (options) => {
					received = options;
					return Array.from(
						{ length: MARKET_PAGE_SIZE },
						(_, index) =>
							({
								outpoint: `${index.toString(16).padStart(64, "0")}.0`,
								score: 100 - index,
								data: {
									ordlock: {
										origin: ORIGIN,
										content_type: OPNS_CONTENT_TYPE,
										price: 100,
									},
								},
							}) as never,
					);
				},
			},
			"one",
			500,
		);
		assert.deepEqual(received, {
			status: "active",
			limit: MARKET_PAGE_SIZE,
			rev: true,
			type: OPNS_CONTENT_TYPE,
			q: "one",
			from: 500,
		});
		assert.equal(result.status, "ready");
		if (result.status === "ready") assert.equal(result.data.nextCursor, 71);
	});

	it("redacts arbitrary provider failures", () => {
		assert.match(opnsFailureMessage("permission denied"), /declined/);
		assert.doesNotMatch(
			opnsFailureMessage({ seed: "never display this" }),
			/seed|never display/,
		);
	});
});

describe("provider-neutral OpNS UI boundaries", () => {
	it("uses canonical context actions, stale revalidation, and exact satoshi review", () => {
		const source = [
			"lib/opns.ts",
			"components/opns/owned-opns.tsx",
			"components/opns/opns-action-dialog.tsx",
			"components/opns/opns-buy-button.tsx",
			"app/(main)/opns/page.tsx",
			"app/(main)/opns/[name]/page.tsx",
		]
			.map(read)
			.join("\n");
		for (const action of [
			"registerOpns",
			"deregisterOpns",
			"sendOpns",
			"sellOpns",
			"cancelOpnsListing",
			"buyOpns",
		]) {
			assert.match(source, new RegExp(`${action}\\.execute\\(ctx`));
		}
		assert.match(source, /requireCurrentOwnedOpns/);
		assert.match(source, /requireCurrentListing/);
		assert.match(source, /positive whole-satoshi price/);
		assert.match(source, /Total before network fee/);
		assert.match(source, /not quoted by this action/);
		assert.match(source, /queryKey: \["wallet-balance"\]/);
		assert.match(source, /queryKey: \["opns-listings"\]/);
		assert.doesNotMatch(
			source,
			/createContext\(|wallet-storage|wallet-backup|wallet-migration|indexedDB|rootKey|seedPhrase|PrivateKey/,
		);
		assert.doesNotMatch(source, /\/api\/(?:opns|mine|profile|quote)/);
		assert.match(source, /ORDLOCK_LISTING_CREATE/);
		assert.match(source, /LISTING_CREATE_OFF/);
		assert.match(source, /Cancel listing/);
		assert.match(source, /buyCurrentOpnsListing/);
	});

	it("rejects OpNS listing create and leaves cancel/buy contracts in place", async () => {
		assert.deepEqual(
			await executeOwnedOpnsOperation({} as OneSatContext, {
				kind: "sell",
				id: "one",
				price: 10_000,
			}),
			{ error: LISTING_CREATE_OFF },
		);
	});

	it("keeps direct claim and unsupported profile resolution explicitly disabled", () => {
		const detail = read("app/(main)/opns/[name]/page.tsx");
		assert.match(detail, /Direct claim unavailable/);
		assert.match(detail, /getMine/);
		assert.match(detail, /internalizeOpns/);
		assert.doesNotMatch(detail, /internalizeOpns\.execute|buyOpns\.execute/);
		assert.match(
			read("lib/opns.ts"),
			/do not expose the paymail public-profile resolver/,
		);
	});
});
