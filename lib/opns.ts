import {
	buyOpns,
	cancelOpnsListing,
	deregisterOpns,
	listOpns,
	type OneSatContext,
	type OpnsOperationResponse,
	registerOpns,
	sellOpns,
	sendOpns,
	type WalletOutput,
} from "@1sat/actions";
import {
	HttpError,
	type MarketClient,
	type OpnsClient,
	type OrdfsClient,
} from "@1sat/client";
import type { Capability, OrdfsMetadata } from "@1sat/types";
import { readAssetIdTag } from "@1sat/types";
import {
	isActiveListing,
	requireCurrentListing,
	searchActiveOrdinalListings,
} from "@/lib/ordinal-marketplace";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import {
	type ListingData,
	listingFromOutput,
	toStackOutpoint,
} from "@/lib/stack";
import { getName, getOriginOutpoint } from "@/lib/wallet/wallet-output-utils";

export const OPNS_CONTENT_TYPE = "application/op-ns";
export type OpnsState<T> =
	| { status: "ready"; data: T }
	| { status: "not-found" }
	| { status: "unavailable"; reason: string }
	| { status: "error" };

export interface OpnsDetail {
	name: string;
	origin: OpnsState<{ name: string; outpoint: string }>;
	mine: OpnsState<{ domain: string; outpoint: string }>;
	metadata: OpnsState<OrdfsMetadata>;
	listing: OpnsState<ListingData>;
	profile: OpnsState<never>;
}

export interface OpnsClients {
	opns: Pick<OpnsClient, "getOrigin" | "getMine">;
	market: Pick<MarketClient, "getListingByOrigin" | "searchListings">;
	ordfs: Pick<OrdfsClient, "getMetadata">;
}

export function normalizeOpnsName(value: string): string | null {
	const name = value.trim().toLowerCase();
	return name && new TextEncoder().encode(name).byteLength <= 64 ? name : null;
}

export function parseOpnsCursor(
	value: string | string[] | undefined,
): number | undefined {
	if (typeof value !== "string") return undefined;
	const cursor = Number(value);
	return Number.isFinite(cursor) && cursor >= 0 ? cursor : undefined;
}

export function opnsSearchHref(query?: string, from?: number): string {
	const params = new URLSearchParams();
	if (query) params.set("q", query);
	if (from !== undefined) params.set("from", String(from));
	const suffix = params.toString();
	return `/opns${suffix ? `?${suffix}` : ""}`;
}

const unavailable = <T>(reason: string): OpnsState<T> => ({
	status: "unavailable",
	reason,
});

const isNotFound = (error: unknown) =>
	error instanceof HttpError && error.status === 404;

export async function resolveOpnsDetail(
	value: string,
	capabilities: readonly Capability[],
	clients: OpnsClients,
): Promise<OpnsDetail | null> {
	const name = normalizeOpnsName(value);
	if (!name) return null;
	const available = new Set(capabilities);
	const profile = unavailable<never>(
		"The installed typed clients do not expose the paymail public-profile resolver.",
	);
	if (!available.has("opns")) {
		return {
			name,
			origin: unavailable("OpNS capability is unavailable."),
			mine: unavailable("OpNS capability is unavailable."),
			metadata: unavailable("Origin is required before ORDFS lookup."),
			listing: unavailable("Origin is required before Market lookup."),
			profile,
		};
	}

	let origin: { name: string; outpoint: string };
	try {
		origin = await clients.opns.getOrigin(name);
	} catch (error) {
		if (!isNotFound(error)) {
			return {
				name,
				origin: { status: "error" },
				mine: { status: "error" },
				metadata: unavailable("Origin lookup failed."),
				listing: unavailable("Origin lookup failed."),
				profile,
			};
		}
		try {
			const mine = await clients.opns.getMine(name);
			return {
				name,
				origin: { status: "not-found" },
				mine: { status: "ready", data: mine },
				metadata: { status: "not-found" },
				listing: { status: "not-found" },
				profile,
			};
		} catch (mineError) {
			return {
				name,
				origin: { status: "not-found" },
				mine: isNotFound(mineError)
					? { status: "not-found" }
					: { status: "error" },
				metadata: { status: "not-found" },
				listing: { status: "not-found" },
				profile,
			};
		}
	}

	const [metadata, listing] = await Promise.all([
		available.has("ordfs")
			? clients.ordfs
					.getMetadata(toStackOutpoint(origin.outpoint), -1)
					.then((data): OpnsState<OrdfsMetadata> => ({ status: "ready", data }))
					.catch(
						(error): OpnsState<OrdfsMetadata> =>
							isNotFound(error) ? { status: "not-found" } : { status: "error" },
					)
			: unavailable<OrdfsMetadata>("ORDFS capability is unavailable."),
		available.has("market")
			? clients.market
					.getListingByOrigin(toStackOutpoint(origin.outpoint))
					.then((output): OpnsState<ListingData> => {
						const data = listingFromOutput(output);
						return isActiveListing(data) &&
							data.content_type === OPNS_CONTENT_TYPE &&
							data.origin !== undefined &&
							toStackOutpoint(data.origin) === toStackOutpoint(origin.outpoint)
							? { status: "ready", data }
							: { status: "not-found" };
					})
					.catch(
						(error): OpnsState<ListingData> =>
							isNotFound(error) ? { status: "not-found" } : { status: "error" },
					)
			: unavailable<ListingData>("Market capability is unavailable."),
	]);

	return {
		name,
		origin: { status: "ready", data: origin },
		mine: { status: "not-found" },
		metadata,
		listing,
		profile,
	};
}

export async function searchOpnsListings(
	capabilities: readonly Capability[],
	client: Pick<MarketClient, "searchListings">,
	query?: string,
	from?: number,
): Promise<OpnsState<{ listings: ListingData[]; nextCursor: number | null }>> {
	if (!capabilities.includes("market")) {
		return unavailable("Market capability is unavailable.");
	}
	try {
		const result = await searchActiveOrdinalListings(client, {
			type: OPNS_CONTENT_TYPE,
			...(query && { q: query }),
			...(from !== undefined && { from }),
		});
		return {
			status: "ready",
			data: {
				listings: result.listings.filter(
					(listing) => listing.content_type === OPNS_CONTENT_TYPE,
				),
				nextCursor: result.nextCursor,
			},
		};
	} catch {
		return { status: "error" };
	}
}

export function opnsAssetId(output: WalletOutput): string | null {
	return readAssetIdTag(output.tags) ?? null;
}

export function isOpnsPublished(output: WalletOutput): boolean {
	return output.tags?.includes("opns:published") ?? false;
}

export function isOpnsListed(output: WalletOutput): boolean {
	return output.tags?.includes("ordlock") ?? false;
}

export function ownedOpnsName(output: WalletOutput): string {
	return getName(output) ?? getOriginOutpoint(output);
}

export async function requireCurrentOwnedOpns(
	ctx: OneSatContext,
	id: string,
	expectedOutpoint: string,
): Promise<WalletOutput | null> {
	const current = await listOpns.execute(ctx, { ids: [id], limit: 2 });
	return current.outputs.length === 1 &&
		toStackOutpoint(current.outputs[0].outpoint) ===
			toStackOutpoint(expectedOutpoint)
		? current.outputs[0]
		: null;
}

export type OpnsOwnedOperation =
	| { kind: "publish"; id: string; profileName?: string; avatar?: string }
	| { kind: "unpublish"; id: string }
	| { kind: "send"; id: string; address?: string; counterparty?: string }
	| { kind: "sell"; id: string; price: number }
	| { kind: "cancel"; id: string };

export async function executeOwnedOpnsOperation(
	ctx: OneSatContext,
	operation: OpnsOwnedOperation,
): Promise<OpnsOperationResponse> {
	switch (operation.kind) {
		case "publish":
			return registerOpns.execute(ctx, {
				id: operation.id,
				profileName: operation.profileName,
				avatar: operation.avatar,
			});
		case "unpublish":
			return deregisterOpns.execute(ctx, { id: operation.id });
		case "send":
			return sendOpns.execute(ctx, {
				id: operation.id,
				address: operation.address,
				counterparty: operation.counterparty,
			});
		case "sell":
			if (!ORDLOCK_LISTING_CREATE) {
				return { error: LISTING_CREATE_OFF };
			}
			return sellOpns.execute(ctx, {
				id: operation.id,
				price: operation.price,
			});
		case "cancel":
			return cancelOpnsListing.execute(ctx, { id: operation.id });
	}
}

export async function buyCurrentOpnsListing(
	ctx: OneSatContext,
	listing: ListingData,
): Promise<OpnsOperationResponse | null> {
	if (!ctx.services?.market) return null;
	const current = await requireCurrentListing(ctx.services.market, listing);
	if (!current) return null;
	return buyOpns.execute(ctx, {
		outpoint: current.outpoint,
		name: current.name,
		origin: current.origin,
	});
}

export function opnsFailureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	if (/denied|reject|declin|cancel/.test(normalized)) {
		return "The wallet declined this action. Your review details were kept.";
	}
	if (/missing|not found|spent|stale/.test(normalized)) {
		return "This name or listing changed. Refresh it before trying again.";
	}
	if (/insufficient|fund/.test(normalized)) {
		return "The wallet does not have enough spendable BSV for this action.";
	}
	return "The OpNS action failed. Check the wallet connection and retry; your details were kept.";
}
