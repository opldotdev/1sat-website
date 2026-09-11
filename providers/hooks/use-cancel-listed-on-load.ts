"use client";

import { useEffect, useRef, useState } from "react";
import {
	cancelListedOnLoad,
	listedCancelItems,
	loadListedOpns,
} from "@/lib/wallet/cancel-listed";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

export type ListedCancelStatus = "idle" | "running" | "done" | "error";

export interface ListedCancelState {
	status: ListedCancelStatus;
	pending: number;
	cancelled: number;
	failed: number;
}

const idle: ListedCancelState = {
	status: "idle",
	pending: 0,
	cancelled: 0,
	failed: 0,
};

export function useCancelListedOnLoad(): ListedCancelState {
	const {
		oneSatContext,
		identityKey,
		isInitialized,
		isBalanceLoading,
		ordinals,
		refreshBalance,
	} = useWalletToolbox();
	const [state, setState] = useState<ListedCancelState>(idle);
	const startedForRef = useRef<string | null>(null);
	const ordinalsRef = useRef(ordinals);
	ordinalsRef.current = ordinals;

	useEffect(() => {
		if (startedForRef.current && startedForRef.current !== identityKey) {
			startedForRef.current = null;
			setState(idle);
		}
		if (
			!isInitialized ||
			!oneSatContext ||
			!identityKey ||
			isBalanceLoading ||
			startedForRef.current === identityKey
		) {
			return;
		}
		startedForRef.current = identityKey;
		let cancelled = false;
		const run = async () => {
			try {
				const opns = await loadListedOpns(oneSatContext);
				if (cancelled) return;
				const items = listedCancelItems(ordinalsRef.current, opns);
				if (items.length === 0) return;
				setState({
					status: "running",
					pending: items.length,
					cancelled: 0,
					failed: 0,
				});
				const result = await cancelListedOnLoad(oneSatContext, items);
				if (cancelled) return;
				setState({
					status: result.failed.length > 0 ? "error" : "done",
					pending: 0,
					cancelled: result.cancelled.length,
					failed: result.failed.length,
				});
				if (result.cancelled.length > 0) refreshBalance();
			} catch {
				if (!cancelled) {
					setState({ ...idle, status: "error" });
				}
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [
		identityKey,
		isBalanceLoading,
		isInitialized,
		oneSatContext,
		refreshBalance,
	]);

	return state;
}
