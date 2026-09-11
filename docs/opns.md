# OpNS ownership and market surface

OPL-3973 is implemented against the installed `@1sat/actions` 0.0.200 and
typed `@1sat/client` contracts. The UI never opens built-in wallet storage and
uses the active provider's `OneSatContext` for every wallet action.

## Implemented contracts

| Surface | Installed contract | Website behavior |
| --- | --- | --- |
| Owned names | `listOpns` | Identity-scoped, paginated wallet basket with explicit missing-ID state |
| Publish / unpublish | `registerOpns`, `deregisterOpns` | Review, exact current-row revalidation, wallet authorization, txid, refresh |
| Send | `sendOpns` | Chain-checked P2PKH or compressed BRC-100 counterparty; no resolver guess |
| List / cancel | `sellOpns` off (OPL-4694), `cancelOpnsListing` on | Create is disabled; cancel still revalidates listed-state and refreshes |
| Discovery | `OpnsClient.getOrigin`, `MarketClient.searchListings` | Exact typed origin lookup and active `application/op-ns` listing pagination |
| Detail | `getOrigin`, ORDFS metadata, active-by-origin Market lookup | Capability-specific origin/content/listing state; origin and listing must agree |
| Buy | `buyOpns` | Ownership check, exact origin/outpoint/price revalidation, review, txid, refresh |

The action package does not expose a fee quote. Reviews therefore show the
exact asset or listing amount and marketplace fee (zero because none is
configured), while labeling network fee and final total as wallet-determined.
No floating-point BSV-to-satoshi conversion is accepted.

## Deliberately unavailable

- Direct mining/claim remains hidden. `OpnsClient.getMine(name)` returns only
  `{ outpoint, domain }`, while `internalizeOpns` requires AtomicBEEF,
  `protocolID`, and `keyID`. There is no installed recovery-safe claim action or
  payload contract that connects those two APIs.
- Published-profile reading is disabled. The action comments mention a paymail
  public-profile capability, but the installed typed clients expose no profile
  resolver.
- Paymail destinations are not inferred for send. Only a chain-correct P2PKH
  address or compressed identity public key is accepted.
- No bespoke quote, mining, profile, or legacy endpoint is called.

## Revalidation and recovery

Owned actions re-read the exact canonical asset ID and require its outpoint,
published state, and OrdLock state to match the reviewed row. Purchases re-read
the active listing by origin and require the exact listing outpoint and integer
price. Stale reviews stop before action authorization and offer a refresh.
Cancel/error preserves entered values. Successful mutations invalidate owned
names, wallet balance, OpNS listings, and market state.

The live stack capability manifest observed during implementation included
`opns`, `market`, `ordfs`, and `beef`. Read-only probes confirmed typed OpNS
origin/mining responses and active `application/op-ns` listings. These probes
are not funded transaction, indexer completion, browser, or provider-mode
certification.

## Remaining certification dependencies

- OPL-3949: current stack contract/capability baseline.
- OPL-3954: real provider/browser matrix.
- A funded, indexed test vector is still required for publish, unpublish, send,
  list, cancel, and buy interruption/recovery.
- The recovery-safe direct claim contract and typed public-profile resolver must
  land upstream before those controls can be enabled.
