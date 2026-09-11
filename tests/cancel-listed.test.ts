import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { OneSatContext, WalletOutput } from "@1sat/actions";
import { LISTING_CREATE_OFF } from "@/lib/ordlock-listing";
import {
	cancelListedOnLoad,
	listedCancelItems,
} from "@/lib/wallet/cancel-listed";
import { executeOrdinalOperation } from "@/lib/wallet/ordinal-actions";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const output = (tags: string[]): WalletOutput => ({
	outpoint: `${"ab".repeat(32)}.1`,
	satoshis: 1,
	spendable: true,
	tags,
});

describe("OPL-4696 cancel listed OrdLock on load / sweep", () => {
	it("selects only current listed outputs with wallet asset IDs", () => {
		assert.deepEqual(
			listedCancelItems(
				[
					output(["id:ord-1", "ordlock"]),
					output(["id:ord-2"]),
					output(["ordlock"]),
				],
				[output(["id:opns-1", "ordlock"]), output(["id:opns-2", "opns"])],
			),
			[
				{ kind: "ordinal", id: "ord-1" },
				{ kind: "opns", id: "opns-1" },
			],
		);
	});

	it("cancels listed ordinals and never sells", async () => {
		const calls: string[] = [];
		const ctx = {} as OneSatContext;
		assert.deepEqual(
			await executeOrdinalOperation(ctx, {
				kind: "sell",
				id: "ord-1",
				price: 1,
			}),
			{ error: LISTING_CREATE_OFF },
		);
		const result = await cancelListedOnLoad(
			ctx,
			[
				{ kind: "ordinal", id: "ord-1" },
				{ kind: "opns", id: "opns-1" },
			],
			{
				ordinal: async (_ctx, id) => {
					calls.push(`ordinal:${id}`);
					return {};
				},
				opns: async (_ctx, id) => {
					calls.push(`opns:${id}`);
					return {};
				},
			},
		);
		assert.deepEqual(result, { cancelled: ["ord-1", "opns-1"], failed: [] });
		assert.deepEqual(calls, ["ordinal:ord-1", "opns:opns-1"]);
	});

	it("keeps load cancel and legacy sweep on the installed cancel path", () => {
		const helper = read("lib/wallet/cancel-listed.ts");
		const hook = read("providers/hooks/use-cancel-listed-on-load.ts");
		const sweep = read("lib/sweep-migration.ts");
		const installed = read("node_modules/@1sat/actions/dist/sweep/index.js");
		assert.match(helper, /kind: "cancel"/);
		assert.doesNotMatch(helper, /kind: "sell"/);
		assert.match(hook, /cancelListedOnLoad/);
		assert.match(sweep, /OPL-4696/);
		assert.match(installed, /OrdLock\.cancelListing/);
		assert.match(read("components/app-sidebar.tsx"), /ListedCancelBanner/);
		assert.match(read("components/market/buy-button.tsx"), /buyOrdinal/);
	});
});
