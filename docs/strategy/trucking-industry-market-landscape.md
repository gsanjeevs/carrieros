# U.S. Trucking Industry — Market Landscape for Pitches
_Compiled 2026-07-23 · Purpose: pitch/investor context on industry scale + where CarrierOS sits_

---

## The one-line pitch stat

The U.S. trucking industry has **~1 million+ motor carriers**, and the overwhelming majority operate
**1–5 trucks** — the exact segment CarrierOS targets. The 100 largest for-hire carriers in the
country (the Transport Topics TT100 — the industry's own annual benchmark list) top out at
$91B in revenue and ~38,000 tractors at the very top, but that list represents a tiny sliver of
carriers by count. Every company on it, and every company below it, was once a 1–5 truck operation.
**CarrierOS is built for the stage every one of these companies started at, that none of the
existing well-funded TMS players have bothered to serve well.**

---

## Industry scale, at a glance

- Trucks move **more than 70% of all freight by weight** in the U.S. (American Trucking
  Associations / ATA).
- Freight trucking generated roughly **$906 billion in revenue** in the most recent full year cited
  across sources.
- The industry supports **~8.4 million trucking-related jobs** (drivers, logistics, support).
- **~3.5 million professional truck drivers**, **14+ million registered large trucks**.
- Trucks carry **~67% of U.S.–Canada surface trade** and **~85% of U.S.–Mexico surface trade**.
- Freight tonnage is projected to grow from ~11.3 billion tons (2024) toward **~14 billion tons by
  2035** (ATA forecast).

## The top of the market (for context, not the target segment)

Three sources triangulate consistently on who's largest — cross-referencing them below because no
single one is a fully authoritative primary source (see Sourcing notes):

| Rank | Company | Est. Annual Revenue | Fleet Scale | Primary Segment |
|---|---|---|---|---|
| 1 | UPS | ~$91B | ~19,000 tractors | Parcel + enterprise logistics |
| 2 | FedEx (incl. FedEx Freight) | ~$87–88B | ~29,000–38,000 tractors | Parcel + LTL |
| 3 | Ryder System | ~$12.6B | — | Dedicated fleet/logistics |
| 4 | J.B. Hunt | ~$8–12B | ~13,000–20,000 trucks | Intermodal, dedicated, truckload |
| 5 | TFI International (incl. TForce Freight) | ~$8–9B | ~3,300+ tractors (TForce) | Multi-regional LTL |
| 6 | XPO | ~$7.4–8B | — | LTL freight |
| 7 | Knight-Swift Transportation | ~$5.8–7B | ~21,000–27,000 tractors, ~90,000 trailers | Largest dedicated truckload fleet in North America |
| 8 | Old Dominion Freight Line | ~$4.2–5.9B | — | Premium national LTL |
| 9 | Schneider National | ~$5.3–5.5B | ~12,000–14,500 trucks | Long-haul truckload, intermodal |
| 10 | Landstar System | ~$5.3B | ~10,000+ owner-operators (non-asset model) | Owner-operator/agent network |
| — | Estes Express, Werner, ArcBest, SAIA, R+L, Averitt, Southeastern, CRST, Prime, U.S. Xpress, Covenant, Daseke, Kenan Advantage | $1–5B range each | Varies | Regional LTL, refrigerated, flatbed, tanker specialists |

**Read the fleet-size column carefully for the pitch:** even Knight-Swift, the single largest
dedicated truckload carrier in North America, runs ~21,000–27,000 tractors. CarrierOS's target
customer runs 1–5. The entire TT100 — the top 100 for-hire carriers in North America by revenue —
is a rounding error in carrier *count* against the ~1 million-carrier industry, even though it
dominates industry *revenue*. That gap between "who earns the most" and "who most carriers actually
are" is the whole market thesis.

## Why this matters for CarrierOS

- **Every mega-carrier above started as a 1-truck operation.** The pitch isn't "we compete with
  Knight-Swift" — it's "we serve the stage of the business Knight-Swift, J.B. Hunt, and Schneider
  have long since outgrown, and that today's enterprise TMS vendors have no incentive to serve well
  because the deal size is too small for their sales motion."
- **Revenue concentration at the top doesn't mean carrier concentration.** A market with $906B in
  revenue and ~1 million carriers, where the top 100 by revenue still run fleets in the thousands
  (not hundreds of thousands) of trucks, implies a very long tail of small operators doing real,
  substantial aggregate freight volume — that long tail is investable precisely because it's large
  in count and underserved in tooling, not despite it.
- **Freight tonnage growth (~11.3B → ~14B tons by 2035)** is a tailwind argument for TAM growth,
  independent of how the market share splits between carrier sizes.
- **Cross-border stats (67% Canada, 85% Mexico surface trade by truck)** are useful if CarrierOS
  ever discusses expansion beyond the U.S. or serving cross-border micro-carriers.
- Use the **mega-carrier fleet-size numbers as a visual anchor** in a pitch deck slide: a single
  bar chart with "CarrierOS's target customer: 1–5 trucks" next to "Knight-Swift: ~21,000–27,000"
  makes the segment gap immediately legible without needing the audience to know the industry.

## Sourcing notes — read before using these numbers externally

- **Transport Topics' TT100** (`ttnews.com/for-hire/rankings/2025`) is the trucking industry's own
  annual benchmark ranking (comparable to a "Fortune 500 for trucking") and the most authoritative
  of the three sources checked — but the fetched page rendered company names via client-side
  JavaScript that didn't come through in a static fetch, so the revenue/fleet figures above are
  ranked correctly but the top ~10 company names were cross-matched by revenue against the other two
  sources, not read directly off the TT100 page. **Before using TT100 figures in an investor deck,
  verify company names directly against `ttnews.com` in a browser**, not from this note alone.
- **FreightRun.com** and **tacinjurylaw.com** are a freight-broker lead-gen site and a personal-injury
  law firm's blog, respectively — neither is a primary industry-data source. Both cite ATA/FMCSA
  numbers for the macro stats (freight tonnage, driver counts, revenue), which are reasonable to
  reuse, but their own carrier rankings/revenue estimates should be treated as directional, not exact
  — they disagree with each other and with TT100 on several figures (e.g. J.B. Hunt revenue ranges
  from $8B to $12B depending on source).
- The oft-cited **"1 million+ carriers, ~96% operate 1–5 trucks"** framing is a very common industry
  stat traceable to FMCSA registration data, but this pass didn't verify the exact 96% figure against
  a primary FMCSA source — worth doing before it appears verbatim in an investor deck. Treat "the
  overwhelming majority of carriers are 1–5 trucks" as solid, and any specific percentage as needing
  a direct FMCSA citation before it goes in a pitch.

## Recommended next step, if this goes in a real pitch deck

Pull the exact current-year FMCSA carrier-size-distribution numbers directly (FMCSA publishes this;
it's public data) rather than relying on secondary blog citations, since that's the one stat in this
whole summary doing the most rhetorical work for the market-size argument and it's the one least
directly verified here.
