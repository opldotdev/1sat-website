import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { OneSatContext, WalletOutput } from "@1sat/actions";
import { PrivateKey } from "@bsv/sdk";
import { LISTING_CREATE_OFF } from "@/lib/ordlock-listing";
import {
	executeOrdinalOperation,
	isOrdinalListed,
	type OrdinalActionSet,
	ordinalActionFailureMessage,
	ordinalAssetId,
	parseSatoshiPrice,
	validateOrdinalDestination,
} from "@/lib/wallet/ordinal-actions";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("ordinal action inputs", () => {
	it("parses prices as exact positive integer satoshis", () => {
		assert.equal(parseSatoshiPrice("1"), 1);
		assert.equal(parseSatoshiPrice(" 100000000 "), 100_000_000);
		assert.equal(
			parseSatoshiPrice(Number.MAX_SAFE_INTEGER.toString()),
			Number.MAX_SAFE_INTEGER,
		);
		for (const invalid of [
			"",
			"0",
			"-1",
			"1.1",
			"1e8",
			"01",
			"9007199254740992",
		]) {
			assert.equal(parseSatoshiPrice(invalid), null, invalid);
		}
	});

	it("validates P2PKH and counterparty destinations before wallet access", () => {
		const privateKey = PrivateKey.fromHex("01".repeat(32));
		const publicKey = privateKey.toPublicKey().toString();
		const mainnet = privateKey.toPublicKey().toAddress("mainnet");
		const testnet = privateKey.toPublicKey().toAddress("testnet");

		assert.equal(validateOrdinalDestination(mainnet, "address", "main"), true);
		assert.equal(validateOrdinalDestination(mainnet, "address", "test"), false);
		assert.equal(validateOrdinalDestination(testnet, "address", "test"), true);
		assert.equal(
			validateOrdinalDestination(publicKey, "counterparty", "main"),
			true,
		);
		assert.equal(
			validateOrdinalDestination("02deadbeef", "counterparty", "main"),
			false,
		);
	});

	it("reads current wallet asset IDs and listing state without legacy inference", () => {
		const output: WalletOutput = {
			outpoint: `${"ab".repeat(32)}.1`,
			satoshis: 1,
			spendable: true,
			tags: ["id:asset-1", "ordlock"],
		};
		assert.equal(ordinalAssetId(output), "asset-1");
		assert.equal(isOrdinalListed(output), true);
		assert.equal(ordinalAssetId({ ...output, tags: ["origin:legacy"] }), null);
	});
});

describe("canonical ordinal action dispatch", () => {
	it("passes exact send, burn and cancel inputs; sell create stays off", async () => {
		const calls: Array<{ action: string; input: unknown }> = [];
		const actions: OrdinalActionSet = {
			send: async (_ctx, input) => {
				calls.push({ action: "send", input });
				return { txid: "send" };
			},
			burn: async (_ctx, input) => {
				calls.push({ action: "burn", input });
				return { txid: "burn" };
			},
			sell: async (_ctx, input) => {
				calls.push({ action: "sell", input });
				return { txid: "sell" };
			},
			cancel: async (_ctx, input) => {
				calls.push({ action: "cancel", input });
				return { txid: "cancel" };
			},
		};
		const ctx = {} as OneSatContext;

		await executeOrdinalOperation(
			ctx,
			{
				kind: "send",
				ids: ["one", "two"],
				destinationKind: "address",
				destination: "address",
			},
			actions,
		);
		await executeOrdinalOperation(
			ctx,
			{ kind: "burn", ids: ["one", "two"] },
			actions,
		);
		assert.deepEqual(
			await executeOrdinalOperation(
				ctx,
				{ kind: "sell", id: "one", price: 123_456_789 },
				actions,
			),
			{ error: LISTING_CREATE_OFF },
		);
		await executeOrdinalOperation(ctx, { kind: "cancel", id: "one" }, actions);

		assert.deepEqual(calls, [
			{
				action: "send",
				input: {
					transfers: [
						{ id: "one", address: "address" },
						{ id: "two", address: "address" },
					],
				},
			},
			{ action: "burn", input: { ids: ["one", "two"] } },
			{ action: "cancel", input: { id: "one" } },
		]);
	});

	it("maps denial, stale output and opaque failures without exposing payloads", () => {
		assert.match(
			ordinalActionFailureMessage("user rejected request"),
			/declined/,
		);
		assert.match(ordinalActionFailureMessage("missing-output"), /changed/);
		const opaque = ordinalActionFailureMessage({ seed: "never display" });
		assert.match(opaque, /failed/);
		assert.doesNotMatch(opaque, /seed|never display/);
	});

	it("keeps the UI on the active OneSatContext and invalidates wallet and market data", () => {
		const source = [
			read("components/wallet/ordinal-action-dialog.tsx"),
			read("components/wallet/ordinals-grid.tsx"),
			read("lib/wallet/ordinal-actions.ts"),
		].join("\n");
		for (const action of [
			"sendOrdinals",
			"burnOrdinals",
			"sellOrdinal",
			"cancelOrdinalListing",
		]) {
			assert.match(source, new RegExp(action));
		}
		assert.match(source, /executeOrdinalOperation\(oneSatContext/);
		assert.match(source, /queryKey: \["wallet-balance"\]/);
		assert.match(source, /queryKey: \["market-flow"\]/);
		assert.doesNotMatch(
			source,
			/@\/providers\/wallet-provider|createContext\(|wallet-storage|wallet-backup|indexedDB|rootKey|seedPhrase/,
		);
		assert.match(source, /ORDLOCK_LISTING_CREATE/);
		assert.match(source, /Cancel listing/);
	});
});
