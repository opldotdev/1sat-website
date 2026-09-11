# Ordinal marketplace

The ordinal marketplace uses the installed typed boundaries:

- `@1sat/client` `MarketClient` for active listing search, direct detail,
  active-by-origin revalidation, and bulk origin reconciliation.
- `@1sat/actions` `buyOrdinal` and `cancelOrdinalListing` through the active
  provider's `OneSatContext`.

The browse route accepts bounded name and content-type filters and paginates
with the market output's score. Only listings with a positive safe-integer
satoshi price and no spend are shown. Unsafe or fractional API prices are not
coerced into a displayed price.

The detail page uses the active-by-origin result as the purchasable listing.
Immediately before `buyOrdinal`, the client fetches that active listing again
and requires the origin, outpoint, and exact integer price to match the review.
A changed, spent, or missing listing remains unsubmitted and gets a refresh
path. The action still owns final on-chain OrdLock decoding and wallet
authorization.

The purchase review shows:

- the exact indexed listing price;
- a zero marketplace fee because this website passes no marketplace fee
  address/rate to the installed action;
- total before network fee, equal to the listing price; and
- an explicit note that the wallet-set network fee is not quoted by the
  installed action.

No fee estimate is invented.

My Listings starts with current wallet outputs carrying both `ordlock` and a
wallet `id:` tag, then bulk-fetches active market listings by their origin.
Only an exact active outpoint match is called market-confirmed. Wallet OrdLock
outputs without that match are displayed separately as unconfirmed and can be
cleaned up through the canonical cancellation flow. Identity is part of the
query key and open cancellation state is cleared when identity changes.

Buy and cancel success invalidate wallet balance, market flow, and My Listings
queries, then refresh server-rendered details.

OrdLock listing create is off (OPL-4694). The wallet and OpNS surfaces hide
create UI and reject `sell` dispatch. Existing listing buy and cancel stay on.

## Certification boundary

Automated tests prove typed queries, score pagination, exact price handling,
active-origin revalidation, wallet/market intersection, canonical action source
boundaries, and invalidation. They do not prove a funded purchase/cancellation,
live wallet authorization UI, or how quickly the deployed market index reflects
a transaction. Those require funded fixtures and recorded browser/provider
evidence.
