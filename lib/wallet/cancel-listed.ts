import { listOpns, type OneSatContext, type WalletOutput } from "@1sat/actions";
import {
	executeOwnedOpnsOperation,
	isOpnsListed,
	opnsAssetId,
} from "@/lib/opns";
import {
	executeOrdinalOperation,
	isOrdinalListed,
	ordinalAssetId,
} from "@/lib/wallet/ordinal-actions";

export type ListedKind = "ordinal" | "opns";

export interface ListedCancelItem {
	kind: ListedKind;
	id: string;
}

export interface ListedCancelResult {
	cancelled: string[];
	failed: Array<{ id: string; error: string }>;
}

export function listedCancelItems(
	ordinals: WalletOutput[],
	opns: WalletOutput[] = [],
): ListedCancelItem[] {
	const items: ListedCancelItem[] = [];
	const seen = new Set<string>();
	for (const output of ordinals) {
		const id = ordinalAssetId(output);
		if (!id || !isOrdinalListed(output) || seen.has(`ordinal:${id}`)) continue;
		seen.add(`ordinal:${id}`);
		items.push({ kind: "ordinal", id });
	}
	for (const output of opns) {
		const id = opnsAssetId(output);
		if (!id || !isOpnsListed(output) || seen.has(`opns:${id}`)) continue;
		seen.add(`opns:${id}`);
		items.push({ kind: "opns", id });
	}
	return items;
}

export async function loadListedOpns(
	ctx: OneSatContext,
): Promise<WalletOutput[]> {
	const page = 50;
	const first = await listOpns.execute(ctx, {
		limit: page,
		offset: 0,
		includeTags: true,
		includeCustomInstructions: true,
	});
	const outputs = [...first.outputs];
	const total = first.totalOutputs ?? outputs.length;
	for (let offset = page; offset < total; offset += page) {
		const next = await listOpns.execute(ctx, {
			limit: page,
			offset,
			includeTags: true,
			includeCustomInstructions: true,
		});
		outputs.push(...next.outputs);
	}
	return outputs;
}

export interface ListedCancelRunners {
	ordinal: (ctx: OneSatContext, id: string) => Promise<{ error?: string }>;
	opns: (ctx: OneSatContext, id: string) => Promise<{ error?: string }>;
}

export const defaultListedCancelRunners: ListedCancelRunners = {
	ordinal: (ctx, id) => executeOrdinalOperation(ctx, { kind: "cancel", id }),
	opns: (ctx, id) => executeOwnedOpnsOperation(ctx, { kind: "cancel", id }),
};

export async function cancelListedOnLoad(
	ctx: OneSatContext,
	items: ListedCancelItem[],
	runners: ListedCancelRunners = defaultListedCancelRunners,
): Promise<ListedCancelResult> {
	const cancelled: string[] = [];
	const failed: Array<{ id: string; error: string }> = [];
	for (const item of items) {
		const result = await runners[item.kind](ctx, item.id);
		if (result.error) {
			failed.push({ id: item.id, error: result.error });
		} else {
			cancelled.push(item.id);
		}
	}
	return { cancelled, failed };
}
