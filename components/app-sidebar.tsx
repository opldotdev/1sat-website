"use client";

import { PrivateKey } from "@bsv/sdk";
import { Cable, Copy, Import, Loader2, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useState } from "react";
import { NavUser } from "@/components/nav-user";
import { Button } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
	useSidebar,
} from "@/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { LegacySweepBanner } from "@/components/wallet/legacy-sweep-banner";
import { ListedCancelBanner } from "@/components/wallet/listed-cancel-banner";
import { UnlockWalletDialog } from "@/components/wallet/unlock-wallet-dialog";
import { useCopyWithSound } from "@/hooks/use-copy-with-sound";
import { useSound } from "@/hooks/use-sound";
import { PRIVACY_MODE_KEY } from "@/lib/constants";
import { useStackFeatures } from "@/lib/hooks/use-stack-features";
import { reportDiagnostic } from "@/lib/runtime-diagnostics";
import type { StackFeature } from "@/lib/stack-features";
import { useSettingsStorage } from "@/lib/wallet-storage";
import { useWallet } from "@/providers/wallet-provider";
import { useWalletToolbox } from "@/providers/wallet-toolbox-provider";

interface WalletNavItem {
	title: string;
	url: string;
	shortcut?: string;
	feature?: StackFeature;
}

const navData: Array<{
	title: string;
	icon: typeof Wallet;
	items: WalletNavItem[];
}> = [
	{
		title: "Wallet",
		icon: Wallet,
		items: [
			{
				title: "Identity",
				url: "/wallet/identity",
				shortcut: "g i",
				feature: "identity",
			},
			{
				title: "Ordinals",
				url: "/wallet/ordinals",
				shortcut: "g o",
				feature: "ordinals",
			},
			{
				title: "BSV21",
				url: "/wallet/bsv21",
				shortcut: "g 1",
				feature: "bsv21",
			},
			{
				title: "History",
				url: "/wallet/history",
				shortcut: "g y",
			},
			{
				title: "Settings",
				url: "/wallet/settings",
				shortcut: "g ,",
			},
		],
	},
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { isWalletInitialized, hasWallet, walletKeys } = useWallet();
	const {
		balance,
		hasActiveSync: isSyncing,
		exchangeRate,
		depositAddress,
		isInitialized,
		isInitializing,
		initError,
		connectExternalWallet,
		connectionMode,
	} = useWalletToolbox();

	const [isPrivacyModeEnabled] = useSettingsStorage<boolean>(
		PRIVACY_MODE_KEY,
		false,
	);
	const [isUnlockDialogOpen, setIsUnlockDialogOpen] = useState(false);
	const [, copy] = useCopyWithSound();
	const { play } = useSound();
	const { isMobile, setOpenMobile } = useSidebar();
	const featuresQuery = useStackFeatures();

	// Navigation from the sidebar must close the mobile sheet — otherwise the
	// overlay stays on top of the new page and taps appear to do nothing
	const handleNav = () => {
		play("click");
		if (isMobile) setOpenMobile(false);
	};
	const [copiedAddress, setCopiedAddress] = useState(false);

	const bsvBalance = balance ? balance.total / 100_000_000 : 0;
	const usdBalance = exchangeRate ? bsvBalance * exchangeRate : 0;
	const hasWalletBalance = balance !== null;

	const payAddress = React.useMemo(() => {
		if (!walletKeys?.payPk) return "";
		try {
			return PrivateKey.fromWif(walletKeys.payPk).toAddress().toString();
		} catch {
			reportDiagnostic({
				category: "provider",
				code: "provider.failed",
				operation: "wallet.address.pay",
				recoverable: true,
			});
			return "";
		}
	}, [walletKeys]);

	const identityAddress = React.useMemo(() => {
		if (!walletKeys?.identityPk) return "";
		try {
			return PrivateKey.fromWif(walletKeys.identityPk).toAddress().toString();
		} catch {
			reportDiagnostic({
				category: "provider",
				code: "provider.failed",
				operation: "wallet.address.identity",
				recoverable: true,
			});
			return "";
		}
	}, [walletKeys]);

	const isExternal = connectionMode === "external";
	const resolvedDepositAddress =
		depositAddress || (isExternal ? "" : identityAddress || payAddress);

	const handleCopyAddress = () => {
		copy(resolvedDepositAddress);
		setCopiedAddress(true);
		setTimeout(() => setCopiedAddress(false), 2000);
	};

	if (!isWalletInitialized) {
		return (
			<Sidebar {...props}>
				<SidebarHeader className="p-4 pb-0">
					<div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
						<Loader2 className="h-6 w-6 animate-spin" />
						<p className="text-sm mt-2">Loading Wallet...</p>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<p className="p-4 text-sm text-muted-foreground">Initializing...</p>
				</SidebarContent>
				<SidebarRail />
			</Sidebar>
		);
	}

	// State 1: No Wallet (Create/Import)
	if (!hasWallet && !isInitialized) {
		return (
			<Sidebar {...props}>
				<SidebarHeader className="p-4 pb-0">
					<div className="flex flex-col items-center justify-center gap-4 py-4">
						<Wallet className="h-8 w-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No Wallet</p>
						<div className="grid grid-cols-1 gap-2 w-full">
							<Button
								className="w-full"
								disabled={isInitializing}
								onClick={() => void connectExternalWallet()}
							>
								{isInitializing ? (
									<Loader2
										className="h-4 w-4 mr-2 animate-spin"
										data-icon="inline-start"
									/>
								) : (
									<Cable className="h-4 w-4 mr-2" data-icon="inline-start" />
								)}
								Connect BRC-100
							</Button>
							{initError && (
								<p className="text-destructive text-xs" role="alert">
									{initError}
								</p>
							)}
							<Button asChild className="w-full" variant="outline">
								<Link href="/wallet/create" onClick={handleNav}>
									<Plus className="h-4 w-4 mr-2" data-icon="inline-start" />{" "}
									Create New
								</Link>
							</Button>
							<Button asChild className="w-full" variant="ghost">
								<Link href="/wallet/import" onClick={handleNav}>
									<Import className="h-4 w-4 mr-2" data-icon="inline-start" />{" "}
									Import Existing
								</Link>
							</Button>
						</div>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<div className="p-4 text-sm text-muted-foreground text-center">
						Connect a wallet, or create one in this browser.
					</div>
				</SidebarContent>
				<SidebarRail />
			</Sidebar>
		);
	}

	const activeAddress = resolvedDepositAddress;

	// State 3: Unlocked (or Locked but covered by overlay)
	return (
		<Sidebar {...props}>
			<SidebarHeader className="p-4 pb-0">
				{/* Unlocked Content */}
				<div className="flex flex-col gap-1">
					<Link
						href="/wallet"
						className="flex flex-col gap-1 hover:opacity-80 transition-opacity cursor-pointer mb-4"
						onClick={handleNav}
					>
						<span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
							Total Balance
							{isSyncing && <Loader2 className="h-3 w-3 animate-spin" />}
						</span>
						<div className="flex items-baseline gap-2">
							<span className="text-2xl font-bold tracking-tight">
								{isExternal && !hasWalletBalance
									? "Provider-managed"
									: isPrivacyModeEnabled
										? "*****"
										: usdBalance
											? `$${usdBalance.toFixed(2)}`
											: "$ ---"}
							</span>
							{(!isExternal || hasWalletBalance) && (
								<span className="text-sm text-muted-foreground">USD</span>
							)}
						</div>
						<span className="text-sm text-muted-foreground">
							{isExternal && !hasWalletBalance
								? "Balance stays in the connected wallet"
								: isPrivacyModeEnabled
									? "*****"
									: `${bsvBalance.toFixed(8)} BSV`}
						</span>
					</Link>

					<div className="mb-4">
						<div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/50 p-2">
							<div className="flex flex-col overflow-hidden">
								<span className="text-[10px] font-medium text-muted-foreground uppercase">
									{isExternal ? "Receive" : "Deposit Address"}
								</span>
								<span className="truncate font-mono text-xs text-foreground/80">
									{resolvedDepositAddress ||
										(isExternal ? "Unavailable" : "Locked")}
								</span>
							</div>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-6 w-6 shrink-0"
											onClick={(e) => {
												e.preventDefault();
												handleCopyAddress();
											}}
											disabled={!resolvedDepositAddress}
											aria-label="Copy deposit address"
										>
											<Copy className="h-3 w-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>{copiedAddress ? "Copied!" : "Copy Address"}</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					</div>
				</div>
			</SidebarHeader>
			<SidebarSeparator className="my-4" />
			<SidebarContent>
				<ListedCancelBanner />
				<LegacySweepBanner />
				{navData.map((group) => (
					<SidebarGroup key={group.title}>
						<SidebarGroupLabel>{group.title}</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{group.items.map((item) => {
									const available =
										!item.feature ||
										featuresQuery.data?.features[item.feature] === true;
									return (
										<SidebarMenuItem key={item.title}>
											{available ? (
												<SidebarMenuButton asChild>
													<Link href={item.url} onClick={handleNav}>
														{item.title}
														{item.shortcut && (
															<span className="ml-auto hidden text-xs tracking-widest text-muted-foreground md:block">
																{item.shortcut}
															</span>
														)}
													</Link>
												</SidebarMenuButton>
											) : (
												<SidebarMenuButton disabled>
													<span>{item.title}</span>
													<span
														aria-live="polite"
														className="ml-auto text-[10px] text-muted-foreground"
														role="status"
													>
														{featuresQuery.isLoading
															? "Checking"
															: "Unavailable"}
													</span>
												</SidebarMenuButton>
											)}
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				))}
			</SidebarContent>
			<SidebarFooter>
				<NavUser
					user={{
						name: "1Sat User",
						email: activeAddress ? activeAddress.slice(0, 8) : "No Wallet",
						address: activeAddress || "1sat",
					}}
				/>
			</SidebarFooter>
			<SidebarRail />
			<UnlockWalletDialog
				open={isUnlockDialogOpen}
				onOpenChange={setIsUnlockDialogOpen}
			/>
		</Sidebar>
	);
}
