"use client";

import type { WalletOutput } from "@1sat/actions";
import { useQueryClient } from "@tanstack/react-query";
import {
	FileQuestion,
	FileText,
	Flame,
	RefreshCw,
	Send,
	X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArtifactModal, {
	type ArtifactModalItem,
} from "@/components/modal/artifact-modal";
import { Button } from "@/components/ui/button";
import {
	OrdinalActionDialog,
	type OrdinalActionKind,
} from "@/components/wallet/ordinal-action-dialog";
import { OrdinalsGridSkeleton } from "@/components/wallet/ordinals-grid-skeleton";
import { useOrdinalMetadata } from "@/hooks/use-ordinal-metadata";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import { isOrdinalListed, ordinalAssetId } from "@/lib/wallet/ordinal-actions";
import { getOrdinalPresentation } from "@/lib/wallet/ordinal-presentation";
import { getDisplayOutpoint } from "@/lib/wallet/wallet-output-utils";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

export function OrdinalsGrid() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const {
		ordinals,
		isInitialized,
		isInitializing,
		identityKey,
		refreshBalance,
	} = useWalletToolbox();
	const [selectedOutpoints, setSelectedOutpoints] = useState<Set<string>>(
		new Set(),
	);
	const [dialogKind, setDialogKind] = useState<OrdinalActionKind | null>(null);
	const [selectedArtifact, setSelectedArtifact] =
		useState<ArtifactModalItem | null>(null);
	const identityScopeRef = useRef(identityKey);
	const { metadataRequests, metadataQuery } = useOrdinalMetadata(
		ordinals,
		identityKey,
		isInitialized,
	);

	useEffect(() => {
		if (identityScopeRef.current === identityKey) return;
		identityScopeRef.current = identityKey;
		setSelectedOutpoints(new Set());
		setDialogKind(null);
		setSelectedArtifact(null);
	}, [identityKey]);

	const selectedOrdinals = useMemo(
		() => ordinals.filter((ordinal) => selectedOutpoints.has(ordinal.outpoint)),
		[ordinals, selectedOutpoints],
	);
	const selectionIsCurrent =
		selectedOrdinals.length === selectedOutpoints.size &&
		selectedOrdinals.every((ordinal) => ordinalAssetId(ordinal));
	const selectedListed = selectedOrdinals.filter(isOrdinalListed);
	const selectedUnlisted = selectedOrdinals.filter(
		(ordinal) => !isOrdinalListed(ordinal),
	);
	const onlyUnlisted =
		selectionIsCurrent &&
		selectedOrdinals.length > 0 &&
		selectedUnlisted.length === selectedOrdinals.length;
	const oneListed =
		selectionIsCurrent &&
		selectedOrdinals.length === 1 &&
		selectedListed.length === 1;
	const oneUnlisted =
		ORDLOCK_LISTING_CREATE && onlyUnlisted && selectedOrdinals.length === 1;

	const toggleSelection = useCallback((outpoint: string) => {
		setSelectedOutpoints((previous) => {
			const next = new Set(previous);
			if (next.has(outpoint)) next.delete(outpoint);
			else next.add(outpoint);
			return next;
		});
	}, []);

	const refresh = useCallback(async () => {
		refreshBalance();
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["wallet-balance"] }),
			queryClient.invalidateQueries({ queryKey: ["market-flow"] }),
		]);
		router.refresh();
	}, [queryClient, refreshBalance, router]);

	const actionSucceeded = useCallback(async () => {
		setSelectedOutpoints(new Set());
		await refresh();
	}, [refresh]);

	if (
		isInitializing ||
		(metadataRequests.length > 0 && metadataQuery.isPending)
	) {
		return <OrdinalsGridSkeleton />;
	}

	if (!isInitialized) {
		return (
			<div className="py-12 text-center text-muted-foreground">
				Please unlock or connect a wallet to manage your ordinals.
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h3 className="text-lg font-medium">
						{ordinals.length} Ordinal{ordinals.length === 1 ? "" : "s"}
					</h3>
					<p className="text-sm text-muted-foreground">
						{selectedOutpoints.size === 0
							? "Select one or more items to manage them."
							: `${selectedOutpoints.size} selected`}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onClick={() => void refresh()}>
						<RefreshCw className="mr-2 size-4" />
						Refresh
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!onlyUnlisted}
						onClick={() => setDialogKind("send")}
					>
						<Send className="mr-2 size-4" />
						Send
					</Button>
					{ORDLOCK_LISTING_CREATE && (
						<Button
							variant="outline"
							size="sm"
							disabled={!oneUnlisted}
							onClick={() => setDialogKind("sell")}
						>
							List
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						disabled={!oneListed}
						onClick={() => setDialogKind("cancel")}
					>
						<X className="mr-2 size-4" />
						Cancel listing
					</Button>
					<Button
						variant="destructive"
						size="sm"
						disabled={!onlyUnlisted}
						onClick={() => setDialogKind("burn")}
					>
						<Flame className="mr-2 size-4" />
						Burn
					</Button>
				</div>
			</div>

			{selectedOutpoints.size > 0 && !selectionIsCurrent && (
				<div
					className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
					role="alert"
				>
					The wallet changed after this selection was made. Refresh and select
					the items again; no action has been submitted.
				</div>
			)}

			{!ORDLOCK_LISTING_CREATE && (
				<p className="text-sm text-muted-foreground" role="status">
					{LISTING_CREATE_OFF}
				</p>
			)}

			{selectedListed.length > 0 && selectedUnlisted.length > 0 && (
				<p className="text-sm text-muted-foreground">
					Listed and unlisted ordinals cannot be submitted together. Cancel a
					listing before sending or burning it.
				</p>
			)}

			{ordinals.length === 0 ? (
				<div className="py-16 text-center text-muted-foreground">
					No ordinals found in the active wallet.
				</div>
			) : (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
					{ordinals.map((ordinal: WalletOutput) => {
						const outpoint = getDisplayOutpoint(ordinal);
						const metadata = metadataQuery.data?.[`${outpoint}:-2`];
						const presentation = getOrdinalPresentation(ordinal, metadata);
						const selected = selectedOutpoints.has(ordinal.outpoint);
						const actionable = !!ordinalAssetId(ordinal);
						return (
							<div
								key={ordinal.outpoint}
								className={`group relative aspect-square overflow-hidden rounded-lg border bg-muted/50 transition-all ${selected ? "border-primary ring-2 ring-primary/40" : "border-border/50 hover:border-primary/50"}`}
							>
								<button
									type="button"
									aria-label={`Open ${presentation.name}`}
									className="block size-full text-left"
									onClick={() =>
										setSelectedArtifact({
											outpoint,
											originOutpoint: presentation.originOutpoint,
											contentType: presentation.contentType,
											name: presentation.name,
											previewUrl: presentation.artworkUrl,
											externalUrl: presentation.href,
										})
									}
								>
									{presentation.artworkUrl ? (
										<Image
											src={presentation.artworkUrl}
											alt={presentation.name}
											fill
											className="object-cover transition-transform group-hover:scale-105"
											sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
											unoptimized
										/>
									) : (
										<div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
											{presentation.kind === "bitplan" ? (
												<FileText className="size-10" />
											) : (
												<FileQuestion className="size-10" />
											)}
											<span className="max-w-full truncate text-xs">
												{presentation.contentLabel}
											</span>
										</div>
									)}
									<div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
									<div className="absolute inset-x-0 bottom-0 p-2 text-xs text-white">
										<div className="truncate font-medium">
											{presentation.name}
										</div>
										<div className="truncate font-mono text-white/70">
											{outpoint}
										</div>
									</div>
								</button>
								<label className="absolute left-2 top-2 flex size-8 cursor-pointer items-center justify-center rounded-md bg-background/90 shadow-sm">
									<input
										type="checkbox"
										className="size-4 accent-primary"
										checked={selected}
										disabled={!actionable}
										onChange={() => toggleSelection(ordinal.outpoint)}
									/>
									<span className="sr-only">Select {presentation.name}</span>
								</label>
								{isOrdinalListed(ordinal) && (
									<span className="absolute right-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
										Listed
									</span>
								)}
								{!actionable && (
									<span className="absolute right-2 top-2 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
										Refresh required
									</span>
								)}
							</div>
						);
					})}
				</div>
			)}

			{dialogKind && (
				<OrdinalActionDialog
					kind={dialogKind}
					ordinals={selectedOrdinals}
					open
					onOpenChange={(open) => {
						if (!open) setDialogKind(null);
					}}
					onSuccess={actionSucceeded}
				/>
			)}

			<ArtifactModal
				artifact={selectedArtifact}
				onClose={() => setSelectedArtifact(null)}
			/>
		</div>
	);
}
