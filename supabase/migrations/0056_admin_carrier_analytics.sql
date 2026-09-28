-- ShipmentX portfolio analytics: current operational metrics with explicit
-- 30-day vs previous-30-day load activity and tier/fleet-size cohorts.
-- This does not pretend to be product event analytics; no event snapshotting
-- is available yet. Access is restricted to the server's service-role client.

CREATE INDEX idx_loads_created_at_carrier ON loads(created_at, carrier_org_id);
CREATE INDEX idx_invoices_created_at_carrier ON invoices(created_at, carrier_org_id);
CREATE INDEX idx_support_tickets_platform_queue ON support_tickets(queue, status, carrier_org_id);

CREATE OR REPLACE FUNCTION admin_carrier_portfolio_analytics(
  p_search TEXT DEFAULT NULL,
  p_tier TEXT DEFAULT NULL,
  p_fleet_band TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 0,
  p_page_size INTEGER DEFAULT 50
)
RETURNS TABLE (
  org_id BIGINT,
  org_name TEXT,
  created_at TIMESTAMPTZ,
  tier TEXT,
  billing_status TEXT,
  fleet_band TEXT,
  active_users BIGINT,
  active_vehicles BIGINT,
  active_drivers BIGINT,
  customer_accounts BIGINT,
  loads_last_30d BIGINT,
  loads_previous_30d BIGINT,
  loads_per_active_vehicle NUMERIC,
  invoices_last_30d BIGINT,
  open_support_tickets BIGINT,
  cohort_carriers BIGINT,
  cohort_median_loads_per_vehicle NUMERIC,
  total_carriers BIGINT,
  active_billing_carriers BIGINT,
  trialing_carriers BIGINT,
  past_due_carriers BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH carrier_base AS (
    SELECT o.id, o.name, o.created_at,
           COALESCE(cd.tier, 'starter') AS tier,
           COALESCE(cd.billing_status, 'trialing') AS billing_status
    FROM organizations o
    LEFT JOIN carrier_details cd ON cd.org_id = o.id
    WHERE o.type = 'carrier'
  ),
  users AS (
    SELECT p.org_id, count(*)::BIGINT AS active_users
    FROM profiles p
    WHERE p.is_active = true
    GROUP BY p.org_id
  ),
  vehicles AS (
    SELECT v.carrier_org_id AS org_id, count(*)::BIGINT AS active_vehicles
    FROM vehicles v
    WHERE v.is_active = true AND v.status = 'active'
    GROUP BY v.carrier_org_id
  ),
  drivers AS (
    SELECT d.carrier_org_id AS org_id, count(*)::BIGINT AS active_drivers
    FROM drivers d
    WHERE d.is_active = true AND d.invite_status = 'accepted'
    GROUP BY d.carrier_org_id
  ),
  customers AS (
    SELECT cd.carrier_org_id AS org_id, count(*)::BIGINT AS customer_accounts
    FROM customer_details cd
    GROUP BY cd.carrier_org_id
  ),
  load_activity AS (
    SELECT l.carrier_org_id AS org_id,
      count(*) FILTER (WHERE l.created_at >= now() - interval '30 days')::BIGINT AS loads_last_30d,
      count(*) FILTER (WHERE l.created_at >= now() - interval '60 days'
                        AND l.created_at < now() - interval '30 days')::BIGINT AS loads_previous_30d
    FROM loads l
    WHERE l.created_at >= now() - interval '60 days'
    GROUP BY l.carrier_org_id
  ),
  invoice_activity AS (
    SELECT i.carrier_org_id AS org_id, count(*)::BIGINT AS invoices_last_30d
    FROM invoices i
    WHERE i.created_at >= now() - interval '30 days'
    GROUP BY i.carrier_org_id
  ),
  tickets AS (
    SELECT st.carrier_org_id AS org_id, count(*)::BIGINT AS open_support_tickets
    FROM support_tickets st
    WHERE st.queue = 'carrieros_support' AND st.status = 'open'
    GROUP BY st.carrier_org_id
  ),
  enriched AS (
    SELECT b.id AS org_id, b.name AS org_name, b.created_at, b.tier, b.billing_status,
      COALESCE(u.active_users, 0)::BIGINT AS active_users,
      COALESCE(v.active_vehicles, 0)::BIGINT AS active_vehicles,
      COALESCE(d.active_drivers, 0)::BIGINT AS active_drivers,
      COALESCE(c.customer_accounts, 0)::BIGINT AS customer_accounts,
      COALESCE(l.loads_last_30d, 0)::BIGINT AS loads_last_30d,
      COALESCE(l.loads_previous_30d, 0)::BIGINT AS loads_previous_30d,
      COALESCE(i.invoices_last_30d, 0)::BIGINT AS invoices_last_30d,
      COALESCE(t.open_support_tickets, 0)::BIGINT AS open_support_tickets,
      CASE
        WHEN COALESCE(v.active_vehicles, 0) = 0 THEN 'no_active_vehicles'
        WHEN v.active_vehicles = 1 THEN '1_vehicle'
        WHEN v.active_vehicles <= 5 THEN '2_5_vehicles'
        WHEN v.active_vehicles <= 20 THEN '6_20_vehicles'
        ELSE '21_plus_vehicles'
      END AS fleet_band,
      CASE WHEN COALESCE(v.active_vehicles, 0) > 0
        THEN round(COALESCE(l.loads_last_30d, 0)::NUMERIC / v.active_vehicles, 2)
        ELSE NULL
      END AS loads_per_active_vehicle
    FROM carrier_base b
    LEFT JOIN users u ON u.org_id = b.id
    LEFT JOIN vehicles v ON v.org_id = b.id
    LEFT JOIN drivers d ON d.org_id = b.id
    LEFT JOIN customers c ON c.org_id = b.id
    LEFT JOIN load_activity l ON l.org_id = b.id
    LEFT JOIN invoice_activity i ON i.org_id = b.id
    LEFT JOIN tickets t ON t.org_id = b.id
  ),
  filtered AS (
    SELECT e.* FROM enriched e
    WHERE (p_search IS NULL OR e.org_name ILIKE '%' || p_search || '%')
      AND (p_tier IS NULL OR e.tier = p_tier)
      AND (p_fleet_band IS NULL OR e.fleet_band = p_fleet_band)
  ),
  cohort_filtered AS (
    SELECT e.* FROM enriched e
    WHERE (p_tier IS NULL OR e.tier = p_tier)
      AND (p_fleet_band IS NULL OR e.fleet_band = p_fleet_band)
  ),
  cohort AS (
    SELECT cf.tier, cf.fleet_band, count(*)::BIGINT AS cohort_carriers,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY cf.loads_per_active_vehicle)::NUMERIC AS cohort_median
    FROM cohort_filtered cf
    WHERE cf.loads_per_active_vehicle IS NOT NULL
    GROUP BY cf.tier, cf.fleet_band
  ),
  totals AS (
    SELECT count(*)::BIGINT AS total_carriers,
      count(*) FILTER (WHERE billing_status = 'active')::BIGINT AS active_billing_carriers,
      count(*) FILTER (WHERE billing_status = 'trialing')::BIGINT AS trialing_carriers,
      count(*) FILTER (WHERE billing_status = 'past_due')::BIGINT AS past_due_carriers
    FROM filtered
  )
  SELECT f.org_id, f.org_name, f.created_at, f.tier, f.billing_status, f.fleet_band,
    f.active_users, f.active_vehicles, f.active_drivers, f.customer_accounts,
    f.loads_last_30d, f.loads_previous_30d, f.loads_per_active_vehicle,
    f.invoices_last_30d, f.open_support_tickets,
    COALESCE(c.cohort_carriers, 0), c.cohort_median,
    totals.total_carriers, totals.active_billing_carriers, totals.trialing_carriers, totals.past_due_carriers
  FROM filtered f
  LEFT JOIN cohort c ON c.tier = f.tier AND c.fleet_band = f.fleet_band
  CROSS JOIN totals
  ORDER BY f.created_at DESC NULLS LAST, f.org_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100)
  OFFSET LEAST(GREATEST(COALESCE(p_page, 0), 0), 10000) * LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION admin_carrier_portfolio_analytics(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_carrier_portfolio_analytics(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
