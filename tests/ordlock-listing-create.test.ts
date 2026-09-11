import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { OneSatContext } from "@1sat/actions";
import { executeOwnedOpnsOperation } from "@/lib/opns";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import {
	executeOrdinalOperation,
	type OrdinalActionSet,
} from "@/lib/wallet/ordinal-actions";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("OPL-4694 OrdLock listing create off", () => {
	it("keeps the kill switch off", () => {
		assert.equal(ORDLOCK_LISTING_CREATE, false);
		assert.match(LISTING_CREATE_OFF, /Buy and cancel/);
	});

	it("hides create UI while leaving buy and cancel visible", () => {
		const ordinals = read("components/wallet/ordinals-grid.tsx");
		const owned = read("components/opns/owned-opns.tsx");
		const listDialog = read("components/market/list-ordinal-dialog.tsx");
		const buy = read("components/market/buy-button.tsx");
		const mine = read("components/market/my-ordinal-listings.tsx");
		const opnsBuy = read("components/opns/opns-buy-button.tsx");

		assert.match(ordinals, /ORDLOCK_LISTING_CREATE && \(/);
		assert.match(ordinals, /Cancel listing/);
		assert.doesNotMatch(ordinals, /<Tag[\s\S]*List/);
		assert.match(owned, /ORDLOCK_LISTING_CREATE && \(/);
		assert.match(owned, /Cancel listing/);
		assert.match(listDialog, /canCreate/);
		assert.match(listDialog, /cancelOrdinalListing\.execute/);
		assert.match(buy, /buyOrdinal\.execute\(oneSatContext/);
		assert.match(mine, /kind="cancel"/);
		assert.match(opnsBuy, /buyCurrentOpnsListing/);
	});

	it("blocks sell dispatch for ordinals and OpNS without touching cancel", async () => {
		const calls: string[] = [];
		const actions: OrdinalActionSet = {
			send: async () => ({ txid: "send" }),
			burn: async () => ({ txid: "burn" }),
			sell: async () => {
				calls.push("sell");
				return { txid: "sell" };
			},
			cancel: async () => {
				calls.push("cancel");
				return { txid: "cancel" };
			},
		};
		const ctx = {} as OneSatContext;

		assert.deepEqual(
			await executeOrdinalOperation(
				ctx,
				{ kind: "sell", id: "one", price: 1 },
				actions,
			),
			{ error: LISTING_CREATE_OFF },
		);
		assert.deepEqual(
			await executeOrdinalOperation(
				ctx,
				{ kind: "cancel", id: "one" },
				actions,
			),
			{ txid: "cancel" },
		);
		assert.deepEqual(
			await executeOwnedOpnsOperation(ctx, {
				kind: "sell",
				id: "one",
				price: 1,
			}),
			{ error: LISTING_CREATE_OFF },
		);
		assert.deepEqual(calls, ["cancel"]);
	});
});
