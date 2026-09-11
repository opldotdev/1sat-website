"use client";

import { PrivateKey } from "@bsv/sdk";
import { computed, effect, useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import type { Utxo } from "js-1sat-ord";
import {
	type CreateOrdTokenListingsConfig,
	createOrdTokenListings,
	type NewTokenListing,
	TokenType,
	type TokenUtxo,
} from "js-1sat-ord";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { API_HOST, toastErrorProps } from "@/constants";
import { bsv20Balances, ordPk, payPk, utxos } from "@/signals/wallet";
import { fundingAddress, ordAddress } from "@/signals/wallet/address";
import type { BSV20TXO } from "@/types/ordinals";
import type { PendingTransaction } from "@/types/preview";
import { getUtxos } from "@/utils/address";
import * as http from "@/utils/httpClient";
import { useIDBStorage } from "@/utils/storage";
import type { MarketData } from "./list";
import { showAddListingModal } from "./tokenMarketTabs";

const ListingForm = ({
	initialPrice,
	ticker,
	listedCallback,
}: {
	ticker: Partial<MarketData>;
	initialPrice: string;
	listedCallback: () => void;
}) => {
	useSignals();

	const [_pendingTxs, setPendingTxs] = useIDBStorage<PendingTransaction[]>(
		"1sat-pts",
		[],
	);
	const router = useRouter();
	const listingPrice = useSignal<string | null>(null);
	const listingAmount = useSignal<string | null>(null);

	const priceInputRef = useRef<HTMLInputElement>(null);
	const amountInputRef = useRef<HTMLInputElement>(null);
	const [mounted, setMounted] = useState(false);

	// set initial price
	useEffect(() => {
		if (initialPrice && !listingPrice.value) {
			listingPrice.value = initialPrice;
		}
	}, [initialPrice, listingPrice.value]);

	const confirmedBalance = computed(() => {
		return (
			bsv20Balances.value?.find(
				(b) =>
					(b.tick && b.tick === ticker.tick) || (b.id && b.id === ticker.id),
			)?.all.confirmed || 0
		);
	});

	const pendingBalance = computed(() => {
		return (
			bsv20Balances.value?.find(
				(b) =>
					(b.tick && b.tick === ticker.tick) || (b.id && b.id === ticker.id),
			)?.all.pending || 0
		);
	});

	const listedBalance = computed(() => {
		return (
			bsv20Balances.value?.find(
				(b) =>
					(b.tick && b.tick === ticker.tick) || (b.id && b.id === ticker.id),
			)?.listed.confirmed || 0
		);
	});

	const pendingListedBalance = computed(() => {
		return (
			bsv20Balances.value?.find(
				(b) =>
					(b.tick && b.tick === ticker.tick) || (b.id && b.id === ticker.id),
			)?.listed.pending || 0
		);
	});

	const dec = computed(() => {
		return (
			bsv20Balances.value?.find(
				(b) =>
					(b.tick && b.tick === ticker.tick) || (b.id && b.id === ticker.id),
			)?.dec || 0
		);
	});

	// useEffect(() => {
	//   console.log({ amt: listingAmount.value });
	// }, [listingAmount]);

	const listBsv20 = useCallback(
		async (
			tokens: number,
			utxos: Utxo[],
			inputTokens: BSV20TXO[], //
			paymentPk: PrivateKey,
			changeAddress: string,
			ordPk: PrivateKey,
			ordAddress: string,
			payAddress: string,
			satoshisPayout: number,
			indexerAddress: string,
		): Promise<PendingTransaction> => {
			const listing: NewTokenListing = {
				payAddress,
				price: satoshisPayout,
				ordAddress,
				tokens,
			};

			const additionalPayments = [];
			if (indexerAddress) {
				additionalPayments.push({
					to: indexerAddress,
					amount: 2000, // 1000 * 2 inscriptions
				});
			}

			console.log({ inputTokens });
			const config: CreateOrdTokenListingsConfig = {
				utxos,
				listings: [listing],
				paymentPk,
				ordPk,
				protocol: ticker.tick ? TokenType.BSV20 : TokenType.BSV21,
				tokenID: (ticker.tick || ticker.id) as string,
				changeAddress,
				inputTokens: inputTokens.map(
					(i) =>
						({
							amt: i.amt,
							id: i.tick ? i.tick : i.id,
							satoshis: i.satoshis,
							script: i.script,
							vout: i.vout,
							txid: i.txid,
						}) as TokenUtxo,
				),
				tokenChangeAddress: ordAddress,
				additionalPayments,
				decimals: ticker.dec || 0,
			};

			// ORDLOCK_LISTING_DISABLED — restore when the replacement listing contract ships.
			throw new Error(
				"Listing creation is deprecated pending a replacement contract. Existing listings can still be cancelled or bought.",
			);
			const { tx, spentOutpoints, tokenChange, payChange } =
				await createOrdTokenListings(config);

			return {
				rawTx: tx.toHex(),
				size: tx.toBinary().length,
				fee: tx.getFee(),
				numInputs: tx.inputs.length,
				numOutputs: tx.outputs.length,
				txid: tx.id("hex"),
				spentOutpoints,
				marketFee: 0,
				tokenChange,
				payChange,
			};
		},
		[ticker],
	);

	const submit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			console.log(
				"create listing",
				ticker,
				{ price: listingPrice.value },
				{ amount: listingAmount.value },
			);
			if (
				!ticker.fundAddress ||
				!utxos.value ||
				!payPk.value ||
				!ordPk.value ||
				!fundingAddress.value ||
				!ordAddress.value
			) {
				toast.error("Missing wallet requirement", toastErrorProps);
				return;
			}
			if (!listingPrice.value || !listingAmount.value) {
				toast.error("Missing listing price or amount", toastErrorProps);
				return;
			}
			const paymentPk = PrivateKey.fromWif(payPk.value);
			const ordinalPk = PrivateKey.fromWif(ordPk.value);

			// [{"txid":"69a5956ee1cad8056f0c4d6ca4f87766080b36a75f2192d2cf75f1f668f446d6","vout":2,"outpoint":"69a5956ee1cad8056f0c4d6ca4f87766080b36a75f2192d2cf75f1f668f446d6_2","height":828275,"idx":1162,"op":"transfer","amt":"10000","status":1,"reason":null,"listing":false,"owner":"139xRf73Vw3W8cMNoXW9amqZfXMrEuM9XQ","spend":"","spendHeight":null,"spendIdx":null,"tick":"PEPE","id":null,"price":"0","pricePer":"0","payout":null,"script":"dqkUF6HYh83S8XxpORgFL3VFy4fwqDSIrABjA29yZFESYXBwbGljYXRpb24vYnN2LTIwADp7InAiOiJic3YtMjAiLCJvcCI6InRyYW5zZmVyIiwidGljayI6IlBFUEUiLCJhbXQiOiIxMDAwMCJ9aA==","sale":false}]

			// setPendingTransaction(pendingTx);

			try {
				let url = `${API_HOST}/api/bsv20/${ordAddress.value}/tick/${ticker.tick}?listing=false`;
				if (ticker.id) {
					url = `${API_HOST}/api/bsv20/${ordAddress.value}/id/${ticker.id}?listing=false`;
				}
				// console.log({ url });
				const { promise } = http.customFetch<BSV20TXO[]>(url);

				const u = await promise;
				const satoshisPayout = Math.ceil(
					Number.parseFloat(listingPrice.value) *
						Number.parseFloat(listingAmount.value),
				);
				const indexerAddress = ticker.fundAddress;
				// refresh utxos
				utxos.value = await getUtxos(fundingAddress.value);

				if (listingAmount.value > Number.MAX_SAFE_INTEGER.toString()) {
					throw new Error("listing amount too large");
				}

				const pendingTx = await listBsv20(
					Number(listingAmount.value),
					utxos.value,
					u,
					paymentPk,
					fundingAddress.value,
					ordinalPk,
					ordAddress.value,
					fundingAddress.value,
					satoshisPayout,
					indexerAddress,
				);

				setPendingTxs([pendingTx]);

				router.push("/preview");
			} catch (e) {
				console.log({ e });
			}
			// const ordUtxo = await getUtxoByOutpoint(selectedItem.origin.outpoint);
			// if (!ordUtxo) {
			//   // TODO: show error
			//   return;
			// }
		},
		[
			ticker,
			listingPrice.value,
			listingAmount.value,
			utxos.value,
			payPk.value,
			ordPk.value,
			fundingAddress.value,
			ordAddress.value,
			listBsv20,
			setPendingTxs,
			router,
		],
	);

	const listDisabled = useMemo(
		() =>
			!listingAmount.value ||
			!listingPrice.value ||
			Number.parseFloat(listingAmount.value || "0") === 0 ||
			listingPrice.value === "0" ||
			Number.parseFloat(amountInputRef.current?.value || "0") >
				confirmedBalance.value / 10 ** dec.value -
					listedBalance.value / 10 ** dec.value,
		[
			listingAmount.value,
			listingPrice.value,
			confirmedBalance.value,
			dec.value,
			listedBalance.value,
		],
	);

	useEffect(() => {
		console.log("set mounted");
		setMounted(true);
	}, []);

	// autofocus without using the autoFocus property
	effect(() => {
		if (
			mounted &&
			showAddListingModal.value !== null &&
			amountInputRef.current
		) {
			// check which element is currently focused
			const activeElement = document.activeElement as HTMLElement;
			// console.log({ activeElement });
			// check if the element if visible
			if (
				amountInputRef.current.getBoundingClientRect().top <
					window.innerHeight &&
				activeElement !== amountInputRef.current &&
				activeElement !== priceInputRef.current
			) {
				amountInputRef.current.focus();
			}
		}
	});

	return (
		<div className="h-60 w-full">
			<form action="dialog">
				<div
					className="text-center text-xl font-semibold cursor-pointer"
					onClick={(e) => {
						e.preventDefault();
						const convertedValue = confirmedBalance.value / 10 ** dec.value;
						listingAmount.value = convertedValue.toString() || null;
					}}
				>
					Balance:{" "}
					{(confirmedBalance.value - listedBalance.value) / 10 ** dec.value}{" "}
					{pendingBalance.value > 0
						? `(${pendingBalance.value / 10 ** dec.value} pending)`
						: ""}
					{pendingListedBalance.value > 0
						? `(-${pendingListedBalance.value / 10 ** dec.value} pending)`
						: ""}
				</div>
				<div className="form-control w-full">
					<label className="label">
						<span className="label-text">Amount</span>
					</label>
					<input
						ref={amountInputRef}
						type="number"
						placeholder="0"
						className="input input-sm input-bordered"
						onChange={(e) => {
							// make sure amount respects decimals
							const dec = ticker.dec || 0;
							if (e.target.value.includes(".")) {
								const parts = e.target.value.split(".");
								if (parts.length > 2) {
									return;
								}
								if (parts[1].length > dec) {
									return;
								}
							}
							listingAmount.value = e.target.value;
						}}
						value={listingAmount.value || undefined}
						max={confirmedBalance.value}
					/>
				</div>
				<div className="form-control w-full">
					<label className="label flex items-center justify-between">
						<span className="label-text">Price per token</span>
						<span className="text-[#555]">Sats</span>
					</label>
					<input
						ref={priceInputRef}
						type="text"
						placeholder="1000"
						className="input input-sm input-bordered"
						onChange={(e) => {
							e.preventDefault();
							listingPrice.value = e.target.value;
						}}
					/>
				</div>

				<div className="flex justify-end mt-4">
					<Button
						type="button"
						size="sm"
						// make sure the balance available is enough
						disabled={listDisabled}
						onClick={submit}
					>
						{`List ${listingAmount.value || 0} ${ticker.tick || ticker.sym}`}
					</Button>
				</div>
			</form>
		</div>
	);
};

export default ListingForm;
