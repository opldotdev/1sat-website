"use client";

import { useCancelListedOnLoad } from "@/providers/hooks/use-cancel-listed-on-load";

export function ListedCancelBanner() {
	const { status, pending, cancelled, failed } = useCancelListedOnLoad();

	if (status === "idle") return null;

	const message =
		status === "running"
			? `Cancelling ${pending} OrdLock listing${pending === 1 ? "" : "s"}…`
			: status === "error"
				? `Cancelled ${cancelled} OrdLock listing${cancelled === 1 ? "" : "s"}; ${failed} failed. Buy and cancel remain available.`
				: `Cancelled ${cancelled} OrdLock listing${cancelled === 1 ? "" : "s"} on load.`;

	return (
		<div
			className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
			role="status"
		>
			{message}
		</div>
	);
}
