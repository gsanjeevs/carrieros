# DAT Freight Posting API — partner outreach draft (2026-09-27)

Context: CarrierOS is building a load-board posting integration (Phase 1: DAT only, posting
outbound loads, no search yet — see `architecture/adr/` or `CURRENT_WORK.md` in the repo for the
current build status). DAT doesn't expose a self-serve API key; access is arranged by emailing
their developer support team after creating a Developer Portal account.

## Step 1 — Developer Portal account
Go to https://www.dat.com/api-integration and create a Developer Portal account (this step can be
done directly, no reply needed from DAT).

## Step 2 — Partner access email

**To:** developersupport@dat.com
**Subject:** Freight Posting API access request — CarrierOS (ShipmentX)

**Body (fill in the bracketed fields before sending):**

> Hello,
>
> We're building CarrierOS, a TMS platform for small-to-midsize carriers (ShipmentX, [legal entity
> name]). We'd like to integrate DAT's Freight Posting API so our customers can post loads to the
> DAT One board directly from CarrierOS, and eventually search available freight as well.
>
> Could you point us to the API documentation, sandbox/test environment access, and the process for
> becoming an approved TMS integration partner?
>
> Company details:
> - Legal entity name: [FILL IN]
> - MC/DOT number: [FILL IN, if applicable — ShipmentX itself may not carry freight, so this may be
>   N/A; DAT may instead want the carrier customer base description or a sample carrier's MC#]
> - Business address: [FILL IN]
> - Website: [FILL IN]
> - Primary contact: [FILL IN name], [FILL IN phone], info@shipmentx.com
>
> Happy to hop on a call if that's easier.
>
> Thanks,
> [Your name]

## What's still needed from you before this can go live
- Legal entity name, address, and whether ShipmentX (the software vendor) or a specific carrier
  customer's MC/DOT number is the right identity for this application — DAT's partner program may
  be designed around carriers directly, not TMS vendors, so their reply may clarify the actual
  path (e.g., a vendor partner agreement vs. per-carrier API keys).
- Once DAT responds with real API docs/sandbox credentials, hand them to the CarrierOS session
  building `feature/dat-loadboard` so the mocked `DatClient` (see
  `server/infrastructure/loadboard/dat-client.ts`) can be swapped for a real implementation.

## Later, lower priority
If this integration proves valuable, the same outreach pattern applies to Truckstop.com
(`developer.truckstop.com`, has a separate Load Management API for posting and a SOAP Load Search
API) and 123Loadboard (`partner-integrations@123loadboard.com`, explicit Post Loads + Search Loads
API) — not pursued yet, per the phased plan (DAT-first, posting-only, prove the flow before adding
more boards).
