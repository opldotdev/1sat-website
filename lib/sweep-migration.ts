"use client";

import {
	createContext,
	deriveDepositAddresses,
	prepareSweepInputs,
	sweepBsv,
	sweepBsv21,
	sweepOrdinals,
	type TokenBalance,
} from "@1sat/actions";
import type { IndexedOutput } from "@1sat/types";
import type { OneSatServices } from "@1sat/wallet-browser";
import { PrivateKey, type WalletInterface } from "@bsv/sdk";
import { sweepLegacyMnee } from "@/lib/sweep-legacy-mnee";

// Chunk sizes: each chunk is its own transaction, so one bad output or a
// single oversized tx can't sink an entire large sweep, and each completed
// chunk is real on-chain progress the user can see.
const FUNDING_CHUNK_SIZE = 200;
const ORDINAL_CHUNK_SIZE = 50;
const TOKEN_CHUNK_SIZE = 50;
/** Concurrent BEEF fetches during input preparation */
const PREPARE_CONCURRENCY = 6;

export interface SweepStepState {
	id: string;
	label: string;
	status: "pending" | "active" | "done" | "error";
	/** Live sub-status, e.g. "batch 2/5" or "fetching source txs 12/40" */
	detail?: string;
	txids: string[];
	error?: string;
}

export interface SweepProgress {
	message: string;
	/** 0-100, derived from completed work units — never fabricated */
	percent: number;
	steps: SweepStepState[];
}

export interface SweepResult {
	bsvTxids: string[];
	ordinalTxids: string[];
	bsv21Txids: string[];
	mneeTxid?: string;
	errors: string[];
}

export interface MigrationSweepParams {
	wallet: WalletInterface;
	services: OneSatServices;
	chain?: "main" | "test";
	legacyPayWif: string;
	legacyOrdWif: string;
	legacyIdentityWif?: string;
	onProgress: (progress: SweepProgress) => void;
	funding: IndexedOutput[];
	ordinals: IndexedOutput[];
	bsv21Tokens: TokenBalance[];
	/** MNEE balance (decimal) at the legacy addresses; > 0 triggers an MNEE sweep */
	mneeBalance?: number;
}

const getOwner = (output: IndexedOutput): string | undefined =>
	output.events?.find((e) => e.startsWith("own:"))?.slice(4);

const chunk = <T>(items: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
};

// Resolve the signing key for each output from its own: event. A missing
// key is a hard error BEFORE building the tx — signing with the wrong key
// used to fail the whole sweep with no diagnostic.
const buildKeys = (
	outputs: IndexedOutput[],
	keyMap: Map<string, PrivateKey>,
): PrivateKey[] =>
	outputs.map((output) => {
		const owner = getOwner(output);
		const key = owner ? keyMap.get(owner) : undefined;
		if (!key) {
			throw new Error(
				`No key for output ${output.outpoint} (owner: ${owner ?? "unknown"})`,
			);
		}
		return key;
	});

interface PreparedInputs {
	/** Outputs whose locking scripts were resolved, with their sweep inputs */
	prepared: {
		output: IndexedOutput;
		input: Awaited<ReturnType<typeof prepareSweepInputs>>[number];
	}[];
	/** Outputs skipped because their source tx could not be fetched */
	failures: { outpoint: string; error: string }[];
}

/**
 * Prepare sweep inputs with bounded concurrency and per-txid failure
 * isolation. prepareSweepInputs fetches BEEFs serially and throws on the
 * first failure — for old addresses with hundreds of source txs that is
 * both slow and all-or-nothing. Here each source txid is fetched
 * independently (up to PREPARE_CONCURRENCY at once); a txid that can't be
 * resolved skips only its own outputs.
 */
async function prepareInputsConcurrent(
	ctx: Parameters<typeof prepareSweepInputs>[0],
	outputs: IndexedOutput[],
	onDetail?: (done: number, total: number) => void,
): Promise<PreparedInputs> {
	const byTxid = new Map<string, IndexedOutput[]>();
	for (const output of outputs) {
		const txid = output.outpoint.split(/[._]/)[0];
		const group = byTxid.get(txid) ?? [];
		group.push(output);
		byTxid.set(txid, group);
	}

	const groups = [...byTxid.entries()];
	const prepared: PreparedInputs["prepared"] = [];
	const failures: PreparedInputs["failures"] = [];
	let done = 0;
	let cursor = 0;

	const worker = async () => {
		while (cursor < groups.length) {
			const index = cursor++;
			const [txid, groupOutputs] = groups[index];
			try {
				const inputs = await prepareSweepInputs(ctx, groupOutputs);
				const byOutpoint = new Map(inputs.map((i) => [i.outpoint, i]));
				for (const output of groupOutputs) {
					const input = byOutpoint.get(output.outpoint);
					if (input?.lockingScript) {
						prepared.push({ output, input });
					} else {
						failures.push({
							outpoint: output.outpoint,
							error: "missing locking script",
						});
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				for (const output of groupOutputs) {
					failures.push({
						outpoint: output.outpoint,
						error: `source tx ${txid.slice(0, 12)}...: ${message}`,
					});
				}
			}
			done++;
			onDetail?.(done, groups.length);
		}
	};

	await Promise.all(
		Array.from(
			{ length: Math.min(PREPARE_CONCURRENCY, groups.length) },
			worker,
		),
	);

	return { prepared, failures };
}

/**
 * Sweep legacy assets into the BRC-100 wallet. Mirrors the yours-wallet /
 * @1sat/sweep-ui sweeper — BEEF-derived locking scripts, per-output key
 * resolution from own: events, overlay-validated BSV-21 amounts — with
 * chunked transactions and structured progress on top.
 */
export async function executeMigrationSweep(
	params: MigrationSweepParams,
): Promise<SweepResult> {
	const {
		wallet,
		services,
		chain = "main",
		legacyPayWif,
		legacyOrdWif,
		legacyIdentityWif,
		onProgress,
		funding,
		ordinals,
		bsv21Tokens,
		mneeBalance = 0,
	} = params;

	const ctx = createContext(wallet, { services, chain });

	const keyMap = new Map<string, PrivateKey>();
	for (const wif of [legacyPayWif, legacyOrdWif, legacyIdentityWif]) {
		if (!wif) continue;
		try {
			const key = PrivateKey.fromWif(wif);
			keyMap.set(key.toPublicKey().toAddress(), key);
		} catch {
			// skip malformed keys; buildKeys errors identify affected outputs
		}
	}

	const result: SweepResult = {
		bsvTxids: [],
		ordinalTxids: [],
		bsv21Txids: [],
		errors: [],
	};

	const fundingChunks = chunk(funding, FUNDING_CHUNK_SIZE);
	const ordinalChunks = chunk(ordinals, ORDINAL_CHUNK_SIZE);
	const activeTokens = bsv21Tokens.filter((t) => t.outputs.length > 0);

	// Build the step list up front so the UI can render the full plan
	const steps: SweepStepState[] = [];
	if (funding.length > 0) {
		steps.push({
			id: "bsv",
			label: `BSV funding (${funding.length} UTXO${funding.length !== 1 ? "s" : ""})`,
			status: "pending",
			txids: [],
		});
	}
	if (ordinals.length > 0) {
		steps.push({
			id: "ordinals",
			label: `Ordinals (${ordinals.length})`,
			status: "pending",
			txids: [],
		});
	}
	for (const token of activeTokens) {
		steps.push({
			id: `token:${token.tokenId}`,
			label: `${token.symbol ?? token.tokenId.slice(0, 8)} (${token.outputs.length} output${token.outputs.length !== 1 ? "s" : ""})`,
			status: "pending",
			txids: [],
		});
	}
	if (mneeBalance > 0) {
		steps.push({ id: "mnee", label: "MNEE", status: "pending", txids: [] });
	}

	const totalUnits =
		fundingChunks.length +
		ordinalChunks.length +
		activeTokens.reduce(
			(sum, t) => sum + chunk(t.outputs, TOKEN_CHUNK_SIZE).length,
			0,
		) +
		(mneeBalance > 0 ? 1 : 0);
	let completedUnits = 0;

	const emit = (message: string) => {
		onProgress({
			message,
			percent:
				totalUnits === 0
					? 100
					: Math.round((completedUnits / totalUnits) * 100),
			steps: steps.map((s) => ({ ...s, txids: [...s.txids] })),
		});
	};

	const stepById = (id: string) => steps.find((s) => s.id === id);

	if (steps.length === 0) {
		emit("No assets found at legacy addresses");
		return result;
	}

	emit("Starting sweep...");

	// Sweep one category in chunked transactions. Every chunk prepares its
	// own inputs, so partial failures surface as per-chunk errors while the
	// rest of the sweep keeps going.
	const sweepChunked = async (
		stepId: string,
		errorLabel: string,
		chunks: IndexedOutput[][],
		execute: (
			prepared: PreparedInputs["prepared"],
			keys: PrivateKey[],
		) => Promise<{ txid?: string; error?: string }>,
		collect: (txid: string) => void,
	) => {
		const step = stepById(stepId);
		if (!step) return;
		step.status = "active";
		let failedChunks = 0;

		for (let i = 0; i < chunks.length; i++) {
			const batchLabel =
				chunks.length > 1 ? ` (batch ${i + 1}/${chunks.length})` : "";
			try {
				step.detail = `preparing inputs${batchLabel}`;
				emit(`${errorLabel}: preparing inputs${batchLabel}...`);

				const { prepared, failures } = await prepareInputsConcurrent(
					ctx,
					chunks[i],
					(done, total) => {
						step.detail = `fetching source txs ${done}/${total}${batchLabel}`;
						emit(`${errorLabel}: fetching source txs ${done}/${total}...`);
					},
				);

				for (const failure of failures) {
					result.errors.push(
						`${errorLabel}: skipped ${failure.outpoint} (${failure.error})`,
					);
				}

				if (prepared.length === 0) {
					if (failures.length > 0) failedChunks++;
					completedUnits++;
					continue;
				}

				step.detail = `broadcasting${batchLabel}`;
				emit(`${errorLabel}: broadcasting${batchLabel}...`);

				const keys = buildKeys(
					prepared.map((p) => p.output),
					keyMap,
				);
				const txResult = await execute(prepared, keys);

				if (txResult.error) {
					failedChunks++;
					result.errors.push(`${errorLabel}${batchLabel}: ${txResult.error}`);
				} else if (txResult.txid) {
					collect(txResult.txid);
					step.txids.push(txResult.txid);
				}
			} catch (error) {
				failedChunks++;
				result.errors.push(
					`${errorLabel}${batchLabel}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			completedUnits++;
			emit(`${errorLabel}: batch ${i + 1}/${chunks.length} complete`);
		}

		step.detail = undefined;
		step.status =
			failedChunks > 0 || step.txids.length === 0 ? "error" : "done";
		if (failedChunks > 0) {
			step.error = `${failedChunks} of ${chunks.length} batch${chunks.length !== 1 ? "es" : ""} failed`;
		}
		emit(`${errorLabel} complete`);
	};

	// 1. BSV funding
	if (fundingChunks.length > 0) {
		await sweepChunked(
			"bsv",
			"BSV sweep",
			fundingChunks,
			(prepared, keys) =>
				sweepBsv.execute(ctx, {
					inputs: prepared.map((p) => p.input),
					keys,
				}),
			(txid) => result.bsvTxids.push(txid),
		);
	}

	// 2. Ordinals (OPL-4696: listed OrdLock UTXOs cancel via the installed
	// sweepOrdinals unlock; BSV-20 content is refused by the action's guard)
	if (ordinalChunks.length > 0) {
		await sweepChunked(
			"ordinals",
			"Ordinal sweep",
			ordinalChunks,
			(prepared, keys) =>
				sweepOrdinals.execute(ctx, {
					inputs: prepared.map((p) => p.input),
					keys,
				}),
			(txid) => result.ordinalTxids.push(txid),
		);
	}

	// 3. BSV-21 tokens — chunked per token, amounts from the overlay-validated
	// map (never the origin mint amount), inactive tokens skipped
	for (const token of activeTokens) {
		const label = token.symbol ?? token.tokenId.slice(0, 8);
		const step = stepById(`token:${token.tokenId}`);
		if (!token.isActive) {
			if (step) {
				step.status = "error";
				step.error = "not validated on the overlay — skipped";
			}
			result.errors.push(`Token ${label}: not active on the overlay — skipped`);
			completedUnits += chunk(token.outputs, TOKEN_CHUNK_SIZE).length;
			emit(`Token ${label} skipped`);
			continue;
		}

		await sweepChunked(
			`token:${token.tokenId}`,
			`Token ${label}`,
			chunk(token.outputs, TOKEN_CHUNK_SIZE),
			(prepared, keys) =>
				sweepBsv21.execute(ctx, {
					inputs: prepared.map((p) => ({
						...p.input,
						tokenId: token.tokenId,
						amount: token.amounts.get(p.output.outpoint) ?? "0",
					})),
					keys,
				}),
			(txid) => result.bsv21Txids.push(txid),
		);
	}

	// 4. MNEE — cosigner-locked, swept via the MNEE API with raw legacy keys
	// to a P1SAT deposit address of the BRC-100 wallet
	if (mneeBalance > 0) {
		const step = stepById("mnee");
		if (step) step.status = "active";
		try {
			const { derivations } = await deriveDepositAddresses.execute(ctx, {
				count: 1,
			});
			const destinationAddress = derivations[0]?.address;
			if (!destinationAddress) {
				throw new Error("Failed to derive a deposit address");
			}
			const mneeResult = await sweepLegacyMnee({
				mneeClient: services.mnee,
				legacyKeys: [...keyMap.values()],
				destinationAddress,
				onProgress: (message) => {
					if (step) step.detail = message;
					emit(message);
				},
			});
			if (mneeResult.error) {
				if (step) {
					step.status = "error";
					step.error = mneeResult.error;
				}
				result.errors.push(`MNEE sweep: ${mneeResult.error}`);
			} else if (mneeResult.txid) {
				result.mneeTxid = mneeResult.txid;
				if (step) {
					step.status = "done";
					step.txids.push(mneeResult.txid);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (step) {
				step.status = "error";
				step.error = message;
			}
			result.errors.push(`MNEE sweep: ${message}`);
		}
		if (step) step.detail = undefined;
		completedUnits++;
	}

	emit("Sweep complete");
	return result;
}
