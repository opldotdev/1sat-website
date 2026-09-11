"use client";

import { listOpns, type WalletOutput } from "@1sat/actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	OpnsActionDialog,
	type OpnsActionKind,
} from "@/components/opns/opns-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStackFeatures } from "@/lib/hooks/use-stack-features";
import {
	isOpnsListed,
	isOpnsPublished,
	opnsAssetId,
	ownedOpnsName,
} from "@/lib/opns";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import { getDisplayOutpoint } from "@/lib/wallet/wallet-output-utils";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

const PAGE_SIZE = 50;

export function OwnedOpns() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const stackFeatures = useStackFeatures();
	const {
		oneSatContext,
		identityKey,
		isInitialized,
		isInitializing,
		refreshBalance,
	} = useWalletToolbox();
	const [offset, setOffset] = useState(0);
	const [action, setAction] = useState<{
		kind: OpnsActionKind;
		output: WalletOutput;
	} | null>(null);
	const identityRef = useRef(identityKey);

	useEffect(() => {
		if (identityRef.current === identityKey) return;
		identityRef.current = identityKey;
		setOffset(0);
		setAction(null);
	}, [identityKey]);

	const namesQuery = useQuery({
		queryKey: ["opns-names", identityKey, offset],
		queryFn: async () => {
			if (!oneSatContext) return { outputs: [], totalOutputs: 0 };
			return listOpns.execute(oneSatContext, {
				limit: PAGE_SIZE,
				offset,
				includeTags: true,
				includeCustomInstructions: true,
			});
		},
		enabled: isInitialized && !!oneSatContext,
		staleTime: 15_000,
	});

	const refresh = useCallback(async () => {
		refreshBalance();
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["opns-names"] }),
			queryClient.invalidateQueries({ queryKey: ["wallet-balance"] }),
			queryClient.invalidateQueries({ queryKey: ["opns-listings"] }),
			queryClient.invalidateQueries({ queryKey: ["market-flow"] }),
		]);
		router.refresh();
	}, [queryClient, refreshBalance, router]);

	if (isInitializing || namesQuery.isLoading) {
		return (
			<div
				className="flex items-center justify-center py-12 text-muted-foreground"
				role="status"
			>
				<Loader2 className="mr-2 size-5 animate-spin" />
				Loading owned names…
			</div>
		);
	}

	if (!isInitialized || !oneSatContext) {
		return (
			<div className="rounded-md border p-8 text-center">
				<p className="text-muted-foreground">
					Connect or unlock a wallet to view its OpNS basket.
				</p>
				<Button asChild className="mt-4" variant="outline">
					<Link href="/wallet">Connect wallet</Link>
				</Button>
			</div>
		);
	}

	const names = namesQuery.data?.outputs ?? [];
	const total = namesQuery.data?.totalOutputs ?? names.length;
	const marketAvailable =
		stackFeatures.data?.capabilities.has("market") ?? false;

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<p className="text-sm text-muted-foreground">
						Wallet-owned OpNS basket rows. Every action revalidates the row
						before requesting authorization.
					</p>
					{!ORDLOCK_LISTING_CREATE ? (
						<p className="mt-1 text-xs text-amber-300" role="status">
							{LISTING_CREATE_OFF}
						</p>
					) : (
						!marketAvailable &&
						!stackFeatures.isPending && (
							<p className="mt-1 text-xs text-amber-300" role="status">
								New listings are disabled because Market capability is
								unavailable. Existing wallet OrdLock cancellation remains
								available.
							</p>
						)
					)}
				</div>
				<div className="flex gap-2">
					<Button asChild variant="outline">
						<Link href="/opns">Discover names</Link>
					</Button>
					<Button
						variant="outline"
						disabled={namesQuery.isFetching}
						onClick={() => void refresh()}
					>
						<RefreshCw
							className={`mr-2 size-4 ${namesQuery.isFetching ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
				</div>
			</div>

			{namesQuery.isError ? (
				<p
					className="rounded-md border border-destructive/50 p-4 text-sm text-destructive"
					role="alert"
				>
					The active wallet could not list its OpNS basket. Retry without
					changing providers.
				</p>
			) : names.length === 0 ? (
				<div className="rounded-md border p-8 text-center text-muted-foreground">
					No OpNS names are present in this wallet.
				</div>
			) : (
				<div className="divide-y rounded-md border">
					{names.map((output) => {
						const id = opnsAssetId(output);
						const listed = isOpnsListed(output);
						const published = isOpnsPublished(output);
						return (
							<div key={output.outpoint} className="space-y-3 p-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="font-medium">{ownedOpnsName(output)}</p>
										<p className="break-all font-mono text-xs text-muted-foreground">
											{getDisplayOutpoint(output)}
										</p>
									</div>
									<div className="flex gap-2">
										<Badge variant={published ? "default" : "outline"}>
											{published ? "Published" : "Unpublished"}
										</Badge>
										{listed && (
											<Badge variant="secondary">Wallet OrdLock</Badge>
										)}
									</div>
								</div>
								{!id && (
									<p className="text-sm text-destructive" role="alert">
										This row has no canonical asset ID and cannot be changed.
									</p>
								)}
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={!id || listed}
										onClick={() =>
											setAction({
												kind: published ? "unpublish" : "publish",
												output,
											})
										}
									>
										{published ? "Unpublish" : "Publish profile"}
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={!id || listed}
										onClick={() => setAction({ kind: "send", output })}
									>
										Send
									</Button>
									{listed ? (
										<Button
											size="sm"
											variant="outline"
											disabled={!id}
											onClick={() => setAction({ kind: "cancel", output })}
										>
											Cancel listing
										</Button>
									) : (
										ORDLOCK_LISTING_CREATE && (
											<Button
												size="sm"
												variant="outline"
												disabled={!id || !marketAvailable}
												onClick={() => setAction({ kind: "sell", output })}
											>
												List for sale
											</Button>
										)
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{total > PAGE_SIZE && (
				<div className="flex items-center justify-between">
					<Button
						variant="outline"
						disabled={offset === 0}
						onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
					>
						Previous
					</Button>
					<span className="text-sm text-muted-foreground">
						{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
					</span>
					<Button
						variant="outline"
						disabled={offset + PAGE_SIZE >= total}
						onClick={() => setOffset(offset + PAGE_SIZE)}
					>
						Next
					</Button>
				</div>
			)}

			{action && (
				<OpnsActionDialog
					kind={action.kind}
					output={action.output}
					open
					onOpenChange={(open) => {
						if (!open) setAction(null);
					}}
					onSuccess={refresh}
				/>
			)}
		</div>
	);
}
