"use client";

import {
	cancelOrdinalListing,
	createContext,
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

import { useSound } from "@/hooks/use-sound";
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
	const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
	const [error, setError] = useState("");

	const listed = isListed(ordinal);

	const run = useCallback(async () => {
		if (!wallet || !depositAddress) return;
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
				: (() => {
						throw new Error(
							"Listing creation is deprecated pending a replacement contract. Existing listings can still be cancelled or bought.",
						);
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
		play,
		refreshBalance,
		onOpenChange,
	]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>
						{listed ? "Cancel listing" : "List for sale"}
					</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<p className="text-xs font-mono text-muted-foreground break-all">
						{ordinal.outpoint}
					</p>
					{!listed && (
						<p className="text-xs text-muted-foreground">
							Listing creation is deprecated pending a replacement contract.
							Existing listings can still be cancelled or bought.
						</p>
					)}
					{error && (
						<p className="text-xs text-destructive break-all" role="alert">
							{error}
						</p>
					)}
					<Button
						onClick={run}
						disabled={status === "busy" || !listed}
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
				</div>
			</DialogContent>
		</Dialog>
	);
};
