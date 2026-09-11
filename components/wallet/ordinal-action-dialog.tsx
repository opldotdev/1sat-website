"use client";

import type { WalletOutput } from "@1sat/actions";
import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSound } from "@/hooks/use-sound";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import { reportDiagnostic } from "@/lib/runtime-diagnostics";
import {
	executeOrdinalOperation,
	type OrdinalDestinationKind,
	type OrdinalOperation,
	ordinalActionFailureMessage,
	ordinalAssetId,
	parseSatoshiPrice,
	validateOrdinalDestination,
} from "@/lib/wallet/ordinal-actions";
import { getDisplayOutpoint, getName } from "@/lib/wallet/wallet-output-utils";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

export type OrdinalActionKind = "send" | "burn" | "sell" | "cancel";

interface OrdinalActionDialogProps {
	kind: OrdinalActionKind;
	ordinals: WalletOutput[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => Promise<void> | void;
}

const TITLES: Record<OrdinalActionKind, string> = {
	send: "Send ordinals",
	burn: "Permanently burn ordinals",
	sell: "List ordinal for sale",
	cancel: "Cancel ordinal listing",
};

export function OrdinalActionDialog({
	kind,
	ordinals,
	open,
	onOpenChange,
	onSuccess,
}: OrdinalActionDialogProps) {
	const { oneSatContext, chain } = useWalletToolbox();
	const { play } = useSound();
	const [destinationKind, setDestinationKind] =
		useState<OrdinalDestinationKind>("address");
	const [destination, setDestination] = useState("");
	const [price, setPrice] = useState("");
	const [burnConfirmation, setBurnConfirmation] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const ids = useMemo(
		() => ordinals.map(ordinalAssetId).filter((id): id is string => !!id),
		[ordinals],
	);
	const hasCompleteIds =
		ids.length === ordinals.length && new Set(ids).size === ids.length;
	const satoshiPrice = parseSatoshiPrice(price);
	const destinationIsValid = validateOrdinalDestination(
		destination,
		destinationKind,
		chain,
	);
	const sellEnabled = ORDLOCK_LISTING_CREATE && kind === "sell";
	const canSubmit =
		!!oneSatContext &&
		hasCompleteIds &&
		!busy &&
		((kind === "send" && destinationIsValid) ||
			(kind === "burn" && burnConfirmation === "BURN") ||
			(sellEnabled && satoshiPrice !== null) ||
			kind === "cancel");

	const reset = useCallback(() => {
		setDestinationKind("address");
		setDestination("");
		setPrice("");
		setBurnConfirmation("");
		setError(null);
	}, []);

	const setOpen = useCallback(
		(next: boolean) => {
			if (!next && !busy) reset();
			onOpenChange(next);
		},
		[busy, onOpenChange, reset],
	);

	const run = useCallback(async () => {
		if (!oneSatContext || !hasCompleteIds || ordinals.length === 0) {
			setError(
				"This selection is no longer actionable. Refresh and select the ordinals again.",
			);
			return;
		}
		let operation: OrdinalOperation;
		if (kind === "send") {
			if (!destinationIsValid) {
				setError(
					destinationKind === "address"
						? `Enter a valid ${chain}net P2PKH address.`
						: "Enter a valid compressed BSV identity public key.",
				);
				return;
			}
			operation = {
				kind,
				ids,
				destinationKind,
				destination: destination.trim(),
			} as const;
		} else if (kind === "burn") {
			if (burnConfirmation !== "BURN") return;
			operation = { kind, ids } as const;
		} else if (kind === "sell") {
			if (!ORDLOCK_LISTING_CREATE) {
				setError(LISTING_CREATE_OFF);
				return;
			}
			if (satoshiPrice === null || ids.length !== 1) {
				setError("Enter a positive whole-satoshi price for one ordinal.");
				return;
			}
			operation = { kind, id: ids[0], price: satoshiPrice } as const;
		} else {
			if (ids.length !== 1) {
				setError("Select one active listing to cancel.");
				return;
			}
			operation = { kind, id: ids[0] } as const;
		}

		setBusy(true);
		setError(null);
		try {
			const result = await executeOrdinalOperation(oneSatContext, operation);
			if (result.error) throw new Error(result.error);
			play("success");
			await onSuccess();
			reset();
			onOpenChange(false);
		} catch (cause) {
			reportDiagnostic({
				category: "action",
				code: "action.failed",
				operation: `wallet.ordinal.${kind}`,
				recoverable: true,
				context: { retryable: true },
			});
			setError(ordinalActionFailureMessage(cause));
			play("error");
		} finally {
			setBusy(false);
		}
	}, [
		burnConfirmation,
		chain,
		destination,
		destinationIsValid,
		destinationKind,
		hasCompleteIds,
		ids,
		kind,
		onOpenChange,
		onSuccess,
		oneSatContext,
		ordinals.length,
		play,
		reset,
		satoshiPrice,
	]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!busy}
			>
				<DialogHeader>
					<DialogTitle>{TITLES[kind]}</DialogTitle>
					<DialogDescription>
						Review {ordinals.length} selected ordinal
						{ordinals.length === 1 ? "" : "s"} before asking the active wallet
						to authorize the transaction.
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-3 text-xs">
					{ordinals.map((ordinal) => (
						<div key={ordinal.outpoint}>
							<span className="font-medium">
								{getName(ordinal) ?? "Ordinal"}
							</span>
							<span className="ml-2 break-all font-mono text-muted-foreground">
								{getDisplayOutpoint(ordinal)}
							</span>
						</div>
					))}
				</div>

				{!hasCompleteIds && (
					<p className="text-sm text-destructive" role="alert">
						At least one ordinal is missing its wallet asset ID. Refresh before
						continuing.
					</p>
				)}

				{kind === "send" && (
					<div className="space-y-3">
						<fieldset className="grid grid-cols-2 gap-2">
							<legend className="sr-only">Destination type</legend>
							<Button
								type="button"
								variant={destinationKind === "address" ? "default" : "outline"}
								onClick={() => setDestinationKind("address")}
							>
								P2PKH address
							</Button>
							<Button
								type="button"
								variant={
									destinationKind === "counterparty" ? "default" : "outline"
								}
								onClick={() => setDestinationKind("counterparty")}
							>
								Identity key
							</Button>
						</fieldset>
						<div className="space-y-2">
							<Label htmlFor="ordinal-destination">
								{destinationKind === "address"
									? `${chain}net P2PKH address`
									: "Compressed identity public key"}
							</Label>
							<Input
								id="ordinal-destination"
								autoComplete="off"
								spellCheck={false}
								value={destination}
								onChange={(event) => setDestination(event.target.value)}
							/>
						</div>
					</div>
				)}

				{kind === "sell" &&
					(ORDLOCK_LISTING_CREATE ? (
						<div className="space-y-2">
							<Label htmlFor="ordinal-price">Price (satoshis)</Label>
							<Input
								id="ordinal-price"
								inputMode="numeric"
								placeholder="Whole satoshis only"
								value={price}
								onChange={(event) => setPrice(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								The integer shown here is passed unchanged to the OrdLock
								action.
							</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground" role="status">
							{LISTING_CREATE_OFF}
						</p>
					))}

				{kind === "burn" && (
					<div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
						<p className="text-sm font-medium text-destructive">
							Burning is permanent. Every ordinal listed above will be
							destroyed.
						</p>
						<Label htmlFor="ordinal-burn-confirmation">
							Type BURN to confirm all {ordinals.length} item
							{ordinals.length === 1 ? "" : "s"}
						</Label>
						<Input
							id="ordinal-burn-confirmation"
							autoComplete="off"
							value={burnConfirmation}
							onChange={(event) => setBurnConfirmation(event.target.value)}
						/>
					</div>
				)}

				{kind === "cancel" && (
					<p className="text-sm text-muted-foreground">
						This creates a transaction that returns the listed ordinal to the
						wallet basket.
					</p>
				)}

				{error && (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => setOpen(false)}
					>
						Keep selection
					</Button>
					<Button
						type="button"
						variant={kind === "burn" ? "destructive" : "default"}
						disabled={!canSubmit}
						onClick={() => void run()}
					>
						{busy && <Loader2 className="mr-2 size-4 animate-spin" />}
						{busy ? "Waiting for wallet…" : TITLES[kind]}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
