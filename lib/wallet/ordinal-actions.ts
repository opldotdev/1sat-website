import {
	burnOrdinals,
	cancelOrdinalListing,
	type OneSatContext,
	type OrdinalOperationResponse,
	sellOrdinal,
	sendOrdinals,
	type WalletOutput,
} from "@1sat/actions";
import { readAssetIdTag } from "@1sat/types";
import { PublicKey } from "@bsv/sdk";
import { isP2pkhAddressForChain } from "@/components/wallet/wallet-home-utils";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export type OrdinalDestinationKind = "address" | "counterparty";

export type OrdinalOperation =
	| {
			kind: "send";
			ids: string[];
			destinationKind: OrdinalDestinationKind;
			destination: string;
	  }
	| { kind: "burn"; ids: string[] }
	| { kind: "sell"; id: string; price: number }
	| { kind: "cancel"; id: string };

export interface OrdinalActionSet {
	send: typeof sendOrdinals.execute;
	burn: typeof burnOrdinals.execute;
	sell: typeof sellOrdinal.execute;
	cancel: typeof cancelOrdinalListing.execute;
}

export const canonicalOrdinalActions: OrdinalActionSet = {
	send: sendOrdinals.execute,
	burn: burnOrdinals.execute,
	sell: sellOrdinal.execute,
	cancel: cancelOrdinalListing.execute,
};

export function parseSatoshiPrice(value: string): number | null {
	const normalized = value.trim();
	if (!POSITIVE_INTEGER.test(normalized)) return null;
	try {
		const price = BigInt(normalized);
		if (price > BigInt(Number.MAX_SAFE_INTEGER)) return null;
		return Number(price);
	} catch {
		return null;
	}
}

export function isOrdinalListed(output: WalletOutput): boolean {
	return output.tags?.includes("ordlock") ?? false;
}

export function ordinalAssetId(output: WalletOutput): string | null {
	return readAssetIdTag(output.tags) ?? null;
}

export function validateOrdinalDestination(
	value: string,
	kind: OrdinalDestinationKind,
	chain: "main" | "test",
): boolean {
	const normalized = value.trim();
	if (kind === "address") {
		return isP2pkhAddressForChain(normalized, chain);
	}
	if (!/^(02|03)[0-9a-fA-F]{64}$/.test(normalized)) return false;
	try {
		return (
			PublicKey.fromString(normalized).toString() === normalized.toLowerCase()
		);
	} catch {
		return false;
	}
}

export function ordinalActionFailureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	if (
		normalized.includes("denied") ||
		normalized.includes("reject") ||
		normalized.includes("cancel") ||
		normalized.includes("declined")
	) {
		return "The wallet declined this action. Your selection and details were kept.";
	}
	if (
		normalized.includes("missing") ||
		normalized.includes("not found") ||
		normalized.includes("already spent") ||
		normalized.includes("stale")
	) {
		return "One or more ordinals changed in the wallet. Refresh, review the selection, and try again.";
	}
	return "The ordinal action failed. Check the wallet connection and try again; your selection was kept.";
}

export async function executeOrdinalOperation(
	ctx: OneSatContext,
	operation: OrdinalOperation,
	actions: OrdinalActionSet = canonicalOrdinalActions,
): Promise<OrdinalOperationResponse> {
	switch (operation.kind) {
		case "send": {
			const transfers = operation.ids.map((id) => ({
				id,
				...(operation.destinationKind === "address"
					? { address: operation.destination }
					: { counterparty: operation.destination }),
			}));
			return actions.send(ctx, { transfers });
		}
		case "burn":
			return actions.burn(ctx, { ids: operation.ids });
		case "sell":
			if (!ORDLOCK_LISTING_CREATE) {
				return { error: LISTING_CREATE_OFF };
			}
			return actions.sell(ctx, {
				id: operation.id,
				price: operation.price,
			});
		case "cancel":
			return actions.cancel(ctx, { id: operation.id });
	}
}
