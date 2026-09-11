"use client";

import {
	cancelOrdinalListing,
	createContext,
	sellOrdinal,
	type WalletOutput,
} from "@1sat/actions";
import { readAssetIdTag } from "@1sat/types";
import { Loader2, Tag, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSound } from "@/hooks/use-sound";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

export const isListed = (output: WalletOutput): boolean =>
	output.tags?.includes("ordlock") ?? false;

interface ListOrdinalDialogProps {
	ordinal: WalletOutput;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export const ListOrdinalDialog = ({
	ordinal,
	open,
	onOpenChange,
}: ListOrdinalDialogProps) => {
	const { wallet, services, chain, depositAddress, refreshBalance } =
		useWalletToolbox();
	const { play } = useSound();
	const [priceBsv, setPriceBsv] = useState("");
	const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
	const [error, setError] = useState("");

	const listed = isListed(ordinal);
	const canCreate = ORDLOCK_LISTING_CREATE && !listed;

	const run = useCallback(async () => {
		if (!wallet || !depositAddress) return;
		if (!listed && !ORDLOCK_LISTING_CREATE) {
			setStatus("error");
			setError(LISTING_CREATE_OFF);
			return;
		}
		setStatus("busy");
		setError("");
		try {
			const id = readAssetIdTag(ordinal.tags);
			if (!id) throw new Error("Ordinal is missing its wallet asset ID");
			const ctx = createContext(wallet, {
				services: services ?? undefined,
				chain,
			});
			const result = listed
				? await cancelOrdinalListing.execute(ctx, { id })
				: await (() => {
						const satoshis = Math.round(
							Number.parseFloat(priceBsv) * 100_000_000,
						);
						if (!Number.isFinite(satoshis) || satoshis <= 0) {
							throw new Error("Enter a valid price");
						}
						return sellOrdinal.execute(ctx, {
							id,
							price: satoshis,
							payAddress: depositAddress,
						});
					})();
			if (result.error) {
				setStatus("error");
				setError(result.error);
				play("error");
			} else {
				play("success");
				refreshBalance?.();
				setStatus("idle");
				onOpenChange(false);
			}
		} catch (e) {
			setStatus("error");
			setError(e instanceof Error ? e.message : String(e));
			play("error");
		}
	}, [
		wallet,
		services,
		chain,
		depositAddress,
		listed,
		ordinal,
		priceBsv,
		play,
		refreshBalance,
		onOpenChange,
	]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>
						{listed
							? "Cancel listing"
							: canCreate
								? "List for sale"
								: "Listing create disabled"}
					</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<p className="text-xs font-mono text-muted-foreground break-all">
						{ordinal.outpoint}
					</p>
					{canCreate && (
						<Input
							aria-label="Listing price in BSV"
							type="number"
							min="0"
							step="0.00000001"
							placeholder="Price in BSV"
							value={priceBsv}
							onChange={(e) => setPriceBsv(e.target.value)}
						/>
					)}
					{!listed && !canCreate && (
						<p className="text-xs text-muted-foreground" role="status">
							{LISTING_CREATE_OFF}
						</p>
					)}
					{error && (
						<p className="text-xs text-destructive break-all" role="alert">
							{error}
						</p>
					)}
					{(listed || canCreate) && (
						<Button
							onClick={run}
							disabled={status === "busy" || (!listed && !priceBsv)}
							variant={listed ? "destructive" : "default"}
						>
							{status === "busy" ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									{listed ? "Cancelling..." : "Listing..."}
								</>
							) : listed ? (
								<>
									<X className="w-4 h-4 mr-2" />
									Cancel listing
								</>
							) : (
								<>
									<Tag className="w-4 h-4 mr-2" />
									List for sale
								</>
							)}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
