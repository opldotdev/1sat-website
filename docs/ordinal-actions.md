# Wallet ordinal actions

The wallet ordinals page uses the active provider's `OneSatContext` and the
installed `@1sat/actions` 0.0.200 action contracts. It does not derive keys,
construct a second wallet client, or call a legacy ordinal endpoint.

| UI operation | Canonical action | Input |
| --- | --- | --- |
| Send one or many | `sendOrdinals` | One transfer per wallet `id:` tag, with either a P2PKH address or compressed counterparty identity key |
| Burn one or many | `burnOrdinals` | Wallet `id:` tags after a review list and typed `BURN` confirmation |
| List one | `sellOrdinal` | Disabled (OPL-4694). Create UI and dispatch are off. |
| Cancel one listing | `cancelOrdinalListing` | The listed output's wallet `id:` tag |

Listed outputs are identified only by the current `ordlock` tag. Outputs that
predate wallet asset IDs remain visible but cannot be submitted; refreshing the
wallet or migrating them is required. The UI does not guess an ID from an
outpoint.

Prices remain parsed as exact satoshis, but listing create is currently off
(`ORDLOCK_LISTING_CREATE`). Buy and cancel of existing listings stay available.

Send and burn operate only on unlisted items. A listing must first be cancelled
through the installed OrdLock action. Every transaction is reviewed before the
wallet authorization request. A denial, a stale/missing output, or another
failure keeps the selection and form details so the user can refresh or retry.
Provider error payloads are not displayed or recorded in runtime diagnostics.

After success, the wallet-balance basket query and `market-flow` query are
invalidated, the wallet balance refresh is requested, and server-rendered market
pages are refreshed.

## Certification boundary

Automated tests verify exact action dispatch, integer parsing, destination
validation, safe failure messaging, provider-neutral source boundaries, and
cache invalidation. They do not prove a funded mainnet/testnet transaction,
Yours/1Sat wallet approval behavior, or browser rendering against a live wallet.
Those require fixtures with spendable ordinals and market indexing and must be
recorded separately before this flow is called production-certified.
