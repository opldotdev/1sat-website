"use client";

import { PrivateKey } from "@bsv/sdk";
import { useSignals } from "@preact/signals-react/runtime";
import type { Utxo } from "js-1sat-ord";
import { type CreateOrdListingsConfig, createOrdListings } from "js-1sat-ord";
import { head } from "lodash";
import { ArrowLeft, Info, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { toSatoshi } from "satoshi-token";
import Artifact from "@/components/artifact";
import { getOutpoints } from "@/components/OrdinalListings/helpers";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import Ordinals from "@/components/Wallet/ordinals";
import {
	type AssetType,
	ORDFS,
	SATS_PER_KB,
	toastErrorProps,
} from "@/constants";
import { ordPk, ordUtxos, payPk, usdRate, utxos } from "@/signals/wallet";
import { fundingAddress, ordAddress } from "@/signals/wallet/address";
import type { OrdUtxo } from "@/types/ordinals";
import type { PendingTransaction } from "@/types/preview";
import { useIDBStorage } from "@/utils/storage";
import { fetchOrdinal } from "@/utils/transaction";

interface NewListingPageProps {
	type: AssetType;
}

const NewListingPage: React.FC<NewListingPageProps> = ({ type }) => {
	useSignals();

	const [_pendingTxs, setPendingTxs] = useIDBStorage<PendingTransaction[]>(
		"1sat-pts",
		[],
	);
	const router = useRouter();
	const query = useSearchParams();
	const outPoint = query.get("outpoint");
	const [outpoint, setOutpoint] = useState<string | undefined>(
		outPoint as string | undefined,
	);
	const [price, setPrice] = useState<number>(0);

	const [showSelectItem, setShowSelectItem] = useState<boolean>();
	const [selectedItem, setSelectedItem] = useState<OrdUtxo>();

	const listOrdinal = useCallback(
		async (
			utxos: Utxo[],
			ordinal: OrdUtxo,
			paymentPk: PrivateKey,
			_changeAddress: string,
			ordPk: PrivateKey,
			ordAddress: string,
			payoutAddress: string,
			satoshisPayout: number,
		): Promise<PendingTransaction> => {
			const config: CreateOrdListingsConfig = {
				utxos,
				listings: [
					{
						payAddress: payoutAddress,
						price: satoshisPayout,
						ordAddress,
						listingUtxo: {
							satoshis: ordinal.satoshis,
							txid: ordinal.txid,
							vout: ordinal.vout,
							script: ordinal.script,
						},
					},
				],
				paymentPk,
				ordPk,
				satsPerKb: SATS_PER_KB,
			};

			// ORDLOCK_LISTING_DISABLED — restore when the replacement listing contract ships.
			throw new Error(
				"Listing creation is deprecated pending a replacement contract. Existing listings can still be cancelled or bought.",
			);
			const { tx, spentOutpoints, payChange } = await createOrdListings(config);

			return {
				rawTx: tx.toHex(),
				txid: tx.id("hex"),
				size: tx.toBinary().length,
				fee: tx.getFee(),
				numInputs: tx.inputs.length,
				numOutputs: tx.outputs.length,
				spentOutpoints,
				payChange,
				marketFee: 0,
			};
		},
		[],
	);

	useEffect(() => {
		const fire = async () => {
			if (outpoint) {
				const item = await fetchOrdinal(outpoint);
				// if it doesnt exist in ord utxos, add it (if its also the owner)
				if (item && item.owner === ordAddress.value) {
					ordUtxos.value = [...(ordUtxos.value || []), item];
				}
				setSelectedItem(item);
			}
		};
		if (outpoint && !selectedItem) {
			fire();
		}
	}, [ordAddress.value, ordUtxos.value, outpoint, selectedItem]);

	const submit = useCallback(async () => {
		console.log("create listing", selectedItem, price);
		if (
			!utxos.value ||
			!payPk.value ||
			!ordPk.value ||
			!fundingAddress.value ||
			!ordAddress ||
			!selectedItem?.origin?.outpoint
		) {
			return;
		}

		const paymentPk = PrivateKey.fromWif(payPk.value);
		const ordinalPk = PrivateKey.fromWif(ordPk.value);

		// TODO: Suspected problem here - passing origin to get latest, maybe getting wrong answer w wrong owner?
		const ordUtxos = await getOutpoints([selectedItem.outpoint], true);
		if (!ordUtxos?.length) {
			toast.error("Could not get item details.", toastErrorProps);
			return;
		}
		const ordUtxo = head(ordUtxos);

		if (!ordUtxo || !utxos.value || ordAddress.value !== ordUtxo.owner) {
			console.log({
				ordUtxo,
				utxos: utxos.value,
				ordAddress: ordAddress.value,
				owner: ordUtxo?.owner || "",
			});
			toast.error("Missing requirement.", toastErrorProps);
			return;
		}

		const pendingTx = await listOrdinal(
			utxos.value,
			ordUtxo,
			paymentPk,
			fundingAddress.value,
			ordinalPk,
			ordAddress.value,
			fundingAddress.value,
			price,
		);

		pendingTx.returnTo = "/market/ordinals";
		setPendingTxs([pendingTx]);

		router.push("/preview");
	}, [
		selectedItem,
		price,
		utxos.value,
		payPk.value,
		ordPk.value,
		fundingAddress.value,
		ordAddress.value,
		listOrdinal,
		setPendingTxs,
		router,
	]);

	const clickSelectItem = useCallback(() => {
		setShowSelectItem(true);
	}, []);

	const clickOrdinal = useCallback(
		async (outpoint: string) => {
			console.log("Clicked", outpoint);
			//     const items = await fetchOrdinal(outpoint);
			const ordUtxos = await getOutpoints([outpoint], true);
			const ordUtxo = head(ordUtxos);

			// console.log({ ordUtxo });
			// do not set the item if it is a listing
			if (ordUtxo) {
				if (!ordUtxo.data?.list) {
					setSelectedItem(ordUtxo);
				} else {
					toast.error("This item is already listed", toastErrorProps);
					return;
				}
			}

			setShowSelectItem(false);
			setOutpoint(outpoint);
		},
		[setSelectedItem, setShowSelectItem],
	);

	const artifact = useMemo(() => {
		// console.log({ ordUtxos: ordUtxos.value, selectedItem })
		return ordUtxos.value?.find(
			(utxo) => utxo?.origin?.outpoint === selectedItem?.origin?.outpoint,
		);
	}, [ordUtxos.value, selectedItem]);

	return (
		<div className="w-full p-4 md:p-8 font-mono bg-background">
			{/* Breadcrumb Header */}
			<div className="flex items-center justify-between mb-8">
				<button
					type="button"
					onClick={() => router.back()}
					className="flex items-center gap-2 text-muted-foreground hover:text-primary transition cursor-pointer text-xs uppercase tracking-wider"
				>
					<ArrowLeft className="w-4 h-4" />
					Back
				</button>
				<div className="text-xs uppercase tracking-widest text-muted-foreground">
					Initiate_Listing
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
				{/* Left Col: Asset Selection & Form */}
				<div className="space-y-6">
					{/* Asset Selection */}
					<div className="space-y-4">
						<Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
							Target Asset
						</Label>
						{!outpoint ? (
							<button
								type="button"
								onClick={clickSelectItem}
								className="w-full h-48 border border-dashed border-border hover:border-primary hover:bg-primary/5 transition-all group flex flex-col items-center justify-center gap-4"
							>
								<div className="w-12 h-12 border border-border flex items-center justify-center group-hover:border-primary group-hover:text-primary transition-colors">
									<Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary" />
								</div>
								<span className="font-mono text-xs uppercase tracking-widest text-muted-foreground group-hover:text-primary">
									[ Select_Source_Asset ]
								</span>
							</button>
						) : (
							<div className="border border-border bg-muted/30 p-4">
								<div className="flex items-start gap-2 text-muted-foreground">
									<Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary/50" />
									<p className="text-xs">
										Listings can be purchased on the market page or on other
										platforms. Listings can be cancelled at any time.
									</p>
								</div>
							</div>
						)}
					</div>

					{/* Price Input */}
					<div className="space-y-4">
						<Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
							Set_Price (BSV)
						</Label>
						<div className="relative group">
							<Input
								type="number"
								placeholder="0.00000000"
								className="bg-background border-border rounded-none h-12 text-lg font-mono text-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary placeholder:text-muted-foreground/30 pr-16"
								onChange={(e) => {
									if (e.target.value === "") {
										setPrice(0);
										return;
									}
									setPrice(
										toSatoshi(
											e.target.value.includes(".")
												? Number.parseFloat(e.target.value)
												: Number.parseInt(e.target.value, 10),
										),
									);
								}}
							/>
							<div className="absolute right-0 top-0 h-full w-14 flex items-center justify-center border-l border-border text-muted-foreground text-xs uppercase">
								BSV
							</div>
						</div>
					</div>

					{/* Fee Calculation */}
					{outpoint && price > 0 && usdRate.value && (
						<div className="bg-muted/30 border border-border p-4 space-y-2">
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>USD_VALUE</span>
								<span className="text-primary">
									${(price / usdRate.value).toFixed(2)}
								</span>
							</div>
						</div>
					)}

					{/* Submit Button */}
					<Button
						type="button"
						disabled={!usdRate.value || (!!outpoint && !price)}
						onClick={() => {
							if (!outpoint) {
								setShowSelectItem(true);
								return;
							}
							if (!price) {
								toast.error("Please set a price", toastErrorProps);
								return;
							}
							submit();
						}}
						className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-none h-12 text-xs font-bold tracking-widest uppercase disabled:bg-muted disabled:text-muted-foreground"
					>
						{!outpoint
							? "[ Select an Item ]"
							: !price
								? "[ Set a Price ]"
								: `[ Confirm_Listing - $${usdRate.value ? (price / usdRate.value).toFixed(2) : "0.00"} ]`}
					</Button>
				</div>

				{/* Right Col: Preview */}
				<div className="space-y-4">
					<Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
						Asset Preview
					</Label>
					{!outpoint ? (
						<div className="h-64 border border-border text-muted-foreground flex items-center justify-center text-center font-mono text-xs uppercase tracking-wider">
							Preview_Will_Display_Here
						</div>
					) : (
						<div className="border border-border bg-muted/50">
							<Artifact
								src={`${ORDFS}/${artifact?.origin?.outpoint}`}
								onClick={() => {}}
								artifact={
									artifact ||
									({
										origin: { outpoint },
									} as Partial<OrdUtxo>)
								}
								sizes={"100vw"}
								size={600}
							/>
						</div>
					)}
				</div>
			</div>

			{/* Item Selection Modal */}
			<Dialog open={showSelectItem} onOpenChange={setShowSelectItem}>
				<DialogContent className="bg-background border border-border rounded-none max-w-4xl max-h-[85vh] overflow-hidden">
					<DialogHeader className="border-b border-border pb-4">
						<DialogTitle className="font-mono text-sm uppercase tracking-widest text-primary flex items-center gap-2">
							<span className="w-2 h-2 bg-primary animate-pulse" />
							Accessing_Wallet_Inventory...
						</DialogTitle>
					</DialogHeader>

					<ScrollArea className="h-[60vh] pr-4 mt-2">
						<Ordinals onClick={clickOrdinal} />
					</ScrollArea>

					<div className="border-t border-border pt-4 flex justify-end">
						<Button
							variant="ghost"
							onClick={() => setShowSelectItem(false)}
							className="rounded-none text-xs hover:bg-muted hover:text-foreground uppercase tracking-wider"
						>
							Cancel
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
};

export default NewListingPage;

// Constants
const _oLockPrefix =
	"2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c0000";
const _oLockSuffix =
	"615179547a75537a537a537a0079537a75527a527a7575615579008763567901c161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169587951797e58797eaa577961007982775179517958947f7551790128947f77517a75517a75618777777777777777777767557951876351795779a9876957795779ac777777777777777767006868";
