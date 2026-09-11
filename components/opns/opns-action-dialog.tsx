"use client";

import type { WalletOutput } from "@1sat/actions";
import { Loader2, RefreshCw } from "lucide-react";
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
import { formatSatoshisAsBsv } from "@/components/wallet/wallet-home-utils";
import { useSound } from "@/hooks/use-sound";
import {
	executeOwnedOpnsOperation,
	isOpnsListed,
	isOpnsPublished,
	type OpnsOwnedOperation,
	opnsAssetId,
	opnsFailureMessage,
	ownedOpnsName,
	requireCurrentOwnedOpns,
} from "@/lib/opns";
import {
	LISTING_CREATE_OFF,
	ORDLOCK_LISTING_CREATE,
} from "@/lib/ordlock-listing";
import { reportDiagnostic } from "@/lib/runtime-diagnostics";
import {
	type OrdinalDestinationKind,
	parseSatoshiPrice,
	validateOrdinalDestination,
} from "@/lib/wallet/ordinal-actions";
import { getDisplayOutpoint } from "@/lib/wallet/wallet-output-utils";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

export type OpnsActionKind =
	| "publish"
	| "unpublish"
	| "send"
	| "sell"
	| "cancel";

const titles: Record<OpnsActionKind, string> = {
	publish: "Publish OpNS profile",
	unpublish: "Unpublish OpNS profile",
	send: "Send OpNS name",
	sell: "List OpNS name",
	cancel: "Cancel OpNS listing",
};

interface OpnsActionDialogProps {
	kind: OpnsActionKind;
	output: WalletOutput;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => Promise<void> | void;
}

function validAvatarOutpoint(value: string): boolean {
	if (!value.trim()) return true;
	const match = value.trim().match(/^([0-9a-f]{64})[._](\d+)$/i);
	if (!match) return false;
	const vout = Number(match[2]);
	return Number.isSafeInteger(vout) && vout >= 0 && vout <= 0xffffffff;
}

export function OpnsActionDialog({
	kind,
	output,
	open,
	onOpenChange,
	onSuccess,
}: OpnsActionDialogProps) {
	const { oneSatContext, chain } = useWalletToolbox();
	const { play } = useSound();
	const [stage, setStage] = useState<"edit" | "review" | "busy" | "success">(
		"edit",
	);
	const [profileName, setProfileName] = useState("");
	const [avatar, setAvatar] = useState("");
	const [destinationKind, setDestinationKind] =
		useState<OrdinalDestinationKind>("address");
	const [destination, setDestination] = useState("");
	const [price, setPrice] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [stale, setStale] = useState(false);
	const [txid, setTxid] = useState<string | null>(null);

	const id = opnsAssetId(output);
	const name = ownedOpnsName(output);
	const outpoint = getDisplayOutpoint(output);
	const satoshiPrice = parseSatoshiPrice(price);
	const destinationValid = validateOrdinalDestination(
		destination,
		destinationKind,
		chain,
	);
	const fieldsValid = useMemo(() => {
		switch (kind) {
			case "publish":
				return validAvatarOutpoint(avatar);
			case "send":
				return destinationValid;
			case "sell":
				return (
					ORDLOCK_LISTING_CREATE &&
					satoshiPrice !== null &&
					!isOpnsListed(output)
				);
			case "cancel":
				return isOpnsListed(output);
			case "unpublish":
				return true;
		}
	}, [avatar, destinationValid, kind, output, satoshiPrice]);

	const reset = useCallback(() => {
		setStage("edit");
		setProfileName("");
		setAvatar("");
		setDestinationKind("address");
		setDestination("");
		setPrice("");
		setError(null);
		setStale(false);
		setTxid(null);
	}, []);

	const setOpen = (next: boolean) => {
		if (stage === "busy") return;
		if (!next) reset();
		onOpenChange(next);
	};

	const operation = (): OpnsOwnedOperation | null => {
		if (!id || !fieldsValid) return null;
		switch (kind) {
			case "publish":
				return {
					kind,
					id,
					profileName: profileName.trim() || undefined,
					avatar: avatar.trim().replace(".", "_") || undefined,
				};
			case "unpublish":
				return { kind, id };
			case "send":
				return {
					kind,
					id,
					...(destinationKind === "address"
						? { address: destination.trim() }
						: { counterparty: destination.trim() }),
				};
			case "sell":
				if (!ORDLOCK_LISTING_CREATE) return null;
				return { kind, id, price: satoshiPrice as number };
			case "cancel":
				return { kind, id };
		}
	};

	const run = async () => {
		const request = operation();
		if (!oneSatContext || !request || !id) return;
		setStage("busy");
		setError(null);
		setStale(false);
		try {
			const current = await requireCurrentOwnedOpns(
				oneSatContext,
				id,
				output.outpoint,
			);
			if (
				!current ||
				isOpnsListed(current) !== isOpnsListed(output) ||
				isOpnsPublished(current) !== isOpnsPublished(output)
			) {
				setStale(true);
				setError(
					"This wallet name changed after review. Refresh it before continuing.",
				);
				setStage("review");
				return;
			}
			const result = await executeOwnedOpnsOperation(oneSatContext, request);
			if (result.error) throw new Error(result.error);
			setTxid(result.txid ?? "submitted");
			setStage("success");
			play("success");
			await onSuccess();
		} catch (cause) {
			reportDiagnostic({
				category: "action",
				code: "action.failed",
				operation: `wallet.opns.${kind}`,
				recoverable: true,
				context: { retryable: true },
			});
			setError(opnsFailureMessage(cause));
			setStage("review");
			play("error");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent showCloseButton={stage !== "busy"}>
				<DialogHeader>
					<DialogTitle>{titles[kind]}</DialogTitle>
					<DialogDescription>
						The wallet record is checked again after review and before the
						authorization request.
					</DialogDescription>
				</DialogHeader>

				<div className="rounded-md border p-3">
					<p className="font-medium">{name}</p>
					<p className="break-all font-mono text-xs text-muted-foreground">
						{outpoint}
					</p>
				</div>

				{stage === "edit" && (
					<div className="space-y-4">
						{kind === "publish" && (
							<>
								<div className="space-y-2">
									<Label htmlFor="opns-profile-name">
										Display name (optional)
									</Label>
									<Input
										id="opns-profile-name"
										maxLength={80}
										value={profileName}
										onChange={(event) => setProfileName(event.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="opns-avatar">
										Avatar origin (optional txid_vout)
									</Label>
									<Input
										id="opns-avatar"
										className="font-mono"
										value={avatar}
										onChange={(event) => setAvatar(event.target.value)}
									/>
									{!validAvatarOutpoint(avatar) && (
										<p className="text-sm text-destructive" role="alert">
											Enter a valid ordinal origin outpoint.
										</p>
									)}
								</div>
							</>
						)}

						{kind === "send" && (
							<>
								<fieldset className="grid grid-cols-2 gap-2">
									<legend className="sr-only">Destination type</legend>
									<Button
										type="button"
										variant={
											destinationKind === "address" ? "default" : "outline"
										}
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
									<Label htmlFor="opns-destination">
										{destinationKind === "address"
											? `${chain}net P2PKH address`
											: "Compressed identity public key"}
									</Label>
									<Input
										id="opns-destination"
										className="font-mono"
										value={destination}
										onChange={(event) => setDestination(event.target.value)}
									/>
								</div>
							</>
						)}

						{kind === "sell" &&
							(ORDLOCK_LISTING_CREATE ? (
								<div className="space-y-2">
									<Label htmlFor="opns-price">Listing price (satoshis)</Label>
									<Input
										id="opns-price"
										inputMode="numeric"
										value={price}
										onChange={(event) => setPrice(event.target.value)}
									/>
									{price && satoshiPrice === null && (
										<p className="text-sm text-destructive" role="alert">
											Enter a positive whole-satoshi price within the safe
											integer range.
										</p>
									)}
								</div>
							) : (
								<p className="text-sm text-muted-foreground" role="status">
									{LISTING_CREATE_OFF}
								</p>
							))}
					</div>
				)}

				{stage === "review" && (
					<div className="space-y-3">
						<dl className="grid grid-cols-[1fr_auto] gap-2 rounded-md border p-3 text-sm">
							<dt>Action</dt>
							<dd>{titles[kind]}</dd>
							{kind === "sell" && satoshiPrice !== null && (
								<>
									<dt>Public listing price</dt>
									<dd className="font-mono">
										{satoshiPrice.toLocaleString()} sats (
										{formatSatoshisAsBsv(satoshiPrice)} BSV)
									</dd>
								</>
							)}
							{kind === "send" && (
								<>
									<dt>Destination</dt>
									<dd className="max-w-64 break-all text-right font-mono text-xs">
										{destination}
									</dd>
								</>
							)}
							<dt>Network fee</dt>
							<dd className="text-right text-muted-foreground">
								Set by the wallet; this action exposes no quote
							</dd>
						</dl>
						{error && (
							<div className="space-y-2" role="alert">
								<p className="text-sm text-destructive">{error}</p>
								{stale && (
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() =>
											void Promise.resolve(onSuccess()).then(() =>
												setOpen(false),
											)
										}
									>
										<RefreshCw className="mr-2 size-4" />
										Refresh wallet row
									</Button>
								)}
							</div>
						)}
					</div>
				)}

				{stage === "busy" && (
					<div className="flex items-center justify-center py-8" role="status">
						<Loader2 className="mr-2 size-5 animate-spin" />
						Revalidating and waiting for the wallet…
					</div>
				)}

				{stage === "success" && (
					<div className="space-y-2 text-sm text-primary" role="status">
						<p>Action submitted successfully.</p>
						{txid && txid !== "submitted" && (
							<p className="break-all font-mono text-xs">{txid}</p>
						)}
					</div>
				)}

				<DialogFooter>
					{stage === "edit" && (
						<>
							<Button
								type="button"
								variant="outline"
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button
								type="button"
								disabled={!fieldsValid || !id}
								onClick={() => setStage("review")}
							>
								Review
							</Button>
						</>
					)}
					{stage === "review" && (
						<>
							<Button
								type="button"
								variant="outline"
								onClick={() => setStage("edit")}
							>
								Back
							</Button>
							<Button
								type="button"
								disabled={stale || !oneSatContext}
								onClick={() => void run()}
							>
								Authorize in wallet
							</Button>
						</>
					)}
					{stage === "success" && (
						<Button type="button" onClick={() => setOpen(false)}>
							Done
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
